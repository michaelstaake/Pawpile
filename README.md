# Pawpile

Pawpile turns your collection of GPUs (or CPUs) into a flexible, intuitive AI server. It features a clean web interface and a fully OpenAI-compatible API that's ready to integrate with your workflow - all running via Docker on Ubuntu 26.04. Pretty much any GGUF AI model will work - whether you want a small model for basic tasks or want to run a massive model on a high end PC, Pawpile makes it simple to get started self-hosting LLMs.

It supports x86_64 CPUs, NVIDIA GPUs, and AMD/Intel GPUs via Vulkan. You can have multiple cards and even mix multiple devices in the same setup. You can also pool multiple GPUs to run larger models (although at this time you can't mix NVIDIA and Vulkan devices in a pool). Pawpile might have a goofy name but it's easy, private, and free.

## System Requirements

### Supported Devices

- **CPU**: x86_64
- **NVIDIA GPU**: CUDA
- **AMD GPU**: Vulkan
- **Intel Arc GPU**: Vulkan

### Ubuntu 26.04

If it works on other operating systems, cool, but supporting that is outside the scope of this project. Ensure the correct GPU drivers and necessary extras (e.g., NVIDIA Container Toolkit) for your hardware are installed.

### Docker

Ensure Docker is installed and running in the system context and is using the correct runtimes for your hardware.

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

#### CPU + Vulkan (AMD/Intel Arc):

```bash
docker compose --profile vulkan up -d --build
```

#### CPU + NVIDIA + Vulkan (AMD/Intel Arc):

```bash
docker compose --profile nvidia --profile vulkan up -d --build
```

The backend stores its SQLite database in a Docker-managed volume. Model files stay in `models/` and runtime logs stay in `logs/` on the host.

4. Add your AI models GGUF files under the `models/` directory or do this later using the Web UI. Pawpile automatically scans this folder during initial setup and on each startup, so any `.gguf` files already present will be registered without a manual scan.

5. Initial setup will take a while as we are building llama-cpp based on your selected devices.

6. Once Docker reports the containers are healthy and started, open the Pawpile web interface: https://localhost:5173 or replace localhost with your server's local IP. You will receive an SSL error since Pawpile generates a self-signed SSL certificate. It is safe to bypass this error.

7. On a new install you will be redirected to the setup page where you can create your first admin account. Once your account is created, go to Settings > Devices and set up at least one CPU or GPU device, then go to Settings > Models to upload and enable at least one AI model to use Pawpile.

8. ENJOY! Next time you run Pawpile, run it without `--build` to speed up initialization.

9. To stop Pawpile, use the command that matches the profiles you started with:

```bash
docker compose down
```

For GPU-enabled stacks, use one of these instead:

```bash
docker compose --profile nvidia down
docker compose --profile vulkan down
docker compose --profile nvidia --profile vulkan down
```

Docker Compose only stops services in the currently supplied profile set, so the `down` command must use the same profiles as `up`.

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
    - Ubuntu 26.04: `nvidia-smi` (NVIDIA) or `vulkaninfo` (AMD/Intel Arc)
  - Ensure the appropriate GPU Docker runtime is configured and accessible to the environment.
  - Restart the application after installing drivers on the host.

### Model Issues

- **Model activation failed**:
  - Confirm `LLAMA_SERVER_PATH` in `.env` is set correctly inside the container (defaults to `/opt/llama.cpp/build/bin/llama-server`).
  - Confirm the model path exists and is readable under the `models/` directory in the project root (which is mounted into the containers).
  - Ensure the models are not too large for the device you are running it on.

## License

GPL-3.0 license