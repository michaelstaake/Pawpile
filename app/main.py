from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, chat, devices, models, openai_compat, status
from app.core.config import get_settings
from app.core.db import Base, SessionLocal, engine
from app.core.device_manager import DeviceManager
from app.core.inference_manager import InferenceManager
from app.core.logging import configure_logging

settings = get_settings()
device_manager = DeviceManager()
inference_manager = InferenceManager()


@asynccontextmanager
async def lifespan(_: FastAPI):
    configure_logging(settings.app_log_level)
    Path(settings.models_dir).mkdir(parents=True, exist_ok=True)
    Path(settings.data_dir).mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        device_manager.sync_detected_devices(db)
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
