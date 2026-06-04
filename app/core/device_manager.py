import json
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
from app.core.gpu_pool_manager import delete_unavailable_devices
from app.models.device import Device

logger = logging.getLogger(__name__)

AMD_VENDOR_ID = 0x1002

_GENERIC_AMD_GPU_NAMES = frozenset(
    {
        "amd radeon graphics",
        "radeon graphics",
        "amd radeon",
        "unknown",
        "n/a",
    }
)


@dataclass
class AmdGpuSysfsInfo:
    pci_bdf: str
    product_name: str | None = None
    unique_id: str | None = None


def _is_generic_amd_gpu_name(name: str) -> bool:
    normalized = name.strip().lower()
    if not normalized or normalized in _GENERIC_AMD_GPU_NAMES:
        return True
    return bool(re.fullmatch(r"amd gpu \d+", normalized))


def _format_rocm_display_name(
    rocm_name: str,
    *,
    memory_mb: int,
    hardware_id: str,
    pci_bdf: str | None,
    unique_id: str | None,
) -> str:
    candidates: list[str] = []
    for value in (rocm_name,):
        cleaned = str(value).strip()
        if cleaned and not _is_generic_amd_gpu_name(cleaned):
            candidates.append(cleaned)

    index = hardware_id.rsplit(":", 1)[-1]
    if memory_mb >= 16_384:
        vram_label = f"{memory_mb // 1024} GB"
    elif memory_mb > 0:
        vram_label = f"{memory_mb:,} MB"
    else:
        vram_label = ""

    if candidates:
        base = candidates[0]
    else:
        parts = [f"AMD GPU {index}"]
        if vram_label:
            parts.append(vram_label)
        base = " · ".join(parts)

    suffix_parts: list[str] = []
    if pci_bdf:
        suffix_parts.append(pci_bdf)
    if unique_id:
        short_id = unique_id.strip()
        if len(short_id) > 12:
            short_id = f"{short_id[:6]}…{short_id[-4:]}"
        suffix_parts.append(f"ID {short_id}")

    if suffix_parts:
        return f"{base} ({', '.join(suffix_parts)})"[:120]

    return base[:120]


