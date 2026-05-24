# Pawpile

Pawpile turns your collection of GPUs (or CPUs) into a flexible, intuitive AI server. It features a clean web interface and a fully OpenAI-compatible API that's ready to integrate with your workflow - all running via Docker on Ubuntu 26.04. Pretty much any GGUF AI model will work - whether you want a small model for basic tasks or have a massive workstation, Pawpile makes it simple to get started with self-hosted LLMs.

It supports x86_64 CPUs, NVIDIA GPUs, AMD GPUs, and Intel Arc GPUs. You can have multiple cards and even mix multiple devices from different vendors in the same setup. Easy, private, and free.

## System Requirements

### Ubuntu 26.04

If it works on other operating systems, cool, but supporting that is outside the scope of this project.

### Docker

Ensure Docker is installed and running in the system context.

### Supported Devices

- **CPU**: x86_64
- **NVIDIA**: CUDA
- **AMD**: ROCm
- **Intel Arc**: Note: `xe` is the correct driver for supported Arc GPUs - `i915` is not supported.

### Quick Start

1. Clone or download the repository.

```bash
git clone https://github.com/michaelstaake/Pawpile.git
cd Pawpile
```

2. Copy environment file. The default settings should work for most users, but feel free to explore it to see what customization is offered.

```bash
cp .env.example .env
```

3. Run it. The base stack always starts the CPU inference runtime. Add one or more GPU profiles depending on the hardware in the host. You can mix multiple hardware types.

Choose one of these commands:

#### CPU:

```bash
docker compose up -d --build
```

#### CPU + NVIDIA:

```bash
docker compose --profile nvidia up -d --build
```

Ensure the NVIDIA Container Toolkit is installed and configured.

#### CPU + AMD:

```bash
docker compose --profile amd up -d --build
```

By default the AMD image lets llama.cpp and ROCm use their standard build target selection. If you need to pin a known-good GPU target for a deployment or build a custom multi-target image, set `AMDGPU_TARGETS` in `.env` before building. Use semicolons to provide multiple targets, for example `gfx1100;gfx1101;gfx1201`.

All inference images pin llama.cpp to a specific release via `LLAMA_CPP_TAG` (default `b9297`). Override this build arg in `.env` to upgrade or downgrade the llama.cpp version across all runtimes.

#### CPU + Intel:

```bash
docker compose --profile intel up -d --build
```

#### Mixed vendor example with NVIDIA and AMD:

```bash
docker compose --profile nvidia --profile amd up -d --build
```

The backend stores its SQLite database in a Docker-managed volume. Model files stay in `models/` and runtime logs stay in `logs/` on the host.

4. Add your AI models GGUF files under the `models/` directory or do this later using the Web UI.

5. Initial setup will take a long time as we are building llama-cpp based on your selected devices.

6. Once Docker reports the containers are healthy and started, open the Pawpile web interface: https://localhost:5173 or replace localhost with your server's local IP. You will receive an SSL error since Pawpile generates a self-signed SSL certificate. It is safe to bypass this error.

7. On a new install you will be redirected to the setup page where you can create your first admin account. Once your account is created, go to Settings > Devices and set up at least one CPU or GPU device, then go to Settings > Models to upload and enable at least one AI model to use Pawpile.

8. ENJOY! Next time you run Pawpile, run it without `--build` to speed up initialization.

9. To stop Pawpile, run:

```bash
docker compose down
```

This stops all containers regardless of which GPU profiles were active when you started.

## Interacting with the AI Models

### Web Interface Chat

You can chat with your enabled models through the web interface. This is the easiest but least powerful way to interact with Pawpile.

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
  - If you are using Ubuntu Desktop not Ubuntu Server and have Docker Desktop installed, ensure Pawpile is running in the system's context not Docker Desktop's context
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
  - On AMD, if the runtime log shows ROCm warmup failures or `invalid device function`, rebuild the AMD image first. If the default build still fails on a specific GPU family, set `AMDGPU_TARGETS` explicitly for that deployment and rebuild.
  - On AMD, you can also set `AMD_LLAMA_DISABLE_WARMUP=true` to skip llama.cpp warmup or provide additional AMD-only launch arguments with `AMD_LLAMA_EXTRA_ARGS`.

## License

GPL-3.0 license