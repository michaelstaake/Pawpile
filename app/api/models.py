import os
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.deps import get_admin_user
from app.core.config import get_settings
from app.core.db import get_db
from app.core.device_manager import is_supported_vendor
from app.core.inference_manager import InferenceManager
from app.models.device import Device
from app.models.model_config import ModelConfig
from app.models.user import User
from app.utils.schemas import ModelReorderRequest, ModelUpdateRequest

router = APIRouter(prefix="/api/models", tags=["models"])

ALLOWED_ASSIGNMENT_MODES = {"auto", "pinned"}
UPLOAD_CHUNK_BYTES = 1024 * 1024


@router.get("")
def list_models(_: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> list[dict]:
    rows = db.query(ModelConfig).order_by(ModelConfig.priority.asc(), ModelConfig.id.asc()).all()
    return [_serialize_model(m) for m in rows]


@router.post("/reorder")
def reorder_models(payload: ModelReorderRequest, _: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    for item in payload.models:
        model = db.query(ModelConfig).filter(ModelConfig.id == item.id).first()
        if model:
            model.priority = item.priority
            db.add(model)
    db.commit()
    return {"status": "ok"}


@router.post("/upload")
def upload_model(
    file: UploadFile = File(...),
    _: User = Depends(get_admin_user),
    db: Session = Depends(get_db),
) -> dict:
    file_name = Path(file.filename or "").name
    if not file_name:
        raise HTTPException(status_code=400, detail="Missing file name")
    if Path(file_name).suffix.lower() != ".gguf":
        raise HTTPException(status_code=400, detail="Only .gguf model files are supported")

    settings = get_settings()
    models_dir = Path(settings.models_dir)
    models_dir.mkdir(parents=True, exist_ok=True)
    destination = models_dir / file_name

    existing_model = db.query(ModelConfig).filter(ModelConfig.file_name == file_name).first()
    if existing_model or destination.exists():
        raise HTTPException(status_code=409, detail="A model with that file name already exists")

    max_bytes = max(1, settings.max_upload_size_mb) * 1024 * 1024
    written = 0
    try:
        with destination.open("wb") as output:
            while True:
                chunk = file.file.read(UPLOAD_CHUNK_BYTES)
                if not chunk:
                    break
                written += len(chunk)
                if written > max_bytes:
                    output.close()
                    destination.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"Uploaded file exceeds the {settings.max_upload_size_mb} MB limit",
                    )
                output.write(chunk)
    except OSError as exc:
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Failed to store uploaded model") from exc
    finally:
        file.file.close()

    model = ModelConfig(
        priority=_next_model_priority(db),
        file_name=file_name,
        file_path=str(destination.resolve()),
        alias=_build_unique_alias(db, Path(file_name).stem),
        context_length=settings.default_context_length,
        gpu_layers=settings.default_gpu_layers,
        threads=settings.default_threads,
    )
    try:
        db.add(model)
        db.commit()
        db.refresh(model)
    except SQLAlchemyError as exc:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="Uploaded model could not be registered") from exc

    return {"status": "ok", "model": _serialize_model(model)}


