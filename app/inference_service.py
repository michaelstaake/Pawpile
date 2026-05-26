import asyncio
import csv
import json
import logging
import os
import re
import shlex
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import IO, Optional

import httpx
import psutil
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
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
    hardware_ids: list[str] = []
    vram_ratios: list[int] = []


@dataclass
class RunningModel:
    model_id: int
    alias: str
    hardware_id: str
    vendor: str
    port: int
    process: subprocess.Popen
    command: list[str] = field(default_factory=list, compare=False)
    log_path: str = field(default="", compare=False)
    log_file: Optional[IO[bytes]] = field(default=None, compare=False)


class InferenceRuntime:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._running: dict[int, RunningModel] = {}

    async def activate_model(self, payload: ActivateModelRequest) -> None:
        effective_vendor = "nvidia" if payload.vendor == "nvidia_pool" else payload.vendor
        if not is_supported_vendor(effective_vendor):
            raise RuntimeError(f"Unsupported device vendor for this inference service: {payload.vendor}")
        if payload.model_id in self._running:
            return

        port = self.settings.llama_base_port + payload.model_id
        env = self._build_env(payload.vendor, payload.hardware_id, payload.threads, payload.hardware_ids)
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
        command.extend(self._build_vendor_args(payload.vendor, payload.vram_ratios))

        logs_dir = Path(self.settings.logs_dir)
        logs_dir.mkdir(parents=True, exist_ok=True)
        log_path = logs_dir / f"llama-{payload.model_id}.log"

        try:
            log_file: IO[bytes] = open(log_path, "wb")
            logger.info(
                "Launching llama-server for model %d (%s) on %s %s; log=%s; command=%s",
                payload.model_id,
                payload.alias,
                payload.vendor,
                payload.hardware_id,
                log_path,
                shlex.join(command),
            )
            process = subprocess.Popen(command, env=env, stdout=log_file, stderr=log_file)
        except FileNotFoundError as exc:
            raise RuntimeError(f"llama-server executable not found at {self.settings.llama_server_path}") from exc

        self._running[payload.model_id] = RunningModel(
            model_id=payload.model_id,
            alias=payload.alias,
            hardware_id=payload.hardware_id,
            vendor=payload.vendor,
            port=port,
            process=process,
            command=command,
            log_path=str(log_path),
            log_file=log_file,
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
        if running.log_file is not None:
            try:
                running.log_file.close()
            except Exception:
                pass

    async def wait_until_healthy(self, model_id: int) -> bool:
        running = self._running.get(model_id)
        if not running:
            return False

        url = f"http://{self.settings.llama_host}:{running.port}/health"
        timeout = self.settings.llama_health_timeout_seconds
        deadline = time.monotonic() + max(timeout, self.settings.llama_startup_timeout_seconds)

        while time.monotonic() < deadline:
            exit_code = running.process.poll()
            if exit_code is not None:
                logger.error(
                    "llama-server for model %d (%s) on %s %s exited early with code %d; log=%s; command=%s",
                    model_id,
                    running.alias,
                    running.vendor,
                    running.hardware_id,
                    exit_code,
                    running.log_path,
                    shlex.join(running.command),
                )
                return False
            try:
                async with httpx.AsyncClient(timeout=timeout) as client:
                    response = await client.get(url)
                if response.status_code == 200:
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.5)

        logger.error(
            "llama-server for model %d (%s) on %s %s did not become healthy within %d seconds; log=%s; command=%s",
            model_id,
            running.alias,
            running.vendor,
            running.hardware_id,
            max(timeout, self.settings.llama_startup_timeout_seconds),
            running.log_path,
            shlex.join(running.command),
        )
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

    async def stream_chat_completion(self, model_id: int, payload: dict):
        running = self._running.get(model_id)
        if not running:
            raise RuntimeError("Model is not active")

        url = f"http://{self.settings.llama_host}:{running.port}/v1/chat/completions"
        async with httpx.AsyncClient(timeout=self.settings.llama_request_timeout_seconds) as client:
            async with client.stream("POST", url, json=payload) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    if chunk:
                        yield chunk

    def _resolve_llama_server_path(self) -> str:
        configured_path = Path(self.settings.llama_server_path)
        candidates = [configured_path]
        if os.name == "nt" and configured_path.suffix.lower() != ".exe":
            candidates.insert(0, configured_path.with_suffix(".exe"))

        for candidate in candidates:
            if candidate.exists():
                return str(candidate)

        return str(configured_path)

    def _build_env(self, vendor: str, hardware_id: str, threads: int, hardware_ids: list[str] | None = None) -> dict[str, str]:
        env = os.environ.copy()
        if vendor == "nvidia_pool":
            ids = hardware_ids if hardware_ids else [hardware_id]
            indices = [hid.split(":")[-1] for hid in ids]
            env["CUDA_VISIBLE_DEVICES"] = ",".join(indices)
        elif vendor == "nvidia":
            env["CUDA_VISIBLE_DEVICES"] = hardware_id.split(":")[-1]
        elif vendor == "amd":
            env["HIP_VISIBLE_DEVICES"] = hardware_id.split(":")[-1]
        elif vendor == "intel":
            env["ONEAPI_DEVICE_SELECTOR"] = "level_zero:gpu"
        elif vendor == "vulkan":
            env["GGML_VK_VISIBLE_DEVICES"] = hardware_id.split(":")[-1]
        elif vendor == "cpu":
            env["OMP_NUM_THREADS"] = str(max(1, threads))
        else:
            raise RuntimeError(f"Unknown device vendor: {vendor}")
        return env

    def _build_vendor_args(self, vendor: str, vram_ratios: list[int] | None = None) -> list[str]:
        if vendor == "nvidia_pool":
            args: list[str] = []
            if vram_ratios and len(vram_ratios) >= 2:
                args.extend(["--tensor-split", ",".join(str(r) for r in vram_ratios)])
            return args

        if vendor != "amd":
            return []

        args = []
        if self.settings.amd_llama_disable_warmup:
            args.append("--no-warmup")

        extra_args = self.settings.amd_llama_extra_args.strip()
        if extra_args:
            args.extend(shlex.split(extra_args))

        return args

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
            process_memory_by_pid = hardware_metrics.get("process_memory_by_pid", {})
            if device_models and memory_used_mb > 0 and not process_memory_by_pid and process_memory_total < memory_used_mb:
                self._distribute_shared_memory(device_models, memory_used_mb)
                process_memory_total = sum(model["memory_used_mb"] for model in device_models)
            if memory_used_mb <= 0 and process_memory_total > 0:
                memory_used_mb = process_memory_total

            usage_percent = hardware_metrics.get("usage_percent")
            usage_source = hardware_metrics.get("usage_source") if usage_percent is not None else "unavailable"

            devices.append(
                {
                    "hardware_id": device.hardware_id,
                    "name": device.name,
                    "vendor": device.vendor,
                    "device_type": device.device_type,
                    "memory_total_mb": hardware_metrics.get("memory_total_mb") or device.memory_mb,
                    "memory_used_mb": memory_used_mb,
                    "usage_percent": usage_percent,
                    "usage_source": usage_source,
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
        metrics.update(self._collect_amd_metrics())
        metrics.update(self._collect_intel_metrics())
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

    def _collect_amd_metrics(self) -> dict[str, dict]:
        # Try JSON first
        json_output = self._run_command(["rocm-smi", "--showuse", "--showmeminfo", "vram", "--json"])
        metrics = self._parse_amd_metrics_json(json_output)
        if metrics:
            return metrics

        # Fallback to plain text output
        text_output = self._run_command(["rocm-smi", "--showuse", "--showmeminfo", "vram"])
        return self._parse_amd_metrics_text(text_output)

    def _collect_intel_metrics(self) -> dict[str, dict]:
        dump_output = self._run_command(["xpu-smi", "dump", "-d", "-1", "-m", "0,18", "-n", "1"])
        return self._parse_intel_metrics_dump(dump_output)

    @classmethod
    def _parse_amd_metrics_json(cls, json_output: str) -> dict[str, dict]:
        if not json_output:
            return {}
        try:
            data = json.loads(json_output)
        except Exception:
            return {}
        if not isinstance(data, dict):
            return {}

        metrics: dict[str, dict] = {}
        for card_key, entry in data.items():
            if not isinstance(entry, dict):
                continue
            card_lower = card_key.lower()
            if not ("card" in card_lower or "device" in card_lower or "gpu" in card_lower):
                continue

            digits = re.sub(r"\D", "", card_key) or "0"
            index = int(digits)
            hardware_id = f"amd:{index}"

            vram_used_bytes = 0
            vram_total_bytes = 0
            gpu_use = None

            for path, raw_value in cls._flatten_metric_entries(entry):
                if "vram" in path:
                    parsed_size = cls._parse_size_to_bytes(raw_value)
                    if parsed_size is None:
                        continue
                    if any(token in path for token in ["used", "use", "allocated", "used memory"]):
                        vram_used_bytes = max(vram_used_bytes, parsed_size)
                    elif "total" in path:
                        vram_total_bytes = max(vram_total_bytes, parsed_size)

                if gpu_use is None and any(token in path for token in ["gpu use", "gpu usage", "gpu busy", "gpu activity", "utilization"]):
                    gpu_use = cls._parse_percentage(raw_value)

            metrics[hardware_id] = {
                "usage_percent": gpu_use,
                "usage_source": "rocm-smi",
                "memory_used_mb": int(vram_used_bytes / (1024 * 1024)) if vram_used_bytes else 0,
                "memory_total_mb": int(vram_total_bytes / (1024 * 1024)) if vram_total_bytes else 0,
                "memory_source": "rocm-smi",
                "process_memory_by_pid": {},
            }
        return metrics

    @classmethod
    def _parse_amd_metrics_text(cls, text_output: str) -> dict[str, dict]:
        if not text_output:
            return {}

        metrics: dict[str, dict] = {}
        # Parse text output (e.g. Card0 GPU use %: 0.1, Card0 VRAM total memory: ..., Card0 VRAM memory use: ...)
        for line in text_output.splitlines():
            line_lower = line.lower()
            card_match = re.search(r"(?:card|gpu|device)\[?(\d+)\]?", line_lower)
            if not card_match:
                continue

            index = int(card_match.group(1))
            hardware_id = f"amd:{index}"
            metrics.setdefault(
                hardware_id,
                {
                    "usage_percent": 0.0,
                    "usage_source": "rocm-smi",
                    "memory_used_mb": 0,
                    "memory_total_mb": 0,
                    "memory_source": "rocm-smi",
                    "process_memory_by_pid": {},
                },
            )

            parts = line_lower.split(":")
            if len(parts) < 2:
                continue
            val_part = parts[-1].strip()

            if "gpu" in line_lower and ("use" in line_lower or "activity" in line_lower or "%" in line_lower):
                metrics[hardware_id]["usage_percent"] = cls._parse_percentage(val_part)
            elif "vram" in line_lower:
                parsed_size = cls._parse_size_to_bytes(val_part)
                if parsed_size is None:
                    continue
                if "use" in line_lower or "allocated" in line_lower:
                    metrics[hardware_id]["memory_used_mb"] = int(parsed_size / (1024 * 1024))
                elif "total" in line_lower:
                    metrics[hardware_id]["memory_total_mb"] = int(parsed_size / (1024 * 1024))

        return metrics

    @classmethod
    def _parse_intel_metrics_dump(cls, dump_output: str) -> dict[str, dict]:
        if not dump_output:
            return {}

        csv_lines = [line for line in dump_output.splitlines() if "," in line]
        if len(csv_lines) < 2:
            return {}

        reader = csv.reader(csv_lines)
        rows = [[cell.strip() for cell in row] for row in reader if row]
        if len(rows) < 2:
            return {}

        header = rows[0]
        column_map = {name: index for index, name in enumerate(header)}
        device_column = column_map.get("DeviceId")
        usage_column = column_map.get("GPU Utilization (%)")
        memory_used_column = column_map.get("GPU Memory Used (MiB)")
        if device_column is None:
            return {}

        metrics: dict[str, dict] = {}
        for row in rows[1:]:
            if device_column >= len(row):
                continue
            device_id = cls._parse_int(row[device_column])
            if device_id is None:
                continue

            usage_percent = None
            if usage_column is not None and usage_column < len(row):
                usage_percent = cls._parse_float(row[usage_column])

            memory_used_mb = 0
            if memory_used_column is not None and memory_used_column < len(row):
                memory_value = cls._parse_float(row[memory_used_column])
                memory_used_mb = int(memory_value) if memory_value is not None else 0

            metrics[f"intel:{device_id}"] = {
                "usage_percent": usage_percent,
                "usage_source": "xpu-smi",
                "memory_used_mb": memory_used_mb,
                "memory_source": "xpu-smi",
                "process_memory_by_pid": {},
            }

        return metrics

    @staticmethod
    def _flatten_metric_entries(value: object, prefix: tuple[str, ...] = ()) -> list[tuple[str, str]]:
        entries: list[tuple[str, str]] = []
        if isinstance(value, dict):
            for key, child in value.items():
                entries.extend(InferenceRuntime._flatten_metric_entries(child, (*prefix, str(key).lower())))
            return entries

        if isinstance(value, list):
            for index, child in enumerate(value):
                entries.extend(InferenceRuntime._flatten_metric_entries(child, (*prefix, str(index))))
            return entries

        entries.append((" ".join(prefix), str(value).strip()))
        return entries

    @staticmethod
    def _parse_percentage(value: str) -> float | None:
        match = re.search(r"(-?\d+(?:\.\d+)?)\s*%?", value)
        if not match:
            return None
        try:
            return round(float(match.group(1)), 1)
        except ValueError:
            return None

    @staticmethod
    def _parse_size_to_bytes(value: str) -> int | None:
        match = re.search(r"(-?\d+(?:\.\d+)?)\s*(bytes|byte|b|kbytes|kb|kib|mbytes|mb|mib|gbytes|gb|gib|tbytes|tb|tib)?", value, re.IGNORECASE)
        if not match:
            return None

        try:
            amount = float(match.group(1))
        except ValueError:
            return None

        unit = (match.group(2) or "bytes").lower()
        multipliers = {
            "bytes": 1,
            "byte": 1,
            "b": 1,
            "kbytes": 1024,
            "kb": 1024,
            "kib": 1024,
            "mbytes": 1024**2,
            "mb": 1024**2,
            "mib": 1024**2,
            "gbytes": 1024**3,
            "gb": 1024**3,
            "gib": 1024**3,
            "tbytes": 1024**4,
            "tb": 1024**4,
            "tib": 1024**4,
        }
        return int(amount * multipliers.get(unit, 1))

    @staticmethod
    def _distribute_shared_memory(models: list[dict], total_memory_mb: int) -> None:
        if not models or total_memory_mb <= 0:
            return

        weights = [max(0, int(model.get("memory_used_mb") or 0)) for model in models]
        if sum(weights) <= 0:
            weights = [1] * len(models)

        weight_total = sum(weights)
        allocations = [int(total_memory_mb * weight / weight_total) for weight in weights]
        remainder = total_memory_mb - sum(allocations)
        indices = sorted(range(len(weights)), key=lambda index: weights[index], reverse=True)
        for offset in range(remainder):
            allocations[indices[offset % len(indices)]] += 1

        for model, allocation in zip(models, allocations):
            model["memory_used_mb"] = allocation

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
async def chat_completion(model_id: int, payload: dict):
    try:
        if payload.get("stream"):
            return StreamingResponse(
                runtime.stream_chat_completion(model_id, payload),
                media_type="text/event-stream",
            )
        return await runtime.chat_completion(model_id, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
