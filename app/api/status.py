from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.device_manager import build_device_display_suffix
from app.core.db import get_db
from app.core.inference_manager import InferenceManager
from app.models.device import Device
from app.models.model_config import ModelConfig

router = APIRouter(prefix="/api/status", tags=["status"])


@router.get("")
async def get_status(db: Session = Depends(get_db)) -> dict:
    inference: InferenceManager = router.inference_manager  # type: ignore[attr-defined]
    settings = get_settings()
    devices = db.query(Device).order_by(Device.priority.asc(), Device.id.asc()).all()
    models_by_id = {model.id: model for model in db.query(ModelConfig).all()}
    runtime_devices, runtime_errors = await _fetch_runtime_devices(settings)
    fallback_models_by_device_id: dict[int, list[dict]] = {}
    # pool_model_device_ids maps model_id -> set of device IDs it spans (for pool models)
    pool_model_device_ids: dict[int, set[int]] = {}

    for running in inference._running.values():
        model = models_by_id.get(running.model_id)
        entry = {
            "model_id": running.model_id,
            "alias": model.alias if model else f"Model {running.model_id}",
            "memory_used_mb": 0,
            "pid": None,
        }
        if running.pool_device_ids:
            pool_model_device_ids[running.model_id] = set(running.pool_device_ids)
            for device_id in running.pool_device_ids:
                fallback_models_by_device_id.setdefault(device_id, []).append(entry)
        elif running.device_id is not None:
            fallback_models_by_device_id.setdefault(running.device_id, []).append(entry)

    serialized_devices: list[dict] = []
    for device in devices:
        runtime_device = runtime_devices.get(device.hardware_id, {})
        runtime_models = runtime_device.get("models")
        raw_models = list(runtime_models) if isinstance(runtime_models, list) and runtime_models else list(fallback_models_by_device_id.get(device.id, []))

        # For pool models that the runtime only reports on the primary GPU,
        # inject them into all other pool member devices as well.
        raw_model_ids = {row.get("model_id") for row in raw_models if isinstance(row, dict)}
        for model_id, device_ids in pool_model_device_ids.items():
            if device.id in device_ids and model_id not in raw_model_ids:
                model = models_by_id.get(model_id)
                raw_models.append({
                    "model_id": model_id,
                    "alias": model.alias if model else f"Model {model_id}",
                    "memory_used_mb": 0,
                    "pid": None,
                })

        models = [_serialize_status_model(row, models_by_id) for row in raw_models]
        models.sort(key=lambda row: row["model_id"])

        memory_used_mb = _coalesce_int(runtime_device.get("memory_used_mb"))
        if memory_used_mb is None:
            memory_used_mb = sum(model["memory_used_mb"] for model in models)

        usage_percent = _coalesce_float(runtime_device.get("usage_percent"))
        usage_source = runtime_device.get("usage_source") if usage_percent is not None else None

        serialized_devices.append(
            {
                "id": device.id,
                "hardware_id": device.hardware_id,
                "stable_hardware_id": device.stable_hardware_id,
                "stable_hardware_id_source": device.stable_hardware_id_source,
                "display_suffix": build_device_display_suffix(device.stable_hardware_id, device.hardware_id),
                "name": device.name,
                "vendor": device.vendor,
                "device_type": device.device_type,
                "enabled": device.enabled,
                "priority": device.priority,
                "max_slots": device.max_slots,
                "max_threads": device.max_threads,
                "memory_total_mb": _coalesce_int(runtime_device.get("memory_total_mb")) or device.memory_mb,
                "memory_used_mb": memory_used_mb,
                "usage_percent": usage_percent,
                "usage_source": usage_source or "unavailable",
                "memory_source": runtime_device.get("memory_source") or "processes",
                "models": models,
            }
        )

    return {
        "status": "ok",
        "refreshed_at": datetime.now(timezone.utc).isoformat(),
        "devices": serialized_devices,
        "runtime_errors": runtime_errors,
    }


async def _fetch_runtime_devices(settings) -> tuple[dict[str, dict], list[dict]]:
    runtime_map = settings.inference_runtime_url_map()
    devices: dict[str, dict] = {}
    errors: list[dict] = []

    async with httpx.AsyncClient(timeout=settings.inference_service_timeout_seconds) as client:
        for vendor_key, base_url in runtime_map.items():
            try:
                response = await client.get(f"{base_url}/runtime/status")
                response.raise_for_status()
            except Exception as exc:
                errors.append({"vendor": vendor_key, "base_url": base_url, "detail": str(exc)})
                continue

            payload = response.json()
            rows = payload.get("devices", []) if isinstance(payload, dict) else []
            for row in rows:
                hardware_id = row.get("hardware_id") if isinstance(row, dict) else None
                if not hardware_id:
                    continue
                devices[str(hardware_id)] = row

    return devices, errors


def _serialize_status_model(row: dict, models_by_id: dict[int, ModelConfig]) -> dict:
    model_id = _coalesce_int(row.get("model_id")) or 0
    model = models_by_id.get(model_id)
    return {
        "model_id": model_id,
        "alias": row.get("alias") or (model.alias if model else f"Model {model_id}"),
        "file_name": model.file_name if model else "",
        "memory_used_mb": _coalesce_int(row.get("memory_used_mb")) or 0,
        "pid": _coalesce_int(row.get("pid")),
    }


def _coalesce_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coalesce_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None