from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user
from app.core.activity_logger import log_event
from app.core.config import get_settings
from app.core.db import get_db
from app.core.device_manager import DeviceManager, get_supported_vendors
from app.models.device import Device
from app.models.gpu_pool import GpuPool, GpuPoolDevice
from app.models.model_config import ModelConfig
from app.models.user import User
from app.utils.schemas import DeviceReorderRequest, DeviceUpdateRequest, GpuPoolCreateRequest, GpuPoolUpdateRequest

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

    enabled_before = device.enabled

    for field in ["name", "enabled", "priority", "max_threads", "max_slots"]:
        value = getattr(payload, field)
        if value is not None:
            setattr(device, field, value)

    db.add(device)
    db.commit()
    db.refresh(device)

    if payload.enabled is not None and payload.enabled != enabled_before:
        event_type = "device.enabled" if device.enabled else "device.disabled"
        log_event(db, event_type, details={"device_name": device.name, "hardware_id": device.hardware_id})
    elif payload.enabled is None:
        log_event(db, "device.updated", details={"device_name": device.name, "hardware_id": device.hardware_id})

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


# ---------------------------------------------------------------------------
# GPU Pool endpoints
# ---------------------------------------------------------------------------


@router.get("/pool")
def get_pool(_: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict | None:
    pool = db.query(GpuPool).first()
    if not pool:
        return None
    return _serialize_pool(pool, db)


@router.post("/pool")
def create_pool(payload: GpuPoolCreateRequest, _: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    existing = db.query(GpuPool).first()
    if existing:
        raise HTTPException(status_code=409, detail="A GPU pool already exists. Delete it before creating a new one.")

    devices = _validate_pool_devices(payload.device_ids, db)

    pool = GpuPool(name=payload.name)
    db.add(pool)
    db.flush()

    for device in devices:
        db.add(GpuPoolDevice(pool_id=pool.id, device_id=device.id))

    db.commit()
    db.refresh(pool)

    log_event(db, "pool.created", details={"pool_name": pool.name, "device_ids": payload.device_ids})
    return {"status": "ok", "pool": _serialize_pool(pool, db)}


@router.patch("/pool")
def update_pool(payload: GpuPoolUpdateRequest, _: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    pool = db.query(GpuPool).first()
    if not pool:
        raise HTTPException(status_code=404, detail="No GPU pool exists")

    devices = _validate_pool_devices(payload.device_ids, db)

    db.query(GpuPoolDevice).filter(GpuPoolDevice.pool_id == pool.id).delete()
    for device in devices:
        db.add(GpuPoolDevice(pool_id=pool.id, device_id=device.id))

    db.commit()
    db.refresh(pool)

    log_event(db, "pool.updated", details={"pool_name": pool.name, "device_ids": payload.device_ids})
    return {"status": "ok", "pool": _serialize_pool(pool, db)}


@router.delete("/pool")
def delete_pool(_: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    pool = db.query(GpuPool).first()
    if not pool:
        raise HTTPException(status_code=404, detail="No GPU pool exists")

    # Deactivate and revert any models pinned to this pool
    from app.core.inference_manager import InferenceManager
    inference: InferenceManager = router.inference_manager  # type: ignore[attr-defined]

    pool_models = db.query(ModelConfig).filter(
        ModelConfig.assignment_mode == "pool",
        ModelConfig.pinned_pool_id == pool.id,
    ).all()
    for model in pool_models:
        if model.activated:
            inference.deactivate_model(model.id)
            model.activated = False
        model.assignment_mode = "auto"
        model.pinned_pool_id = None
        db.add(model)

    db.flush()

    # Cascade deletes gpu_pool_devices rows via FK ondelete=CASCADE
    db.delete(pool)
    db.commit()

    log_event(db, "pool.deleted", details={})
    return {"status": "ok"}


def _validate_pool_devices(device_ids: list[int], db: Session) -> list[Device]:
    if len(device_ids) < 2:
        raise HTTPException(status_code=400, detail="A GPU pool requires at least two devices")

    devices: list[Device] = []
    for device_id in device_ids:
        device = db.query(Device).filter(Device.id == device_id).first()
        if not device:
            raise HTTPException(status_code=404, detail=f"Device {device_id} not found")
        if device.vendor != "nvidia":
            raise HTTPException(status_code=400, detail=f"Device {device.name} is not an NVIDIA GPU and cannot be added to the pool")
        devices.append(device)

    return devices


def _serialize_pool(pool: GpuPool, db: Session) -> dict:
    pool_device_rows = db.query(GpuPoolDevice).filter(GpuPoolDevice.pool_id == pool.id).all()
    device_ids = [row.device_id for row in pool_device_rows]
    devices = db.query(Device).filter(Device.id.in_(device_ids)).all()
    return {
        "id": pool.id,
        "name": pool.name,
        "devices": [_serialize_device(d) for d in devices],
    }


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
