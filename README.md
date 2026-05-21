# Pawpile

Pawpile is a mostly vibe-coded self-hosted AI platform designed to run completely in Docker on Ubuntu. It gives you a web UI where you can manege auth, models, and devices to get a web chat or expose an OpenAI-compatible API to your local network.

## The Problem Pawpile Solves

Hardware to run AI locally is expensive, but cloud AI solution pricing keeps going up and transparency and accountability keeps going down. Pawpile lets you run models of your choice on the hardware of your choice. It can run models on CPU/system RAM or using NVIDIA, AMD, or Intel Arc GPUs.

## System Requirements

### Recommended Operating System

- **Ubuntu 26.04**

If it works on other operating systems, awesome, but supporting that is outside the scope of this project.

### Hardware Acceleration (Optional)

- **NVIDIA**: CUDA 11.8+ and cuDNN, available on Linux
- **AMD ROCm**: Rrequires `/dev/kfd` and `/dev/dri` access
- **Intel Arc**: Requires Intel GPU drivers

## Features

- FastAPI backend with SQLite storage.
- React + TypeScript + Tailwind frontend.
- OpenAI-compatible API:
  - /v1/models
  - /v1/chat/completions
- Device auto-detection on startup:
  - Ubuntu 26.04: NVIDIA (nvidia-smi), AMD ROCm (rocm-smi), Intel SYCL (sycl-ls), CPU
- Devices are detected automatically and disabled by default when first discovered.
- One model per compute device. No tensor parallelism or layer splitting.
- Queueing when assigned device is busy (no CPU fallback).
- JWT auth and per-user API keys.
- SQLite for users, devices, model config, chats, and job state.

## Project Layout

```text
pawpile/
├── app/
│   ├── api/
│   ├── core/
│   ├── models/
│   ├── utils/
│   └── main.py
├── frontend/
├── models/
├── logs/
├── alembic/
├── docker-compose.yml
├── .env.example
├── requirements.txt
├── README.md
└── LICENSE
```

## Quick Start (Docker)

The default Compose stack is CPU-only and runs on Ubuntu.

### Prerequisites

- Docker installed (20.10+ recommended)
- Docker daemon running, and user added to the docker group
- At least 8 GB RAM available for containers
- 20+ GB free disk space

### Setup Steps

1. Clone or download the repository.

```bash
git clone https://github.com/michaelstaake/Pawpile.git
cd Pawpile
```

2. Copy environment file.

```bash
cp .env.example .env
```

3. Start services.

```bash
docker compose up -d --build
```

The backend stores its SQLite database in a Docker-managed volume. Model files stay in `models/` and runtime logs stay in `logs/` on the host.

4. Add GGUF files under the `models/` directory or do this later using the Web UI.

5. Wait for services to become healthy (typically 30-60 seconds).

6. Open in your browser: http://localhost:5173 or replace localhost with your server's local IP.

7. Complete setup - you will need to complete the web-based setup process that will display when you go to the Pawpile web UI for the first time.

### Optional Runtime Overlays

The base stack always starts the CPU inference runtime. Add one or more vendor runtime overlays when the host supports them.

Pawpile automatically detects devices from the running runtimes and routes models to the matching vendor. The overlay choice is still needed at container startup time because NVIDIA, AMD, and Intel use different images, libraries, and device mappings.

- NVIDIA: `docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d --build`
- AMD (ROCm): `docker compose -f docker-compose.yml -f docker-compose.amd.yml up -d --build`
- Intel (oneAPI / Level Zero): `docker compose -f docker-compose.yml -f docker-compose.intel.yml up -d --build`
- Mixed vendor with NVIDIA and AMD example: `docker compose -f docker-compose.yml -f docker-compose.nvidia.yml -f docker-compose.amd.yml up -d --build`

You can combine overlay files. Pawpile now routes models to the inference runtime that matches the selected device vendor.

AMD and Intel overrides require the corresponding kernel modules
loaded (`amdgpu` and `i915` respectively) and pass `/dev/kfd` / `/dev/dri` into the
inference container.

To target a specific AMD GPU architecture and shrink build time, override the
`AMDGPU_TARGETS` build arg, e.g. `--build-arg AMDGPU_TARGETS=gfx1100` for an
RX 7900 series card or `--build-arg AMDGPU_TARGETS=gfx1201` for a Radeon AI PRO
R9700. Pawpile forwards that value to llama.cpp's `GPU_TARGETS` build option.

## Docker Containers

- `frontend`: builds the Vite app and serves it from nginx.
- `backend`: runs FastAPI and remains the control plane for auth, devices, models, and API compatibility.
- `inference-*`: one or more vendor-specific inference runtimes manage `llama-server` subprocesses inside their own containers.


## Device Model

- Devices are auto-detected at startup from the running inference runtimes.
- New devices are persisted as disabled.
- Devices that disappear on a later restart are automatically disabled.
- Admin must explicitly enable devices before model assignment.
- Auto mode is supported for model assignment.
- Device priority is configurable.

## Model Workflow

1. Put GGUF files into `models/` or use the web UI to upload them.
2. Call scan endpoint to register discovered files.
3. Configure model metadata and device assignment.
4. Activate model to spawn dedicated llama-server process.
5. Only active models appear in chat selection and compatibility endpoint.

## OpenAI Compatible Example

OpenAI-compatible endpoints require authentication by default.
Provide a valid bearer token, which can be either a JWT access token or an API key.
To disable this behavior (not recommended), set OPENAI_API_AUTH_REQUIRED=false.

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_KEY_OR_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "my-model-alias",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

## OpenCode Config Example

Use this in your OpenCode config file to connect to Pawpile's OpenAI-compatible endpoint.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "pawpile": {
      "name": "pawpile",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://192.168.1.40:8000/v1",
        "timeout": 7200000
      },
      "models": {
        "gemma-4-26B-A4B-it-UD-Q4_K_M": {
          "name": "Gemma 4"
        }
      }
    }
  }
}
```

## Troubleshooting

### Docker Issues

- **Docker permission denied**:
  ```bash
  sudo usermod -aG docker $USER
  # Log out and back in, or use: newgrp docker
  ```

- **Docker image build fails**:
  - Check available disk space
  - Run `docker system prune` to clean up old images

### Device Detection Issues

- **Device not detected**:
  - Check vendor tooling is installed on the host system:
    - Ubuntu 26.04: `nvidia-smi`, `rocm-smi` (AMD), or `sycl-ls` (Intel Arc)
  - Ensure the appropriate GPU Docker runtime is configured and accessible to the environment.
  - Restart the application after installing drivers on the host.

### Model Issues

- **Model activation failed**:
  - Confirm `LLAMA_SERVER_PATH` in `.env` is set correctly inside the container (defaults to `/opt/llama.cpp/build/bin/llama-server`).
  - Confirm the model path exists and is readable under the `models/` directory in the project root (which is mounted into the containers).
  - Ensure sufficient host RAM is allocated for the model context size.

### Queueing Behavior

- **Queueing expected**: If a device is busy, requests are queued by policy (priority then FIFO).
  - This is normal behavior and not an error.
  - Monitor job queue in the admin UI.

## License

GPL-3.0 license 