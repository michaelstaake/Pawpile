import asyncio
import unittest

from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.api import models as models_api
from app.core.db import Base
from app.core.gpu_pool_manager import delete_pools_with_unavailable_devices, revert_models_pinned_to_devices
from app.models import activity_log  # noqa: F401
from app.models import device as device_model  # noqa: F401
from app.models import gpu_pool as gpu_pool_model  # noqa: F401
from app.models import model_config as model_config_model  # noqa: F401
from app.utils.schemas import ModelUpdateRequest

Device = device_model.Device
GpuPool = gpu_pool_model.GpuPool
GpuPoolDevice = gpu_pool_model.GpuPoolDevice
ModelConfig = model_config_model.ModelConfig


class DummyInferenceManager:
    def __init__(self, runtimes: set[str] | None = None, memory_metrics: dict[str, dict] | None = None) -> None:
        self.runtimes = runtimes or {"cpu", "nvidia", "nvidia_pool"}
        self.memory_metrics = memory_metrics or {}
        self.deactivated: list[int] = []

    def has_runtime_for_vendor(self, vendor: str) -> bool:
        return vendor in self.runtimes

    async def get_device_memory_mb(self) -> dict[str, dict]:
        return self.memory_metrics

    def deactivate_model(self, model_id: int) -> None:
        self.deactivated.append(model_id)


def add_device(
    db: Session,
    *,
    hardware_id: str,
    name: str,
    vendor: str = "nvidia",
    enabled: bool = True,
    priority: int = 0,
) -> Device:
    device = Device(
        hardware_id=hardware_id,
        name=name,
        vendor=vendor,
        device_type="cpu" if vendor == "cpu" else "gpu",
        memory_mb=8192,
        enabled=enabled,
        priority=priority,
        max_threads=8 if vendor == "cpu" else 0,
        max_slots=0,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def add_model(
    db: Session,
    *,
    alias: str,
    assignment_mode: str = "auto",
    pinned_device_id: int | None = None,
    pinned_pool_id: int | None = None,
    activated: bool = False,
) -> ModelConfig:
    model = ModelConfig(
        priority=0,
        file_name=f"{alias}.gguf",
        file_path=f"C:/models/{alias}.gguf",
        alias=alias,
        description="",
        system_prompt="",
        chat_template="",
        context_length=4096,
        gpu_layers=-1,
        threads=4,
        temperature=0.7,
        top_p=0.95,
        tool_calling_enabled=False,
        thinking_enabled=False,
        assignment_mode=assignment_mode,
        pinned_device_id=pinned_device_id,
        pinned_pool_id=pinned_pool_id,
        activated=activated,
    )
    db.add(model)
    db.commit()
    db.refresh(model)
    return model


def add_pool(db: Session, *, name: str, vendor: str, devices: list[Device]) -> GpuPool:
    pool = GpuPool(name=name, vendor=vendor)
    db.add(pool)
    db.commit()
    db.refresh(pool)

    for device in devices:
        db.add(GpuPoolDevice(pool_id=pool.id, device_id=device.id))
    db.commit()
    db.refresh(pool)
    return pool


class GpuPoolRuleTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = create_engine("sqlite:///:memory:")
        self.testing_session_local = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        Base.metadata.create_all(self.engine)
        self.db_session = self.testing_session_local()

    def tearDown(self) -> None:
        self.db_session.close()
        Base.metadata.drop_all(self.engine)
        self.engine.dispose()

    def test_update_model_rejects_pooled_device_assignment(self) -> None:
        inference = DummyInferenceManager()
        models_api.router.inference_manager = inference  # type: ignore[attr-defined]

        gpu_a = add_device(self.db_session, hardware_id="nvidia:0", name="GPU A")
        gpu_b = add_device(self.db_session, hardware_id="nvidia:1", name="GPU B")
        add_pool(self.db_session, name="Main Pool", vendor="nvidia", devices=[gpu_a, gpu_b])
        model = add_model(self.db_session, alias="pooled-block")

        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(
                models_api.update_model(
                    model.id,
                    ModelUpdateRequest(assignment_mode="pinned", pinned_device_id=gpu_a.id),
                    object(),
                    self.db_session,
                )
            )

        self.assertEqual(ctx.exception.status_code, 409)
        self.assertIn("belongs to a pool", str(ctx.exception.detail))

    def test_auto_resolution_skips_pooled_gpu_when_pool_is_invalid(self) -> None:
        pooled_enabled = add_device(self.db_session, hardware_id="nvidia:0", name="Pooled Enabled", priority=5)
        pooled_disabled = add_device(self.db_session, hardware_id="nvidia:1", name="Pooled Disabled", enabled=False, priority=6)
        standalone = add_device(self.db_session, hardware_id="nvidia:2", name="Standalone GPU", priority=1)
        add_pool(self.db_session, name="Broken Pool", vendor="nvidia", devices=[pooled_enabled, pooled_disabled])
        model = add_model(self.db_session, alias="auto-choice")

        resolution = asyncio.run(models_api._resolve_device_for_model(self.db_session, model, DummyInferenceManager()))

        self.assertIsInstance(resolution, Device)
        self.assertEqual(resolution.id, standalone.id)

    def test_revert_models_pinned_to_devices_sets_auto_and_deactivates(self) -> None:
        inference = DummyInferenceManager()
        gpu = add_device(self.db_session, hardware_id="nvidia:0", name="Pinned GPU")
        model = add_model(self.db_session, alias="pin-reset", assignment_mode="pinned", pinned_device_id=gpu.id, activated=True)

        reverted = revert_models_pinned_to_devices(self.db_session, [gpu.id], inference)
        self.db_session.commit()
        self.db_session.refresh(model)

        self.assertEqual([item.id for item in reverted], [model.id])
        self.assertEqual(inference.deactivated, [model.id])
        self.assertEqual(model.assignment_mode, "auto")
        self.assertIsNone(model.pinned_device_id)
        self.assertFalse(model.activated)

    def test_delete_pools_with_unavailable_devices_reverts_pool_models(self) -> None:
        inference = DummyInferenceManager()
        gpu_a = add_device(self.db_session, hardware_id="nvidia:0", name="GPU A")
        gpu_b = add_device(self.db_session, hardware_id="nvidia:1", name="GPU B")
        pool = add_pool(self.db_session, name="Startup Pool", vendor="nvidia", devices=[gpu_a, gpu_b])
        model = add_model(self.db_session, alias="startup-reset", assignment_mode="pool", pinned_pool_id=pool.id, activated=True)

        removed_pools = delete_pools_with_unavailable_devices(self.db_session, {gpu_a.hardware_id}, inference)
        self.db_session.commit()
        self.db_session.refresh(model)

        self.assertEqual([item.pool_id for item in removed_pools], [pool.id])
        self.assertEqual(inference.deactivated, [model.id])
        self.assertEqual(model.assignment_mode, "auto")
        self.assertIsNone(model.pinned_pool_id)
        self.assertFalse(model.activated)
        self.assertIsNone(self.db_session.query(GpuPool).filter(GpuPool.id == pool.id).first())


if __name__ == "__main__":
    unittest.main()