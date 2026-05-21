from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user
from app.core.config import get_settings
from app.core.db import get_db
from app.core.device_manager import DeviceManager, get_supported_vendors
from app.models.device import Device
from app.models.user import User
from app.utils.schemas import DeviceReorderRequest, DeviceUpdateRequest

router = APIRouter(prefix="/api/devices", tags=["devices"])
device_manager = DeviceManager()


@router.get("")
def list_devices(_: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(Device).order_by(Device.priority.asc(), Device.id.asc()).all()
    supported_vendors = get_supported_vendors()
    settings = get_settings()
    has_cpu_row = any(row.hardware_id == "cpu:0" and row.vendor == "cpu" for row in rows)
    has_supported_rows = any(row.vendor in supported_vendors for row in rows)
    uses_runtime_discovery = any(vendor != "default" for vendor in settings.inference_runtime_url_map())

    if uses_runtime_discovery or not rows or ("cpu" in supported_vendors and not has_cpu_row) or not has_supported_rows:
        rows = device_manager.sync_detected_devices(db)
    return [_serialize_device(d) for d in rows]


@router.patch("/{device_id}")
def update_device(device_id: int, payload: DeviceUpdateRequest, _: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    for field in ["name", "enabled", "priority", "max_threads", "max_slots"]:
        value = getattr(payload, field)
        if value is not None:
            setattr(device, field, value)

    db.add(device)
    db.commit()
    db.refresh(device)
    return {"status": "ok", "device": _serialize_device(device)}


@router.post("/reorder")
def reorder_devices(payload: DeviceReorderRequest, _: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    for item in payload.devices:
        device = db.query(Device).filter(Device.id == item.id).first()
        if device:
            device.priority = item.priority
            db.add(device)
    db.commit()
    return {"status": "ok"}


def _serialize_device(device: Device) -> dict:
    return {
        "id": device.id,
        "hardware_id": device.hardware_id,
        "name": device.name,
        "vendor": device.vendor,
        "device_type": device.device_type,
        "memory_mb": device.memory_mb,
        "enabled": device.enabled,
        "priority": device.priority,
        "max_threads": device.max_threads,
        "max_slots": device.max_slots,
    }
