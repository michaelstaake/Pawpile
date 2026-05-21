from functools import lru_cache
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


RUNTIME_VENDOR_KEYS = {"cpu", "nvidia", "amd", "intel", "default"}


def _default_llama_server_path() -> str:
    return "/opt/llama.cpp/build/bin/llama-server"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "Pawpile"
    app_env: str = "development"
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    app_log_level: str = "INFO"

    database_url: str = "sqlite:///./data/pawpile.db"

    jwt_secret: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 1440
    openai_api_auth_required: bool = True

    models_dir: str = "./models"
    data_dir: str = "./data"
    logs_dir: str = "./logs"

    llama_server_path: str = _default_llama_server_path()
    llama_host: str = "127.0.0.1"
    llama_base_port: int = 9100
    llama_health_timeout_seconds: int = 5
    llama_startup_timeout_seconds: int = 120
    llama_request_timeout_seconds: int = 300

    default_context_length: int = 8192
    default_threads: int = 8
    default_gpu_layers: int = 0

    queue_max_size: int = 1000
    queue_poll_interval_ms: int = 100

    frontend_origin: str = "http://localhost:5173"
    supported_devices: str = ""
    inference_service_url: str = "http://localhost:8100"
    inference_runtime_urls: str = ""
    inference_service_timeout_seconds: int = 300
    max_upload_size_mb: int = 50000

    def supported_device_list(self) -> list[str]:
        return [item.strip().lower() for item in self.supported_devices.split(",") if item.strip()]

    def inference_runtime_url_map(self) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for entry in self.inference_runtime_urls.split(","):
            item = entry.strip()
            if not item or "=" not in item:
                continue
            vendor, url = item.split("=", 1)
            key = vendor.strip().lower()
            value = url.strip().rstrip("/")
            if key in RUNTIME_VENDOR_KEYS and value:
                mapping[key] = value

        if mapping:
            return mapping

        return {"default": self.inference_service_url.rstrip("/")}

    def inference_runtime_url_for_vendor(self, vendor: str) -> str | None:
        mapping = self.inference_runtime_url_map()
        return mapping.get(vendor.strip().lower()) or mapping.get("default")


@lru_cache
def get_settings() -> Settings:
    return Settings()
