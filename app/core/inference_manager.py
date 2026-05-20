import asyncio
import logging
from dataclasses import dataclass

import httpx

from app.core.config import get_settings
from app.models.device import Device
from app.models.model_config import ModelConfig

logger = logging.getLogger(__name__)


@dataclass
class RunningModel:
    model_id: int
    base_url: str
    device_id: int


class InferenceManager:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._running: dict[int, RunningModel] = {}

    def is_active(self, model_id: int) -> bool:
        return model_id in self._running

    async def activate_model(self, model: ModelConfig, device: Device) -> None:
        if model.id in self._running:
            return

        payload = {
            "model_id": model.id,
            "alias": model.alias,
            "file_path": model.file_path,
            "context_length": model.context_length,
            "threads": model.threads,
            "gpu_layers": model.gpu_layers,
            "vendor": device.vendor,
            "hardware_id": device.hardware_id,
        }
        timeout = self.settings.inference_service_timeout_seconds
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(f"{self.settings.inference_service_url}/runtime/models/activate", json=payload)
            response.raise_for_status()

        self._running[model.id] = RunningModel(model_id=model.id, base_url=self.settings.inference_service_url, device_id=device.id)

        ok = await self.wait_until_healthy(model.id)
        if not ok:
            self.deactivate_model(model.id)
            raise RuntimeError(f"Model {model.alias} failed health check")

    def deactivate_model(self, model_id: int) -> None:
        running = self._running.pop(model_id, None)
        if not running:
            return
        try:
            with httpx.Client(timeout=self.settings.inference_service_timeout_seconds) as client:
                client.post(f"{self.settings.inference_service_url}/runtime/models/{model_id}/deactivate").raise_for_status()
        except Exception:
            logger.exception("Failed to deactivate remote model %s", model_id)

    async def wait_until_healthy(self, model_id: int) -> bool:
        url = f"{self.settings.inference_service_url}/runtime/models/{model_id}/health"
        timeout = self.settings.llama_health_timeout_seconds

        for _ in range(20):
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.get(url)
                if response.status_code == 200:
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.5)

        return False

    async def chat_completion(self, model_id: int, payload: dict) -> dict:
        url = f"{self.settings.inference_service_url}/runtime/models/{model_id}/chat/completions"
        async with httpx.AsyncClient(timeout=self.settings.inference_service_timeout_seconds) as client:
            response = await client.post(url, json=payload)
        response.raise_for_status()
        return response.json()