def get_supported_vendors() -> set[str]:
    settings = get_settings()
    configured = settings.supported_device_list()
    if configured:
        return set(configured)

    return {"cpu", "nvidia", "vulkan", "rocm"}


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
    pci_vendor_id: int | None = None


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
        hide_vulkan_amd = self._should_hide_vulkan_amd()
        devices.extend(self._detect_nvidia())
        devices.extend(self._detect_rocm())
        devices.extend(self._detect_vulkan(exclude_amd=hide_vulkan_amd))
        devices.extend(self._detect_cpu())
        return devices

    def _should_hide_vulkan_amd(self) -> bool:
        if not is_supported_vendor("rocm"):
            return False

        settings = get_settings()
        runtime_map = settings.inference_runtime_url_map()
        rocm_url = runtime_map.get("rocm")
        if not rocm_url:
            return len(self._detect_rocm()) > 0

        timeout = settings.inference_service_timeout_seconds
        try:
            with httpx.Client(timeout=timeout) as client:
                response = client.get(f"{rocm_url}/health")
                response.raise_for_status()
        except Exception:
            return False

        return True

    def sync_detected_devices(self, db: Session, *, auto_enable_defaults: bool = False) -> list[Device]:
        detected = self.detect_all()
        existing = {d.hardware_id: d for d in db.query(Device).all()}
        detected_ids = {device.hardware_id for device in detected}
        gpu_detected = any(device.device_type == "gpu" and device.vendor != "cpu" for device in detected)

        removed_device_ids = delete_unavailable_devices(db, detected_ids)
        if removed_device_ids:
            logger.info(
                "Removed %s device(s) no longer reported by active runtimes: %s",
                len(removed_device_ids),
                removed_device_ids,
            )
            existing = {d.hardware_id: d for d in db.query(Device).all()}

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
                if _is_generic_amd_gpu_name(row.name) or row.name.strip() == d.name.strip():
                    row.name = d.name
                row.vendor = d.vendor
                row.device_type = d.device_type
                row.memory_mb = d.memory_mb
                if row.device_type == "cpu":
                    row.max_threads = d.max_threads or row.max_threads
                    row.max_slots = max(0, d.max_slots)

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
        rocm_runtime_ok = False

        for runtime_vendor, base_url in runtime_map.items():
            try:
                with httpx.Client(timeout=timeout) as client:
                    response = client.get(f"{base_url}/runtime/devices")
                    response.raise_for_status()
            except Exception as exc:
                logger.warning("Failed to fetch devices from runtime %s at %s: %s", runtime_vendor, base_url, exc)
                continue

            if runtime_vendor == "rocm":
                rocm_runtime_ok = True

            payload = response.json()
            rows = payload.get("devices", []) if isinstance(payload, dict) else []
            for row in rows:
                device = self._parse_runtime_device(row)
                if not device:
                    continue
                if runtime_vendor != "default" and device.vendor != runtime_vendor:
                    continue
                if rocm_runtime_ok and device.vendor == "vulkan" and device.pci_vendor_id == AMD_VENDOR_ID:
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
            pci_vendor_raw = row.get("pci_vendor_id")
            pci_vendor_id = int(pci_vendor_raw) if pci_vendor_raw is not None else None
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
            pci_vendor_id=pci_vendor_id,
        )

    def _detect_rocm(self) -> list[DetectedDevice]:
        if not is_supported_vendor("rocm"):
            return []

        json_output = self._run("rocm-smi --showproductname --showmeminfo vram --json")
        devices = self._parse_rocm_json(json_output)
        if devices:
            self._enrich_rocm_devices(devices)
            return devices

        text_devices = self._parse_rocm_text(self._run("rocm-smi --showproductname --showmeminfo vram"))
        self._enrich_rocm_devices(text_devices)
        return text_devices

    @staticmethod
    def _parse_rocm_json(json_output: str) -> list[DetectedDevice]:
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

            name = _rocm_product_name_from_entry(entry) or f"AMD GPU {index}"

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
                    hardware_id=f"rocm:{index}",
                    stable_hardware_id=None,
                    stable_hardware_id_source=None,
                    name=str(name)[:120],
                    vendor="rocm",
                    device_type="gpu",
                    memory_mb=int(memory_bytes / (1024 * 1024)) if memory_bytes else 0,
                    max_slots=0,
                )
            )
        return devices

    @staticmethod
    def _parse_rocm_text(text_output: str) -> list[DetectedDevice]:
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
                    hardware_id=f"rocm:{index}",
                    stable_hardware_id=None,
                    stable_hardware_id_source=None,
                    name=f"AMD GPU {index}",
                    vendor="rocm",
                    device_type="gpu",
                    memory_mb=int(memory_bytes / (1024 * 1024)),
                    max_slots=0,
                )
            )
        return devices

    def _enrich_rocm_devices(self, devices: list[DetectedDevice]) -> None:
        card_infos = _read_amdgpu_card_infos()
        unique_ids = _parse_rocm_unique_ids(self._run("rocm-smi --showuniqueid --json"))

        for index, device in enumerate(devices):
            rocm_index = int(device.hardware_id.rsplit(":", 1)[-1])
            info = card_infos[index] if index < len(card_infos) else None
            pci_bdf = info.pci_bdf if info else None
            if pci_bdf:
                device.stable_hardware_id = pci_bdf
                device.stable_hardware_id_source = "pci_bdf"

            device.name = _format_rocm_display_name(
                device.name,
                memory_mb=device.memory_mb,
                hardware_id=device.hardware_id,
                pci_bdf=pci_bdf,
                unique_id=unique_ids.get(rocm_index),
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

    def _detect_vulkan(self, *, exclude_amd: bool = False) -> list[DetectedDevice]:
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
        amd_vulkan_indices: list[int] = []
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
            vendor_id = _parse_vulkan_vendor_id(block)
            # Skip software/CPU renderers (e.g. lavapipe, llvmpipe)
            if "cpu" in device_type_str or "virtual_gpu" in device_type_str:
                continue

            if vendor_id == AMD_VENDOR_ID:
                amd_vulkan_indices.append(idx)
                if exclude_amd:
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
                    pci_vendor_id=vendor_id,
                )
            )

        if devices:
            memory_by_idx = self._parse_vulkan_device_memory()
            memory_by_idx.update(self._read_amdgpu_vram_totals(amd_vulkan_indices))
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

    def _read_amdgpu_vram_totals(self, amd_vulkan_indices: list[int]) -> dict[int, int]:
        memory_by_idx: dict[int, int] = {}
        if not amd_vulkan_indices:
            return memory_by_idx
        try:
            amd_card_paths = sorted(
                p.parent for p in Path("/sys/class/drm").glob("card*/device/gpu_busy_percent")
                if p.is_file()
            )
        except Exception:
            return memory_by_idx

        for vulkan_idx, device_path in zip(amd_vulkan_indices, amd_card_paths, strict=False):
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
        if "rocm" in vendors:
            devices.append(
                DetectedDevice(
                    hardware_id="rocm:0",
                    stable_hardware_id=None,
                    stable_hardware_id_source=None,
                    name="ROCm GPU",
                    vendor="rocm",
                    device_type="gpu",
                    memory_mb=0,
                    max_slots=0,
                )
            )
        return devices


