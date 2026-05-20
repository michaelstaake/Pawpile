import json
import logging
import re
import shlex
import subprocess
from dataclasses import dataclass

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
        configured = self._detect_configured_devices()
        if configured:
            return configured

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

        for row in existing.values():
            if not is_supported_vendor(row.vendor):
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
        idx = 0
        for line in output.splitlines():
            if "gpu" in line.lower() and "intel" in line.lower():
                devices.append(
                    DetectedDevice(
                        hardware_id=f"intel:{idx}",
                        name=line.strip()[:120],
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
