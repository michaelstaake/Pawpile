import logging
import re
import shlex
import subprocess
from dataclasses import dataclass
from pathlib import Path

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

    return {"cpu", "nvidia", "vulkan"}


def is_supported_vendor(vendor: str) -> bool:
    return vendor in get_supported_vendors()


@dataclass
class DetectedDevice:
    hardware_id: str
    stable_hardware_id: str | None
    stable_hardware_id_source: str | None
    name: str
    vendor: str
    device_type: str
    memory_mb: int
    max_threads: int = 0
    max_slots: int = 0


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
        # On Ubuntu, support NVIDIA, Vulkan, and CPU
        devices.extend(self._detect_nvidia())
        devices.extend(self._detect_vulkan())
        devices.extend(self._detect_cpu())
        return devices

    def sync_detected_devices(self, db: Session, *, auto_enable_defaults: bool = False) -> list[Device]:
        detected = self.detect_all()
        existing = {d.hardware_id: d for d in db.query(Device).all()}
        detected_ids = {device.hardware_id for device in detected}
        gpu_detected = any(device.device_type == "gpu" and device.vendor != "cpu" for device in detected)

        for row in existing.values():
            if not is_supported_vendor(row.vendor) or row.hardware_id not in detected_ids:
                row.enabled = False

        for d in detected:
            row = existing.get(d.hardware_id)
            enabled = self._should_auto_enable(d, gpu_detected) if auto_enable_defaults else False
            if row is None:
                row = Device(
                    hardware_id=d.hardware_id,
                    stable_hardware_id=d.stable_hardware_id,
                    stable_hardware_id_source=d.stable_hardware_id_source,
                    name=d.name,
                    vendor=d.vendor,
                    device_type=d.device_type,
                    memory_mb=d.memory_mb,
                    enabled=enabled,
                    max_threads=d.max_threads,
                    max_slots=d.max_slots,
                )
                db.add(row)
            else:
                row.stable_hardware_id = d.stable_hardware_id
                row.stable_hardware_id_source = d.stable_hardware_id_source
                row.name = d.name
                row.vendor = d.vendor
                row.device_type = d.device_type
                row.memory_mb = d.memory_mb
                if row.device_type == "cpu":
                    row.max_threads = d.max_threads or row.max_threads
                    row.max_slots = max(0, d.max_slots)
                if auto_enable_defaults:
                    row.enabled = enabled

        db.commit()
        return db.query(Device).order_by(Device.priority.asc(), Device.id.asc()).all()

    @staticmethod
    def _should_auto_enable(device: DetectedDevice, gpu_detected: bool) -> bool:
        if gpu_detected:
            return device.device_type == "gpu" and device.vendor != "cpu"

        return device.device_type == "cpu" or device.vendor == "cpu"

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
            stable_hardware_id = _normalize_optional_identifier(row.get("stable_hardware_id"))
            stable_hardware_id_source = _normalize_identifier_source(row.get("stable_hardware_id_source"))
            name = str(row["name"])
            vendor = str(row["vendor"])
            device_type = str(row.get("device_type", "gpu"))
            memory_mb = int(row.get("memory_mb", 0) or 0)
            max_threads = int(row.get("max_threads", 0) or 0)
            max_slots = int(row.get("max_slots", 0) or 0)
        except (KeyError, TypeError, ValueError):
            return None

        return DetectedDevice(
            hardware_id=hardware_id,
            stable_hardware_id=stable_hardware_id,
            stable_hardware_id_source=stable_hardware_id_source,
            name=name,
            vendor=vendor,
            device_type=device_type,
            memory_mb=memory_mb,
            max_threads=max_threads,
            max_slots=max(0, max_slots),
        )

    def _run(self, command: str) -> str:
        try:
            output = subprocess.check_output(shlex.split(command), stderr=subprocess.DEVNULL, text=True)
            return output.strip()
        except Exception as exc:
            logger.debug("Device probe command failed (%s): %s", command, exc)
            return ""

    def _detect_nvidia(self) -> list[DetectedDevice]:
        output = self._run("nvidia-smi --query-gpu=index,gpu_uuid,name,memory.total --format=csv,noheader,nounits")
        devices: list[DetectedDevice] = []
        for line in output.splitlines():
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 4:
                continue
            stable_hardware_id = _normalize_optional_identifier(parts[1])
            devices.append(
                DetectedDevice(
                    hardware_id=f"nvidia:{parts[0]}",
                    stable_hardware_id=stable_hardware_id,
                    stable_hardware_id_source="nvidia_uuid" if stable_hardware_id else None,
                    name=parts[2],
                    vendor="nvidia",
                    device_type="gpu",
                    memory_mb=int(parts[3] or "0"),
                    max_slots=0,
                )
            )
        return devices

    def _detect_vulkan(self) -> list[DetectedDevice]:
        if not is_supported_vendor("vulkan"):
            return []
        try:
            result = subprocess.run(
                ["vulkaninfo", "--summary"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            output = result.stdout.strip()
        except Exception as exc:
            logger.debug("Device probe command failed (vulkaninfo --summary): %s", exc)
            return []
        if not output:
            return []
        devices: list[DetectedDevice] = []
        # vulkaninfo --summary groups each physical device under a "GPU<N>:" header
        blocks = re.split(r"GPU(\d+):", output)
        # blocks layout: [preamble, idx0, block0, idx1, block1, ...]
        i = 1
        while i + 1 < len(blocks):

            idx = int(blocks[i])
            block = blocks[i + 1]
            i += 2

            name_match = re.search(r"deviceName\s*=\s*(.+)", block)
            type_match = re.search(r"deviceType\s*=\s*(.+)", block)
            if not name_match:
                continue

            name = name_match.group(1).strip()
            device_type_str = type_match.group(1).strip().lower() if type_match else ""
            # Skip software/CPU renderers (e.g. lavapipe, llvmpipe)
            if "cpu" in device_type_str or "virtual_gpu" in device_type_str:
                continue

            devices.append(
                DetectedDevice(
                    hardware_id=f"vulkan:{idx}",
                    stable_hardware_id=None,
                    stable_hardware_id_source=None,
                    name=name,
                    vendor="vulkan",
                    device_type="gpu",
                    memory_mb=0,
                )
            )

        if devices:
            memory_by_idx = self._parse_vulkan_device_memory()
            memory_by_idx.update(self._read_amdgpu_vram_totals())
            for device in devices:
                idx = int(device.hardware_id.split(":")[1])
                device.memory_mb = memory_by_idx.get(idx, 0)

        return devices

    def _parse_vulkan_device_memory(self) -> dict[int, int]:
        """Return vulkan device index -> device-local memory total (MiB) from full vulkaninfo output."""
        try:
            result = subprocess.run(
                ["vulkaninfo"],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                timeout=15,
            )
            output = result.stdout
        except Exception as exc:
            logger.debug("vulkaninfo full output failed: %s", exc)
            return {}
        return _parse_vulkaninfo_device_local_heap_mb(output)

    def _read_amdgpu_vram_totals(self) -> dict[int, int]:
        memory_by_idx: dict[int, int] = {}
        try:
            amd_card_paths = sorted(
                p.parent for p in Path("/sys/class/drm").glob("card*/device/gpu_busy_percent")
                if p.is_file()
            )
        except Exception:
            return memory_by_idx

        for vulkan_idx, device_path in enumerate(amd_card_paths):
            total_bytes = self._read_sysfs_int(device_path / "mem_info_vram_total")
            if total_bytes is None or total_bytes <= 0:
                continue
            memory_by_idx[vulkan_idx] = int(total_bytes / (1024 * 1024))

        return memory_by_idx

    @staticmethod
    def _read_sysfs_int(path: Path) -> int | None:
        try:
            return int(path.read_text().strip())
        except Exception:
            return None

    def _detect_cpu(self) -> list[DetectedDevice]:
        cores = psutil.cpu_count(logical=False) or 1
        threads = psutil.cpu_count(logical=True) or cores
        memory_mb = int(psutil.virtual_memory().total / (1024 * 1024))
        return [
            DetectedDevice(
                hardware_id="cpu:0",
                stable_hardware_id=None,
                stable_hardware_id_source=None,
                name="CPU",
                vendor="cpu",
                device_type="cpu",
                memory_mb=memory_mb,
                max_threads=threads,
                max_slots=0,
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
                    stable_hardware_id=None,
                    stable_hardware_id_source=None,
                    name="NVIDIA GPU",
                    vendor="nvidia",
                    device_type="gpu",
                    memory_mb=0,
                    max_slots=0,
                )
            )
        if "vulkan" in vendors:
            devices.append(
                DetectedDevice(
                    hardware_id="vulkan:0",
                    stable_hardware_id=None,
                    stable_hardware_id_source=None,
                    name="Vulkan GPU",
                    vendor="vulkan",
                    device_type="gpu",
                    memory_mb=0,
                    max_slots=0,
                )
            )
        return devices


def _parse_vulkaninfo_device_local_heap_mb(output: str) -> dict[int, int]:
    """Parse device-local heap total size (MiB) per GPU index from full vulkaninfo text output.

    Returns a dict mapping Vulkan device index to total device-local memory in MiB.
    Parses the ``memoryHeaps[N]:`` blocks for ``VK_MEMORY_HEAP_DEVICE_LOCAL_BIT`` and
    extracts the ``size`` field.  Units handled: ``MiB``, ``GiB``, plain bytes.
    """
    memory_by_idx: dict[int, int] = {}
    # Split by "GPU<N>:" headers (same pattern used in --summary parsing)
    blocks = re.split(r"GPU(\d+):", output)
    # blocks layout: [preamble, idx0, block0, idx1, block1, ...]
    i = 1
    while i + 1 < len(blocks):
        try:
            idx = int(blocks[i])
        except ValueError:
            i += 2
            continue
        block = blocks[i + 1]
        i += 2

        heap_blocks = re.split(r"memoryHeaps\[\d+\]:", block)
        device_local_mb = 0
        for heap_block in heap_blocks[1:]:
            if "VK_MEMORY_HEAP_DEVICE_LOCAL_BIT" not in heap_block:
                continue
            size_match = re.search(r"\bsize\s*=\s*([\d.]+)\s*(MiB|GiB|bytes|B)?", heap_block, re.IGNORECASE)
            if not size_match:
                continue
            size_mb = _vulkan_size_to_mb(float(size_match.group(1)), size_match.group(2))
            device_local_mb = max(device_local_mb, size_mb)

        if device_local_mb > 0:
            memory_by_idx[idx] = device_local_mb

    return memory_by_idx


def _vulkan_size_to_mb(value: float, unit: str | None) -> int:
    unit = (unit or "bytes").lower()
    if unit == "mib":
        return int(value)
    if unit == "gib":
        return int(value * 1024)
    if unit in ("bytes", "b"):
        return int(value / (1024 * 1024))
    # Unknown unit — if the value looks like it's already in MiB (< 1 million) keep it,
    # otherwise assume bytes.
    if value < 1_000_000:
        return int(value)
    return int(value / (1024 * 1024))


def build_device_display_suffix(stable_hardware_id: str | None, hardware_id: str) -> str:
    source_value = stable_hardware_id or hardware_id
    compact_value = re.sub(r"[^A-Za-z0-9]", "", source_value)
    suffix = (compact_value or source_value)[-4:].upper()
    return suffix if suffix else "????"


def _normalize_optional_identifier(value: object) -> str | None:
    if value is None:
        return None

    normalized = str(value).strip()
    if not normalized or normalized.upper() in {"N/A", "NONE", "UNKNOWN"}:
        return None

    return normalized


def _normalize_identifier_source(value: object) -> str | None:
    normalized = _normalize_optional_identifier(value)
    return normalized.lower() if normalized else None
