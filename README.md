# Pawpile

Pawpile is a mostly vibe-coded self-hosted AI platform designed to run completely in Docker on Ubuntu. It gives you a web UI where you can manage devices, models, users, and auth for web chat or to expose an OpenAI-compatible API to your local network.

## The Problem Pawpile Solves

Hardware to run AI locally is expensive, but cloud AI solution pricing keeps going up and transparency and accountability keeps going down. Pawpile lets you run models of your choice on the hardware of your choice. It can run models on CPU/system RAM or using NVIDIA, AMD, or Intel Arc GPUs.

## System Requirements

### Ubuntu 26.04

If it works on other operating systems, cool, but supporting that is outside the scope of this project.

### Docker

Ensure Docker is installed and running in the system context.

### Supported Devices

- **CPU**: x86_64
- **NVIDIA**: CUDA
- **AMD**: ROCm
- **Intel Arc**: Note: `xe` is the correct driver for supported Arc GPUs — `i915` is not supported.

### Quick Start

1. Clone or download the repository.

```bash
git clone https://github.com/michaelstaake/Pawpile.git
cd Pawpile
```

2. Copy environment file.

```bash
cp .env.example .env
```

3. Run it. The base stack always starts the CPU inference runtime. Add one or more vendor runtime overlays depending on the hardware in the host. You can mix different hardware types.

Choose one of these commands:

#### CPU only:

```bash
docker compose up -d --build
```

#### NVIDIA:

```bash
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml up -d --build
```

#### AMD (ROCm):

```bash
docker compose -f docker-compose.yml -f docker-compose.amd.yml up -d --build
```

#### Intel (oneAPI / Level Zero):

```bash
docker compose -f docker-compose.yml -f docker-compose.intel.yml up -d --build
```

#### Mixed vendor example with NVIDIA and AMD:

```bash
docker compose -f docker-compose.yml -f docker-compose.nvidia.yml -f docker-compose.amd.yml up -d --build
```

The backend stores its SQLite database in a Docker-managed volume. Model files stay in `models/` and runtime logs stay in `logs/` on the host.

4. Add your AI models GGUF files under the `models/` directory or do this later using the Web UI.

5. Initial setup will take a long time as we are building llama-cpp based on your selected devices.

6. Once Docker reports the containers are healthy and started, open the Pawpile web interface: http://localhost:5173 or replace localhost with your server's local IP.

7. On a new install you will be redirected to the setup page. Once you have created your initial admin user and selected a device and model to start with, you can use Pawpile.

8. Next time you run Pawpile, run it without --build to speed up initialization.

## Interacting with the AI Models

### Web Interface Chat

You can chat with your enabled models through the web interface. This is the easiest, but least powerful way to interact with Pawpile.

### OpenAI Compatible API

OpenAI-compatible endpoints require authentication by default.
Provide a valid bearer token, which can be either a JWT access token or an API key.
To disable this behavior (not recommended), set OPENAI_API_AUTH_REQUIRED=false.

Pawpile currently supports `/v1/models` and `/v1/chat/completions`.

Tool-calling fields on chat-completions requests are forwarded to the active runtime. Tool-bearing requests are rejected unless tool calling is enabled for that particular model.

```bash
curl http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model-alias",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

## OpenCode Config Example

Use this in your OpenCode config file to connect to Pawpile's OpenAI-compatible endpoint. If OPENAI_API_AUTH_REQUIRED=false, apiKey is optional and can be omitted or set to any placeholder value.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "pawpile": {
      "name": "pawpile",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:8000/v1",
        "apiKey": "YOUR_API_KEY",
        "timeout": 7200000
      },
      "models": {
        "your-model-alias": {
          "name": "My AI Model"
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

- **Docker Desktop**:
  - If you have Docker Desktop installed, ensure Pawpile is running in the system's context not Docker Desktop's context
  - Run `docker context use default` to correct the system context.


### Device Detection Issues

- **Device not detected**:
  - Check vendor tooling is installed on the host system:
    - Ubuntu 26.04: `nvidia-smi` (NVIDIA), `rocm-smi` (AMD), or `sycl-ls` (Intel Arc)
  - Ensure the appropriate GPU Docker runtime is configured and accessible to the environment.
  - Restart the application after installing drivers on the host.

### Model Issues

- **Model activation failed**:
  - Confirm `LLAMA_SERVER_PATH` in `.env` is set correctly inside the container (defaults to `/opt/llama.cpp/build/bin/llama-server`).
  - Confirm the model path exists and is readable under the `models/` directory in the project root (which is mounted into the containers).
  - Ensure the models are not too large for the device you are running it on.

## License

GPL-3.0 license