@router.post("/scan")
def scan_models(_: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    settings = get_settings()
    os.makedirs(settings.models_dir, exist_ok=True)
    files = [f for f in os.listdir(settings.models_dir) if f.lower().endswith(".gguf")]

    existing_by_file = {m.file_name: m for m in db.query(ModelConfig).all()}
    added = 0
    for file_name in files:
        if file_name in existing_by_file:
            continue
        model = ModelConfig(
            priority=_next_model_priority(db),
            file_name=file_name,
            file_path=os.path.abspath(os.path.join(settings.models_dir, file_name)),
            alias=_build_unique_alias(db, os.path.splitext(file_name)[0]),
            context_length=settings.default_context_length,
            gpu_layers=settings.default_gpu_layers,
            threads=settings.default_threads,
        )
        db.add(model)
        added += 1

    db.commit()
    return {"status": "ok", "discovered": len(files), "added": added}


@router.patch("/{model_id}")
def update_model(model_id: int, payload: ModelUpdateRequest, _: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    model = db.query(ModelConfig).filter(ModelConfig.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    if payload.assignment_mode is not None and payload.assignment_mode not in ALLOWED_ASSIGNMENT_MODES:
        raise HTTPException(status_code=400, detail="Invalid assignment mode")

    if payload.pinned_device_id is not None:
        pinned_device = db.query(Device).filter(Device.id == payload.pinned_device_id).first()
        if not pinned_device:
            raise HTTPException(status_code=404, detail="Pinned device not found")

    if payload.alias is not None:
        alias_conflict = (
            db.query(ModelConfig)
            .filter(ModelConfig.alias == payload.alias, ModelConfig.id != model_id)
            .first()
        )
        if alias_conflict:
            raise HTTPException(status_code=409, detail="A model with that alias already exists")

    for field in [
        "alias",
        "description",
        "system_prompt",
        "chat_template",
        "context_length",
        "gpu_layers",
        "threads",
        "assignment_mode",
        "pinned_device_id",
    ]:
        value = getattr(payload, field)
        if value is not None:
            setattr(model, field, value)

    db.add(model)
    db.commit()
    db.refresh(model)
    return {"status": "ok", "model": _serialize_model(model)}


@router.post("/{model_id}/activate")
async def activate_model(model_id: int, _: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    inference: InferenceManager = router.inference_manager  # type: ignore[attr-defined]
    model = db.query(ModelConfig).filter(ModelConfig.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    device = await _resolve_device_for_model(db, model, inference)
    if not device:
        raise HTTPException(status_code=409, detail="No enabled device available for model")

    try:
        await inference.activate_model(model, device)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    model.activated = True
    db.add(model)
    db.commit()
    return {"status": "ok", "model_id": model.id, "device_id": device.id}


@router.post("/{model_id}/deactivate")
def deactivate_model(model_id: int, _: User = Depends(get_admin_user), db: Session = Depends(get_db)) -> dict:
    inference: InferenceManager = router.inference_manager  # type: ignore[attr-defined]
    model = db.query(ModelConfig).filter(ModelConfig.id == model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    inference.deactivate_model(model.id)
    model.activated = False
    db.add(model)
    db.commit()
    return {"status": "ok"}


async def _resolve_device_for_model(db: Session, model: ModelConfig, inference: InferenceManager) -> Device | None:
    supported_vendors = [vendor for vendor in ["cpu", "nvidia", "amd", "intel"] if is_supported_vendor(vendor)]
    model_size_mb = _estimate_model_size_mb(model.file_path)
    memory_metrics = await inference.get_device_memory_mb()

    if model.assignment_mode == "pinned" and model.pinned_device_id:
        device = (
            db.query(Device)
            .filter(Device.id == model.pinned_device_id, Device.enabled.is_(True), Device.vendor.in_(supported_vendors))
            .first()
        )
        if device and not inference.has_runtime_for_vendor(device.vendor):
            raise HTTPException(
                status_code=409,
                detail=f"No inference runtime configured for pinned device vendor: {device.vendor}",
            )
        if device and model_size_mb > 0:
            metrics = memory_metrics.get(device.hardware_id, {})
            total_mb = metrics.get("total_mb", 0)
            available_mb = metrics.get("available_mb", 0)
            # Only reject if we have valid total metrics (total=0 means metrics unavailable)
            if total_mb > 0 and model_size_mb > available_mb:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        f"Model requires ~{model_size_mb} MB but {device.name} only has "
                        f"{available_mb} MB available"
                    ),
                )
        return device

    # AUTO mode — prefer GPUs, fall back to CPU
    candidates = (
        db.query(Device)
        .filter(Device.enabled.is_(True), Device.vendor.in_(supported_vendors))
        .all()
    )

    gpu_candidates = [c for c in candidates if c.vendor != "cpu" and inference.has_runtime_for_vendor(c.vendor)]
    cpu_candidates = [c for c in candidates if c.vendor == "cpu" and inference.has_runtime_for_vendor(c.vendor)]

    if not gpu_candidates and not cpu_candidates:
        if candidates:
            raise HTTPException(status_code=409, detail="No inference runtime configured for any enabled device")
        return None

    # Try GPUs first
    if gpu_candidates:
        if model_size_mb > 0 and memory_metrics:
            # Separate into GPUs with valid metrics vs unknown (total=0 means metrics unavailable)
            fitting: list[tuple[Device, int]] = []
            unknown: list[Device] = []
            for gpu in gpu_candidates:
                metrics = memory_metrics.get(gpu.hardware_id, {})
                total_mb = metrics.get("total_mb", 0)
                available_mb = metrics.get("available_mb", 0)
                if total_mb == 0:
                    unknown.append(gpu)  # No metrics — treat as potentially compatible
                elif available_mb >= model_size_mb:
                    fitting.append((gpu, available_mb))

            if fitting:
                # Pick the GPU with the most available VRAM
                fitting.sort(key=lambda x: x[1], reverse=True)
                return fitting[0][0]
            if unknown:
                # No metrics available for these GPUs — fall back to priority ordering
                unknown.sort(key=lambda g: (g.priority, g.id))
                return unknown[0]
            # All GPUs have metrics but none fit — fall through to CPU
        else:
            # No memory info or model size unknown; pick best GPU by priority
            gpu_candidates.sort(key=lambda g: (g.priority, g.id))
            return gpu_candidates[0]

    # CPU fallback
    if cpu_candidates:
        cpu = sorted(cpu_candidates, key=lambda c: (c.priority, c.id))[0]
        if model_size_mb > 0 and memory_metrics:
            metrics = memory_metrics.get(cpu.hardware_id, {})
            total_mb = metrics.get("total_mb", 0)
            available_mb = metrics.get("available_mb", 0)
            if total_mb > 0 and model_size_mb > available_mb:
                if gpu_candidates:
                    best_gpu_avail = max(
                        memory_metrics.get(g.hardware_id, {}).get("available_mb", 0)
                        for g in gpu_candidates
                    )
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Model requires ~{model_size_mb} MB. "
                            f"Best GPU has {best_gpu_avail} MB available and "
                            f"CPU has {available_mb} MB available — no device can fit this model"
                        ),
                    )
                raise HTTPException(
                    status_code=409,
                    detail=f"Model requires ~{model_size_mb} MB but CPU only has {available_mb} MB available",
                )
        return cpu

    # GPUs exist but none fit and there is no CPU to fall back to
    if gpu_candidates:
        best_gpu_avail = max(
            memory_metrics.get(g.hardware_id, {}).get("available_mb", 0)
            for g in gpu_candidates
        )
        raise HTTPException(
            status_code=409,
            detail=(
                f"Model requires ~{model_size_mb} MB but no GPU has sufficient free VRAM "
                f"(best available: {best_gpu_avail} MB) and no CPU device is enabled"
            ),
        )

    return None


def _estimate_model_size_mb(file_path: str) -> int:
    try:
        return int(os.path.getsize(file_path) / (1024 * 1024))
    except OSError:
        return 0


def _serialize_model(model: ModelConfig) -> dict:
    return {
        "id": model.id,
        "priority": model.priority,
        "file_name": model.file_name,
        "file_path": model.file_path,
        "alias": model.alias,
        "description": model.description,
        "system_prompt": model.system_prompt,
        "chat_template": model.chat_template,
        "context_length": model.context_length,
        "gpu_layers": model.gpu_layers,
        "threads": model.threads,
        "assignment_mode": model.assignment_mode,
        "pinned_device_id": model.pinned_device_id,
        "activated": model.activated,
    }


def _build_unique_alias(db: Session, base_alias: str) -> str:
    alias = base_alias.strip() or "model"
    base = alias
    suffix = 1
    while db.query(ModelConfig.id).filter(ModelConfig.alias == alias).first():
        alias = f"{base}-{suffix}"
        suffix += 1
    return alias


def _next_model_priority(db: Session) -> int:
    last_model = db.query(ModelConfig).order_by(ModelConfig.priority.desc(), ModelConfig.id.desc()).first()
    return 0 if not last_model else last_model.priority + 1