def _rocm_product_name_from_entry(entry: dict) -> str | None:
    preferred_keys = (
        "card series",
        "card model",
        "card vendor",
        "marketing name",
        "product name",
        "sku",
    )
    for preferred in preferred_keys:
        for key, value in entry.items():
            if key.strip().lower() == preferred:
                cleaned = str(value).strip()
                if cleaned and not _is_generic_amd_gpu_name(cleaned):
                    return cleaned

    for key, value in entry.items():
        key_lower = key.lower()
        if not any(token in key_lower for token in ("series", "model", "product", "marketing", "sku", "vendor")):
            continue
        cleaned = str(value).strip()
        if cleaned and not _is_generic_amd_gpu_name(cleaned):
            return cleaned

    for key in ("Card series", "Card Series", "Card model", "Card Model"):
        cleaned = str(entry.get(key, "")).strip()
        if cleaned:
            return cleaned
    return None


def _parse_rocm_unique_ids(json_output: str) -> dict[int, str]:
    if not json_output:
        return {}
    try:
        data = json.loads(json_output)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}

    unique_ids: dict[int, str] = {}
    for card_key, entry in data.items():
        if not card_key.lower().startswith("card") or not isinstance(entry, dict):
            continue
        index = int(re.sub(r"\D", "", card_key) or "0")
        for key, value in entry.items():
            if "unique" in key.lower() and str(value).strip():
                unique_ids[index] = str(value).strip()
                break
    return unique_ids


def _read_amdgpu_card_infos() -> list[AmdGpuSysfsInfo]:
    infos: list[AmdGpuSysfsInfo] = []
    try:
        card_paths = sorted(
            p.parent for p in Path("/sys/class/drm").glob("card*/device/gpu_busy_percent") if p.is_file()
        )
    except Exception:
        return infos

    for device_path in card_paths:
        pci_bdf = ""
        uevent_path = device_path / "uevent"
        try:
            uevent = uevent_path.read_text()
            match = re.search(r"PCI_SLOT_NAME=(\S+)", uevent)
            if match:
                pci_bdf = match.group(1)
        except Exception:
            continue

        product_name: str | None = None
        for key in ("product_name", "marketing_name"):
            path = device_path / key
            if path.is_file():
                try:
                    product_name = path.read_text().strip() or None
                except Exception:
                    product_name = None
                if product_name:
                    break

        infos.append(AmdGpuSysfsInfo(pci_bdf=pci_bdf, product_name=product_name))
    return infos


def _read_amdgpu_pci_bdfs() -> list[str]:
    return [info.pci_bdf for info in _read_amdgpu_card_infos() if info.pci_bdf]


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


def _parse_vulkan_vendor_id(block: str) -> int | None:
    match = re.search(r"vendorID\s*=\s*(0x[0-9a-fA-F]+|\d+)", block)
    if not match:
        return None

    raw_value = match.group(1)
    try:
        return int(raw_value, 16 if raw_value.lower().startswith("0x") else 10)
    except ValueError:
        return None


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
    if stable_hardware_id and re.fullmatch(
        r"[\da-f]{4}:[\da-f]{2}:[\da-f]{2}\.\d",
        stable_hardware_id.strip(),
        flags=re.IGNORECASE,
    ):
        return stable_hardware_id.strip().upper()

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
