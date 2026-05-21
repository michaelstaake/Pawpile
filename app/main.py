from contextlib import asynccontextmanager
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, chat, devices, models, openai_compat, status
from app.core.app_settings import get_or_create_app_settings
from app.core.config import get_settings
from app.core.db import Base, SessionLocal, engine
from app.core.device_manager import DeviceManager
from app.core.inference_manager import InferenceManager
from app.core.logging import configure_logging
from app.models.model_config import ModelConfig

settings = get_settings()
device_manager = DeviceManager()
inference_manager = InferenceManager()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging(settings.app_log_level)
    Path(settings.models_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        device_manager.sync_detected_devices(db)
        app_settings = get_or_create_app_settings(db)
        if app_settings.auto_load_enabled_models_on_startup:
            activated_models = (
                db.query(ModelConfig)
                .filter(ModelConfig.activated.is_(True))
                .order_by(ModelConfig.priority.asc(), ModelConfig.id.asc())
                .all()
            )
            for model in activated_models:
                try:
                    device = await models._resolve_device_for_model(db, model, inference_manager)
                    if device is None:
                        raise RuntimeError("No enabled device available for model")
                    await inference_manager.activate_model(model, device)
                except Exception:
                    logger.exception("Failed to auto-load model %s during startup", model.alias)
                    model.activated = False
                    db.add(model)
            db.commit()
    finally:
        db.close()

    yield

    for model_id in list(inference_manager._running.keys()):
        inference_manager.deactivate_model(model_id)


app = FastAPI(title=settings.app_name, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

models.router.inference_manager = inference_manager  # type: ignore[attr-defined]
openai_compat.router.inference_manager = inference_manager  # type: ignore[attr-defined]
status.router.inference_manager = inference_manager  # type: ignore[attr-defined]

app.include_router(auth.router)
app.include_router(devices.router)
app.include_router(models.router)
app.include_router(chat.router)
app.include_router(admin.router)
app.include_router(openai_compat.router)
app.include_router(status.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/")
def root() -> dict:
    return {"name": settings.app_name, "status": "running"}
