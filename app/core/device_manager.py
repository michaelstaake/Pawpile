import json
import logging
import re
import shlex
import subprocess
from dataclasses import dataclass

import httpx
import psutil
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models.device import Device

logger = logging.getLogger(__name__)


def get_supported_vendors() -> set[str]:
    settings = get_settings()
    configured = settings.supported_device_list()
    if configured:
        return set(configured)

    return {"cpu", "nvidia", "amd", "intel"}


def is_supported_vendor(vendor: str) -> bool:
    return vendor in get_supported_vendors()


@dataclass
class DetectedDevice:
    hardware_id: str
    name: str
    vendor: str
    device_type: str
    memory_mb: int
    max_threads: int = 0
    max_slots: int = 1


class DeviceManager:
    def detect_all(self) -> list[DetectedDevice]:
        remote = self._detect_runtime_devices()
        if remote:
            return remote

        configured = self._detect_configured_devices()
        if configured:
            return configured

        return self.detect_local()

    def detect_local(self) -> list[DetectedDevice]:
        devices: list[DetectedDevice] = []
        # On Ubuntu, support NVIDIA, AMD, Intel, and CPU
        devices.extend(self._detect_nvidia())
        devices.extend(self._detect_amd())
        devices.extend(self._detect_intel())
        devices.extend(self._detect_cpu())
        return devices

    def sync_detected_devices(self, db: Session) -> list[Device]:
        detected = self.detect_all()
        existing = {d.hardware_id: d for d in db.query(Device).all()}
        detected_ids = {device.hardware_id for device in detected}

        for row in existing.values():
            if not is_supported_vendor(row.vendor) or row.hardware_id not in detected_ids:
                row.enabled = False

        for d in detected:
            row = existing.get(d.hardware_id)
            if row is None:
                row = Device(
                    hardware_id=d.hardware_id,
                    name=d.name,
                    vendor=d.vendor,
                    device_type=d.device_type,
                    memory_mb=d.memory_mb,
                    enabled=False,
                    max_threads=d.max_threads,
                    max_slots=d.max_slots,
                )
                db.add(row)
            else:
                row.name = d.name
                row.vendor = d.vendor
                row.device_type = d.device_type
                row.memory_mb = d.memory_mb
                if row.device_type == "cpu":
                    row.max_threads = d.max_threads or row.max_threads
                    row.max_slots = max(1, d.max_slots)

        db.commit()
        return db.query(Device).order_by(Device.priority.asc(), Device.id.asc()).all()

    def _detect_runtime_devices(self) -> list[DetectedDevice]:
        settings = get_settings()
        if not settings.inference_runtime_urls.strip():
            return []

        devices_by_id: dict[str, DetectedDevice] = {}
        runtime_map = settings.inference_runtime_url_map()
        timeout = settings.inference_service_timeout_seconds

        for runtime_vendor, base_url in runtime_map.items():
            try:
                with httpx.Client(timeout=timeout) as client:
                    response = client.get(f"{base_url}/runtime/devices")
                    response.raise_for_status()
            except Exception as exc:
                logger.warning("Failed to fetch devices from runtime %s at %s: %s", runtime_vendor, base_url, exc)
                continue

            payload = response.json()
            rows = payload.get("devices", []) if isinstance(payload, dict) else []
            for row in rows:
                device = self._parse_runtime_device(row)
                if not device:
                    continue
                if runtime_vendor != "default" and device.vendor != runtime_vendor:
                    continue
                devices_by_id[device.hardware_id] = device

        return list(devices_by_id.values())

    @staticmethod
    def _parse_runtime_device(row: object) -> DetectedDevice | None:
        if not isinstance(row, dict):
            return None

        try:
            hardware_id = str(row["hardware_id"])
            name = str(row["name"])
            vendor = str(row["vendor"])
            device_type = str(row.get("device_type", "gpu"))
            memory_mb = int(row.get("memory_mb", 0) or 0)
            max_threads = int(row.get("max_threads", 0) or 0)
            max_slots = int(row.get("max_slots", 1) or 1)
        except (KeyError, TypeError, ValueError):
            return None

        return DetectedDevice(
            hardware_id=hardware_id,
            name=name,
            vendor=vendor,
            device_type=device_type,
            memory_mb=memory_mb,
            max_threads=max_threads,
            max_slots=max(1, max_slots),
        )

    def _run(self, command: str) -> str:
        try:
            output = subprocess.check_output(shlex.split(command), stderr=subprocess.DEVNULL, text=True)
            return output.strip()
        except Exception as exc:
            logger.debug("Device probe command failed (%s): %s", command, exc)
            return ""

    def _detect_nvidia(self) -> list[DetectedDevice]:
        output = self._run("nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits")
        devices: list[DetectedDevice] = []
        for line in output.splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 3:
                continue
            devices.append(
                DetectedDevice(
                    hardware_id=f"nvidia:{parts[0]}",
                    name=parts[1],
                    vendor="nvidia",
                    device_type="gpu",
                    memory_mb=int(parts[2] or "0"),
                    max_slots=1,
                )
            )
        return devices

    def _detect_amd(self) -> list[DetectedDevice]:
        json_output = self._run("rocm-smi --showproductname --showmeminfo vram --json")
        devices = self._parse_amd_json(json_output)
        if devices:
            return devices
        return self._parse_amd_text(self._run("rocm-smi --showproductname --showmeminfo vram"))

    @staticmethod
    def _parse_amd_json(json_output: str) -> list[DetectedDevice]:
        if not json_output:
            return []
        try:
            data = json.loads(json_output)
        except json.JSONDecodeError:
            return []
        if not isinstance(data, dict):
            return []

        devices: list[DetectedDevice] = []
        for card_key in sorted(data.keys()):
            if not card_key.lower().startswith("card"):
                continue
            entry = data[card_key]
            if not isinstance(entry, dict):
                continue

            digits = re.sub(r"\D", "", card_key) or str(len(devices))
            index = int(digits)

            name = (
                entry.get("Card series")
                or entry.get("Card Series")
                or entry.get("Card model")
                or entry.get("Card Model")
                or f"AMD GPU {index}"
            )

            memory_bytes = 0
            for key, value in entry.items():
                if "vram total memory" in key.lower():
                    try:
                        memory_bytes = int(str(value).strip())
                    except (TypeError, ValueError):
                        memory_bytes = 0
                    break

            devices.append(
                DetectedDevice(
                    hardware_id=f"amd:{index}",
                    name=str(name)[:120],
                    vendor="amd",
                    device_type="gpu",
                    memory_mb=int(memory_bytes / (1024 * 1024)) if memory_bytes else 0,
                )
            )
        return devices

    @staticmethod
    def _parse_amd_text(text_output: str) -> list[DetectedDevice]:
        if not text_output:
            return []
        devices: list[DetectedDevice] = []
        for line in text_output.splitlines():
            if "vram total memory" not in line.lower():
                continue
            card_match = re.search(r"card(\d+)", line, re.IGNORECASE)
            size_match = re.search(r"(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)?", line, re.IGNORECASE)
            if not card_match or not size_match:
                continue
            index = int(card_match.group(1))
            value = float(size_match.group(1))
            unit = (size_match.group(2) or "b").lower()
            multipliers = {"b": 1, "kb": 1024, "mb": 1024**2, "gb": 1024**3, "tb": 1024**4}
            memory_bytes = int(value * multipliers.get(unit, 1))
            devices.append(
                DetectedDevice(
                    hardware_id=f"amd:{index}",
                    name=f"AMD GPU {index}",
                    vendor="amd",
                    device_type="gpu",
                    memory_mb=int(memory_bytes / (1024 * 1024)),
                )
            )
        return devices

    def _detect_intel(self) -> list[DetectedDevice]:
        output = self._run("sycl-ls")
        devices: list[DetectedDevice] = []
        names_in_order: list[str] = []
        preferred_counts: dict[str, int] = {}
        fallback_counts: dict[str, int] = {}

        for line in output.splitlines():
            line_lower = line.lower()
            if "gpu" not in line_lower or "intel" not in line_lower:
                continue

            raw_name = line.split(",", 1)[-1].strip() if "," in line else line.strip()
            name_match = re.search(r"(Intel\(R\).*?Graphics)\b", raw_name)
            name = name_match.group(1) if name_match else re.sub(r"\s*\[.*?\]\s*$", "", raw_name)
            name = re.sub(r"\s+", " ", name).strip()[:120]
            if not name:
                continue

            if name not in preferred_counts and name not in fallback_counts:
                names_in_order.append(name)

            if "level_zero:gpu" in line_lower or "level-zero" in line_lower:
                preferred_counts[name] = preferred_counts.get(name, 0) + 1
            else:
                fallback_counts[name] = fallback_counts.get(name, 0) + 1

        idx = 0
        for name in names_in_order:
            count = max(preferred_counts.get(name, 0), fallback_counts.get(name, 0))
            for _ in range(count):
                devices.append(
                    DetectedDevice(
                        hardware_id=f"intel:{idx}",
                        name=name,
                        vendor="intel",
                        device_type="gpu",
                        memory_mb=0,
                    )
                )
                idx += 1
        return devices

    def _detect_cpu(self) -> list[DetectedDevice]:
        cores = psutil.cpu_count(logical=False) or 1
        threads = psutil.cpu_count(logical=True) or cores
        memory_mb = int(psutil.virtual_memory().total / (1024 * 1024))
        return [
            DetectedDevice(
                hardware_id="cpu:0",
                name="CPU",
                vendor="cpu",
                device_type="cpu",
                memory_mb=memory_mb,
                max_threads=threads,
                max_slots=1,
            )
        ]

    def _detect_configured_devices(self) -> list[DetectedDevice]:
        vendors = get_supported_vendors()
        settings = get_settings()
        if not settings.supported_device_list():
            return []

        devices: list[DetectedDevice] = []
        cpu_device = self._detect_cpu()[0]
        if "cpu" in vendors:
            devices.append(cpu_device)
        if "nvidia" in vendors:
            devices.append(
                DetectedDevice(
                    hardware_id="nvidia:0",
                    name="NVIDIA GPU",
                    vendor="nvidia",
                    device_type="gpu",
                    memory_mb=0,
                )
            )
        if "amd" in vendors:
            devices.append(
                DetectedDevice(
                    hardware_id="amd:0",
                    name="AMD GPU",
                    vendor="amd",
                    device_type="gpu",
                    memory_mb=0,
                )
            )
        if "intel" in vendors:
            devices.append(
                DetectedDevice(
                    hardware_id="intel:0",
                    name="Intel GPU",
                    vendor="intel",
                    device_type="gpu",
                    memory_mb=0,
                )
            )
        return devices
