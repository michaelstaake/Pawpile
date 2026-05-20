import asyncio
import logging
import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.device_manager import is_supported_vendor

logger = logging.getLogger(__name__)


class ActivateModelRequest(BaseModel):
    model_id: int
    alias: str
    file_path: str
    context_length: int
    threads: int
    gpu_layers: int
    vendor: str
    hardware_id: str


@dataclass
class RunningModel:
    model_id: int
    port: int
    process: subprocess.Popen


class InferenceRuntime:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._running: dict[int, RunningModel] = {}

    async def activate_model(self, payload: ActivateModelRequest) -> None:
        if not is_supported_vendor(payload.vendor):
            raise RuntimeError(f"Unsupported device vendor for this inference service: {payload.vendor}")
        if payload.model_id in self._running:
            return

        port = self.settings.llama_base_port + payload.model_id
        env = self._build_env(payload.vendor, payload.hardware_id, payload.threads)
        command = [
            self._resolve_llama_server_path(),
            "-m",
            payload.file_path,
            "--host",
            self.settings.llama_host,
            "--port",
            str(port),
            "-c",
            str(payload.context_length),
            "--threads",
            str(payload.threads),
            "--n-gpu-layers",
            str(payload.gpu_layers),
        ]

        try:
            process = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except FileNotFoundError as exc:
            raise RuntimeError(f"llama-server executable not found at {self.settings.llama_server_path}") from exc

        self._running[payload.model_id] = RunningModel(model_id=payload.model_id, port=port, process=process)
        if not await self.wait_until_healthy(payload.model_id):
            self.deactivate_model(payload.model_id)
            raise RuntimeError(f"Model {payload.alias} failed health check")

    def deactivate_model(self, model_id: int) -> None:
        running = self._running.pop(model_id, None)
        if not running:
            return
        running.process.terminate()
        try:
            running.process.wait(timeout=10)
        except Exception:
            running.process.kill()

    async def wait_until_healthy(self, model_id: int) -> bool:
        running = self._running.get(model_id)
        if not running:
            return False

        url = f"http://{self.settings.llama_host}:{running.port}/health"
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
        running = self._running.get(model_id)
        if not running:
            raise RuntimeError("Model is not active")
        url = f"http://{self.settings.llama_host}:{running.port}/v1/chat/completions"
        async with httpx.AsyncClient(timeout=self.settings.llama_request_timeout_seconds) as client:
            response = await client.post(url, json=payload)
        response.raise_for_status()
        return response.json()

    def _resolve_llama_server_path(self) -> str:
        configured_path = Path(self.settings.llama_server_path)
        candidates = [configured_path]
        if os.name == "nt" and configured_path.suffix.lower() != ".exe":
            candidates.insert(0, configured_path.with_suffix(".exe"))

        for candidate in candidates:
            if candidate.exists():
                return str(candidate)

        return str(configured_path)

    def _build_env(self, vendor: str, hardware_id: str, threads: int) -> dict[str, str]:
        env = os.environ.copy()
        if vendor == "nvidia":
            env["CUDA_VISIBLE_DEVICES"] = hardware_id.split(":")[-1]
        elif vendor == "amd":
            env["HIP_VISIBLE_DEVICES"] = hardware_id.split(":")[-1]
        elif vendor == "intel":
            env["ONEAPI_DEVICE_SELECTOR"] = "level_zero:gpu"
        elif vendor == "cpu":
            env["OMP_NUM_THREADS"] = str(max(1, threads))
        else:
            raise RuntimeError(f"Unknown device vendor: {vendor}")
        return env


app = FastAPI(title="Pawpile Inference Service")
runtime = InferenceRuntime()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "active_models": sorted(runtime._running.keys())}


@app.post("/runtime/models/activate")
async def activate_model(payload: ActivateModelRequest) -> dict:
    try:
        await runtime.activate_model(payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"status": "ok", "model_id": payload.model_id}


@app.post("/runtime/models/{model_id}/deactivate")
def deactivate_model(model_id: int) -> dict:
    runtime.deactivate_model(model_id)
    return {"status": "ok"}


@app.get("/runtime/models/{model_id}/health")
async def model_health(model_id: int) -> dict:
    if await runtime.wait_until_healthy(model_id):
        return {"status": "ok"}
    raise HTTPException(status_code=503, detail="Model is not healthy")


@app.post("/runtime/models/{model_id}/chat/completions")
async def chat_completion(model_id: int, payload: dict) -> dict:
    try:
        return await runtime.chat_completion(model_id, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
