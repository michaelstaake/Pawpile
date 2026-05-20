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
├── data/
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

3. Add GGUF files under models directory.

```bash
mkdir -p models
# put your *.gguf files in ./models
```

4. Start services.

```bash
docker compose up -d --build
```

5. Wait for services to become healthy (typically 30-60 seconds).

6. Open in your browser:
- **Frontend**: http://localhost:5173
- **API docs**: http://localhost:8000/docs

7. On first launch, create an admin account through the web UI or via API:

```bash
curl -X POST http://localhost:8000/api/auth/bootstrap-admin \
  -H "Content-Type: application/json" \
  -d '{
    "username": "admin",
    "email": "admin@localhost",
    "password": "your-secure-password"
  }'
```

### Optional GPU Overrides

CPU mode is the base stack. Layer a vendor override on top when the host runtime supports it.

- NVIDIA: `docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d --build`
- AMD (ROCm, Linux host): `docker compose -f docker-compose.yml -f docker-compose.amd.yml up -d --build`
- Intel (oneAPI / Level Zero, Linux host): `docker compose -f docker-compose.yml -f docker-compose.intel.yml up -d --build`

AMD and Intel overrides require the corresponding kernel modules
loaded (`amdgpu` and `i915` respectively) and pass `/dev/kfd` / `/dev/dri` into the
inference container.

To target a specific AMD GPU architecture and shrink build time, override the
`AMDGPU_TARGETS` build arg, e.g. `--build-arg AMDGPU_TARGETS=gfx1100` for an
RX 7900 series card.

## Platform Support Matrix

| Platform | CPU | NVIDIA | AMD | Intel Arc |
| --- | --- | --- | --- | --- |
| Docker on Ubuntu | Supported | Supported | Supported | Supported |

## Docker Architecture

- `frontend`: builds the Vite app and serves it from nginx.
- `backend`: runs FastAPI and remains the control plane for auth, devices, models, and API compatibility.
- `inference`: runs a dedicated inference service that manages `llama-server` subprocesses inside its own container.

The backend no longer needs a host-local `llama-server`. It talks to the inference service over HTTP.

## Authentication

- On first launch, create the initial admin account through the web UI or `POST /api/auth/bootstrap-admin`.
- Check whether first-run setup is needed with `GET /api/auth/bootstrap-status`.
- Login at `POST /api/auth/login`.
- Use returned JWT as Bearer token.
- OpenAI-compatible endpoints are open by default.
- Set `OPENAI_API_AUTH_REQUIRED=true` if you want `/v1/*` to require a JWT or per-user API key.
- Per-user API keys can be created in the admin UI and used in `Authorization: Bearer <key>` for compatibility clients when auth is enabled.

## Device Model

- Devices are auto-detected at startup.
- New devices are persisted as disabled.
- Admin must explicitly enable devices before model assignment.
- Auto mode is supported for model assignment.
- Device priority is configurable.

## Model Workflow

1. Put GGUF files into `models/`.
2. Call scan endpoint to register discovered files.
3. Configure model metadata and device assignment.
4. Activate model to spawn dedicated llama-server process.
5. Only active models appear in chat selection and compatibility endpoint.

## API Endpoints (Initial)

- Auth
  - GET /api/auth/bootstrap-status
  - POST /api/auth/bootstrap-admin
  - POST /api/auth/login
- Admin
  - GET /api/admin/users
  - POST /api/admin/users
  - PATCH /api/admin/users/{id}
  - GET /api/admin/api-keys
  - POST /api/admin/users/{id}/api-keys
  - DELETE /api/admin/api-keys/{id}
- Device management
  - GET /api/devices
  - PATCH /api/devices/{id}
  - POST /api/devices/reorder
- Model management
  - GET /api/models
  - POST /api/models/scan
  - PATCH /api/models/{id}
  - POST /api/models/{id}/activate
  - POST /api/models/{id}/deactivate
- OpenAI compatibility
  - GET /v1/models
  - POST /v1/chat/completions

## OpenAI Compatibility Example

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

## Logs and Data

- SQLite DB: `data/pawpile.db`
- Runtime logs: `logs/`
- Models: `models/`

## Troubleshooting

### OS Compatibility Issues

- **Unsupported OS**: Ensure your host system meets the prerequisites. Using Docker isolates application dependencies, but you still need appropriate kernel drivers and runtime support (like NVIDIA Container Toolkit).

### Docker Issues

- **Docker permission denied (Linux)**:
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