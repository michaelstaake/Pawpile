import asyncio
import logging
import os
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import httpx
import psutil
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.device_manager import DeviceManager, get_supported_vendors, is_supported_vendor

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
    alias: str
    hardware_id: str
    vendor: str
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

        self._running[payload.model_id] = RunningModel(
            model_id=payload.model_id,
            alias=payload.alias,
            hardware_id=payload.hardware_id,
            vendor=payload.vendor,
            port=port,
            process=process,
        )
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

    def status_payload(self) -> dict:
        supported_vendors = get_supported_vendors()
        detected_devices = [device for device in device_manager.detect_local() if device.vendor in supported_vendors]
        dynamic_metrics = self._collect_dynamic_metrics()
        models_by_hardware_id: dict[str, list[dict]] = {}

        for running in self._running.values():
            if running.process.poll() is not None:
                continue

            hardware_metrics = dynamic_metrics.get(running.hardware_id, {})
            process_memory_by_pid = hardware_metrics.get("process_memory_by_pid", {})
            process_memory_mb = process_memory_by_pid.get(running.process.pid)
            if process_memory_mb is None:
                process_memory_mb = self._process_memory_mb(running.process.pid)

            models_by_hardware_id.setdefault(running.hardware_id, []).append(
                {
                    "model_id": running.model_id,
                    "alias": running.alias,
                    "pid": running.process.pid,
                    "memory_used_mb": process_memory_mb,
                }
            )

        devices: list[dict] = []
        for device in detected_devices:
            device_models = sorted(models_by_hardware_id.get(device.hardware_id, []), key=lambda row: row["model_id"])
            hardware_metrics = dynamic_metrics.get(device.hardware_id, {})
            process_memory_total = sum(model["memory_used_mb"] for model in device_models)
            memory_used_mb = int(hardware_metrics.get("memory_used_mb") or 0)
            if memory_used_mb <= 0 and process_memory_total > 0:
                memory_used_mb = process_memory_total

            usage_percent = hardware_metrics.get("usage_percent")
            if usage_percent is None and device.max_slots > 0:
                usage_percent = round(min(100.0, (len(device_models) / max(1, device.max_slots)) * 100), 1)

            devices.append(
                {
                    "hardware_id": device.hardware_id,
                    "name": device.name,
                    "vendor": device.vendor,
                    "device_type": device.device_type,
                    "memory_total_mb": hardware_metrics.get("memory_total_mb") or device.memory_mb,
                    "memory_used_mb": memory_used_mb,
                    "usage_percent": usage_percent,
                    "usage_source": hardware_metrics.get("usage_source", "slots"),
                    "memory_source": hardware_metrics.get("memory_source", "processes"),
                    "models": device_models,
                }
            )

        return {"status": "ok", "devices": devices}

    def _collect_dynamic_metrics(self) -> dict[str, dict]:
        metrics: dict[str, dict] = {}

        cpu_memory = psutil.virtual_memory()
        metrics["cpu:0"] = {
            "usage_percent": round(psutil.cpu_percent(), 1),
            "usage_source": "system",
            "memory_used_mb": int(cpu_memory.used / (1024 * 1024)),
            "memory_total_mb": int(cpu_memory.total / (1024 * 1024)),
            "memory_source": "system",
            "process_memory_by_pid": {},
        }

        metrics.update(self._collect_nvidia_metrics())
        return metrics

    def _collect_nvidia_metrics(self) -> dict[str, dict]:
        gpu_output = self._run_command(
            [
                "nvidia-smi",
                "--query-gpu=index,uuid,utilization.gpu,memory.used,memory.total",
                "--format=csv,noheader,nounits",
            ]
        )
        if not gpu_output:
            return {}

        metrics: dict[str, dict] = {}
        hardware_ids_by_uuid: dict[str, str] = {}
        for line in gpu_output.splitlines():
            parts = [part.strip() for part in line.split(",")]
            if len(parts) < 5:
                continue

            hardware_id = f"nvidia:{parts[0]}"
            uuid = parts[1]
            hardware_ids_by_uuid[uuid] = hardware_id
            metrics[hardware_id] = {
                "usage_percent": self._parse_float(parts[2]),
                "usage_source": "nvidia-smi",
                "memory_used_mb": self._parse_int(parts[3]),
                "memory_total_mb": self._parse_int(parts[4]),
                "memory_source": "nvidia-smi",
                "process_memory_by_pid": {},
            }

        process_output = self._run_command(
            [
                "nvidia-smi",
                "--query-compute-apps=gpu_uuid,pid,used_gpu_memory",
                "--format=csv,noheader,nounits",
            ]
        )
        for line in process_output.splitlines():
            parts = [part.strip() for part in line.split(",")]
            if len(parts) < 3:
                continue

            hardware_id = hardware_ids_by_uuid.get(parts[0])
            pid = self._parse_int(parts[1])
            used_memory_mb = self._parse_int(parts[2])
            if not hardware_id or pid is None or used_memory_mb is None:
                continue

            metrics.setdefault(hardware_id, {"process_memory_by_pid": {}})
            process_memory_by_pid = metrics[hardware_id].setdefault("process_memory_by_pid", {})
            process_memory_by_pid[pid] = used_memory_mb

        return metrics

    @staticmethod
    def _run_command(command: list[str]) -> str:
        try:
            output = subprocess.check_output(command, stderr=subprocess.DEVNULL, text=True)
        except Exception:
            return ""
        return output.strip()

    @staticmethod
    def _process_memory_mb(pid: int) -> int:
        try:
            process = psutil.Process(pid)
            return int(process.memory_info().rss / (1024 * 1024))
        except Exception:
            return 0

    @staticmethod
    def _parse_int(value: str) -> int | None:
        text = value.strip()
        if not text or text.upper() == "N/A":
            return None
        try:
            return int(float(text))
        except ValueError:
            return None

    @staticmethod
    def _parse_float(value: str) -> float | None:
        text = value.strip()
        if not text or text.upper() == "N/A":
            return None
        try:
            return round(float(text), 1)
        except ValueError:
            return None


app = FastAPI(title="Pawpile Inference Service")
runtime = InferenceRuntime()
device_manager = DeviceManager()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "active_models": sorted(runtime._running.keys())}


@app.get("/runtime/info")
def runtime_info() -> dict:
    return {
        "status": "ok",
        "supported_vendors": sorted(get_supported_vendors()),
        "active_models": sorted(runtime._running.keys()),
    }


@app.get("/runtime/devices")
def runtime_devices() -> dict:
    devices = [
        {
            "hardware_id": device.hardware_id,
            "name": device.name,
            "vendor": device.vendor,
            "device_type": device.device_type,
            "memory_mb": device.memory_mb,
            "max_threads": device.max_threads,
            "max_slots": device.max_slots,
        }
        for device in device_manager.detect_local()
        if is_supported_vendor(device.vendor)
    ]
    return {"status": "ok", "devices": devices}


@app.get("/runtime/status")
def runtime_status() -> dict:
    return runtime.status_payload()


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
