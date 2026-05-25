import asyncio
import time
import logging
from dataclasses import dataclass, field
import json
from collections.abc import AsyncIterator

import httpx

from app.core.config import get_settings
from app.models.device import Device
from app.models.model_config import ModelConfig

logger = logging.getLogger(__name__)


@dataclass
class PoolActivationTarget:
    """Represents a pool of NVIDIA GPUs to use together for a single model."""

    pool_id: int
    pool_name: str
    devices: list[Device]

    @property
    def hardware_ids(self) -> list[str]:
        return [d.hardware_id for d in self.devices]

    @property
    def vram_ratios(self) -> list[int]:
        return [max(1, d.memory_mb) for d in self.devices]

    @property
    def combined_available_mb(self) -> int:
        return sum(max(0, d.memory_mb) for d in self.devices)


def _runtime_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except (ValueError, json.JSONDecodeError):
        payload = None

    if isinstance(payload, dict):
        detail = payload.get("detail")
        if isinstance(detail, str) and detail.strip():
            return detail.strip()

    text = response.text.strip()
    if text:
        return text

    return f"Inference runtime request failed with status {response.status_code}"


@dataclass
class RunningModel:
    model_id: int
    base_url: str
    device_id: int | None
    vendor: str


class InferenceManager:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._running: dict[int, RunningModel] = {}

    def is_active(self, model_id: int) -> bool:
        return model_id in self._running

    def runtime_url_for_vendor(self, vendor: str) -> str | None:
        # nvidia_pool uses the same runtime as nvidia
        effective_vendor = "nvidia" if vendor == "nvidia_pool" else vendor
        return self.settings.inference_runtime_url_for_vendor(effective_vendor)

    def has_runtime_for_vendor(self, vendor: str) -> bool:
        return self.runtime_url_for_vendor(vendor) is not None

    async def get_device_memory_mb(self) -> dict[str, dict]:
        """Fetch current memory metrics from all configured runtimes.

        Returns a mapping of hardware_id -> {"total_mb", "used_mb", "available_mb"}.
        Returns an empty dict if no runtimes are reachable.
        """
        result: dict[str, dict] = {}
        seen_urls: set[str] = set()
        runtime_map = self.settings.inference_runtime_url_map()
        timeout = self.settings.inference_service_timeout_seconds

        for base_url in runtime_map.values():
            if base_url in seen_urls:
                continue
            seen_urls.add(base_url)
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.get(f"{base_url}/runtime/status")
                    response.raise_for_status()
                data = response.json()
            except Exception:
                logger.warning("Failed to fetch runtime status from %s for device memory check", base_url)
                continue

            for device in data.get("devices", []):
                hardware_id = device.get("hardware_id")
                if not hardware_id:
                    continue
                total = int(device.get("memory_total_mb") or 0)
                used = int(device.get("memory_used_mb") or 0)
                result[hardware_id] = {
                    "total_mb": total,
                    "used_mb": used,
                    "available_mb": max(0, total - used),
                }

        return result

    async def activate_model(self, model: ModelConfig, device: Device) -> None:
        if model.id in self._running:
            return

        runtime_url = self.runtime_url_for_vendor(device.vendor)
        if not runtime_url:
            raise RuntimeError(f"No inference runtime configured for device vendor: {device.vendor}")

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
            response = await client.post(f"{runtime_url}/runtime/models/activate", json=payload)
            if response.is_error:
                raise RuntimeError(_runtime_error_detail(response))

        self._running[model.id] = RunningModel(
            model_id=model.id,
            base_url=runtime_url,
            device_id=device.id,
            vendor=device.vendor,
        )

        ok = await self.wait_until_healthy(model.id)
        if not ok:
            self.deactivate_model(model.id)
            raise RuntimeError(f"Model {model.alias} failed health check")

    async def activate_model_on_pool(self, model: ModelConfig, target: PoolActivationTarget) -> None:
        if model.id in self._running:
            return

        runtime_url = self.runtime_url_for_vendor("nvidia_pool")
        if not runtime_url:
            raise RuntimeError("No inference runtime configured for NVIDIA (required for GPU pool)")

        payload = {
            "model_id": model.id,
            "alias": model.alias,
            "file_path": model.file_path,
            "context_length": model.context_length,
            "threads": model.threads,
            "gpu_layers": model.gpu_layers,
            "vendor": "nvidia_pool",
            "hardware_id": target.hardware_ids[0],
            "hardware_ids": target.hardware_ids,
            "vram_ratios": target.vram_ratios,
        }
        timeout = self.settings.inference_service_timeout_seconds
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(f"{runtime_url}/runtime/models/activate", json=payload)
            if response.is_error:
                raise RuntimeError(_runtime_error_detail(response))

        self._running[model.id] = RunningModel(
            model_id=model.id,
            base_url=runtime_url,
            device_id=None,
            vendor="nvidia_pool",
        )

        ok = await self.wait_until_healthy(model.id)
        if not ok:
            self.deactivate_model(model.id)
            raise RuntimeError(f"Model {model.alias} failed health check on GPU pool")

    def deactivate_model(self, model_id: int) -> None:
        running = self._running.pop(model_id, None)
        if not running:
            return
        try:
            with httpx.Client(timeout=self.settings.inference_service_timeout_seconds) as client:
                client.post(f"{running.base_url}/runtime/models/{model_id}/deactivate").raise_for_status()
        except Exception:
            logger.exception("Failed to deactivate remote model %s", model_id)

    async def wait_until_healthy(self, model_id: int) -> bool:
        running = self._running.get(model_id)
        if not running:
            return False

        url = f"{running.base_url}/runtime/models/{model_id}/health"
        timeout = self.settings.llama_health_timeout_seconds
        deadline = time.monotonic() + max(timeout, self.settings.llama_startup_timeout_seconds)

        while time.monotonic() < deadline:
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
        running = self._running.get(model_id)
        if not running:
            raise RuntimeError("Model is not active")

        url = f"{running.base_url}/runtime/models/{model_id}/chat/completions"
        async with httpx.AsyncClient(timeout=self.settings.inference_service_timeout_seconds) as client:
            response = await client.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    async def stream_chat_completion(self, model_id: int, payload: dict) -> AsyncIterator[bytes]:
        running = self._running.get(model_id)
        if not running:
            raise RuntimeError("Model is not active")

        url = f"{running.base_url}/runtime/models/{model_id}/chat/completions"
        async with httpx.AsyncClient(timeout=self.settings.llama_request_timeout_seconds) as client:
            async with client.stream("POST", url, json=payload) as response:
                if response.is_error:
                    await response.aread()
                    raise RuntimeError(_runtime_error_detail(response))

                async for chunk in response.aiter_bytes():
                    if chunk:
                        yield chunk
