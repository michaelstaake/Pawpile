# Pawpile

Pawpile turns your GPUs (or CPU) into a flexible, intuitive AI server. It features a clean web interface and a fully OpenAI-compatible API that's ready to integrate with your workflow - all running via Docker on Ubuntu 26.04. Pretty much any GGUF AI model will work - whether you want to run a small model on your laptop or want to run a massive model on a high end PC with multiple video cards, Pawpile makes it simple to get started self-hosting LLMs.

It supports x86_64 CPUs, NVIDIA GPUs, AMD GPUs, and Intel Arc GPUs. You can have multiple cards and even mix multiple devices in the same setup. You can also pool multiple GPUs (within the same vendor) to run larger models. Pawpile might have a goofy name but it's easy, private, and free, so hopefully you'll forgive that.

## System Requirements

### Supported Devices

- **CPU**: x86_64
- **NVIDIA GPU**: CUDA
- **AMD GPU**: Vulkan
- **Intel Arc GPU**: Vulkan

### Ubuntu 26.04

If it works on other operating systems, cool, but supporting that is outside the scope of this project. Ensure the correct GPU drivers and necessary extras (e.g., NVIDIA Container Toolkit) for your hardware are installed.

**If you are running Windows, that's OK - Pawpile works in WSL!** 

### Docker

Ensure Docker is installed and running in the system context and is using the correct runtimes for your hardware.

### Quick Start

**1. Clone or download the repository.**

Currently Pawpile is in beta and undergoing very rapid development, so this is the easiest way to download it. To update, just use git pull and restart the containers. Once the project is in a more stable state, we will use releases.

```bash
git clone https://github.com/michaelstaake/Pawpile.git
cd Pawpile
```

**2. Copy environment file.**

The default settings should work for most users, but feel free to explore it to see what customization is offered.

```bash
cp .env.example .env
```

**3. Run it.**

The base stack always includes the CPU inference runtime. Add one or more GPU profiles depending on the hardware in the host. You can mix multiple hardware types.

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

The initial build process may take a while depending on your environment and host performance, as we are building llama-cpp based on your chosen inference runtime.

Large models can also take several minutes to finish loading the first time they are activated during startup. If Docker marks the backend or inference containers unhealthy too early, increase `LLAMA_STARTUP_TIMEOUT_SECONDS` and the `STARTUP_HEALTHCHECK_*` values in `.env`.

**4. Proceed to web interface**

Once Docker reports the containers are healthy and started, open the Pawpile web interface: https://localhost:8443 or replace localhost with your server's local IP. You will receive an SSL error since Pawpile generates a self-signed SSL certificate. It is safe to bypass this error.

On a new install you will be redirected to the setup page where you can create your first admin account.

**5. Configure devices and pools**

Once your admin account is created, go to the Devices page and configure your inference devices.

If you have multiple GPUs of the same vendor, you can create a pool, which allows you to run larger models than would fit on a single GPU. Please note that once a GPU is in a pool, it can not be used on an individual basis until you remove it from the pool.

**6. Configure models**

Go to the Models page to configure your AI models. Models must be in GGUF format.

By default, models are in Auto mode for device selection. In this case, Pawpile will attempt to run the model on the most logical device or pool. However, if you want to pin a model to a specific device or pool, you may do so. Please ensure the device or pool has sufficient memory for the size of model you are running. Remember that the actual memory usage of a model may be higher than its file size, due to overhead, context, KV cache, etc.

**7. ENJOY!**

To stop Pawpile, use the command that matches the profiles you started with to ensure that all relevant containers are stopped. Docker Compose only stops services in the currently supplied profile set, so the `down` command must use the same profiles as `up`.

```bash
docker compose down
docker compose --profile nvidia down
docker compose --profile vulkan down
docker compose --profile nvidia --profile vulkan down
```

## Interacting with the AI Models

### Web Interface Chat

You can chat with your enabled models through the web interface.

### OpenAI-Compatible API

The API is the recommended way to use Pawpile through integrations with other software and platforms. Pawpile's API is OpenAI-Compatible, so you can easily integrate it into your workflow and applications.

By default, an API key is required to communicate with the API. To disable this behavior (not recommended), set OPENAI_API_AUTH_REQUIRED=false.

Pawpile currently supports `/v1/models` and `/v1/chat/completions`.

## Example API Call

```bash
curl http://localhost:8444/v1/chat/completions \
  -H "Authorization: Bearer API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model-alias",
    "messages": [{"role": "user", "content": "Hello"}],
    "stream": false
  }'
```

### Example Vision API Call

```bash
curl http://localhost:8444/v1/chat/completions \
  -H "Authorization: Bearer API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-vision-model-alias",
    "messages": [
      {
        "role": "user",
        "content": [
          {"type": "text", "text": "What is in this image?"},
          {
            "type": "image_url",
            "image_url": {
              "url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ..."
            }
          }
        ]
      }
    ],
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
        "baseURL": "http://localhost:8444/v1",
        "apiKey": "API_KEY",
        "timeout": 7200000
      },
      "models": {
        "ai-model": {
          "name": "AI Model"
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

- **Backend container is unhealthy after an update**:
  - Inspect `docker logs pawpile-backend` for migration errors
  - Version 0.6.0 must be a clean install - updates from previous versions are not supported.

- **Backend or inference container turns unhealthy while loading a large model**:
  - Increase `LLAMA_STARTUP_TIMEOUT_SECONDS` in `.env`
  - Increase one or more `STARTUP_HEALTHCHECK_*` values in `.env` so Docker waits longer before marking the service unhealthy

- **Docker Desktop**:
  - While Ubuntu Server 26.04 is the recommended OS, Pawpile runs great on  Ubuntu Desktop 26.04. However, if you have Docker Desktop installed, and attempt to run Pawpile using the Docker Desktop system context, it will not be able to use all the system resources like RAM and GPUs.
  - Run `docker context use default` to correct the system context.


### Device Detection Issues

- **Device not detected**:
  - Check vendor tooling is installed on the host system:
    - Ubuntu 26.04: `nvidia-smi` (NVIDIA) or `vulkaninfo` (AMD/Intel Arc)
  - Ensure the appropriate GPU Docker runtime is configured and accessible to the environment.
  - Restart the application after installing drivers on the host.

## Need Help?

[Documentation on GitHub Wiki](https://github.com/michaelstaake/Pawpile/wiki)
[Report Problems on GitHub Issues](https://github.com/michaelstaake/Pawpile/issues)

## License

GPL-3.0 license