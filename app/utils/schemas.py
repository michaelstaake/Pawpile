from typing import Any

from pydantic import BaseModel, Field, field_validator


def normalize_message_content(content: Any) -> str:
    """Normalize OpenAI-style content to plain text for text-only backends.

    Supported inputs:
    - string content
    - list of content parts (only text parts are kept)
    """
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        text_parts: list[str] = []
        for index, part in enumerate(content):
            if not isinstance(part, dict):
                raise ValueError(f"content part at index {index} must be an object")

            part_type = part.get("type")
            if not isinstance(part_type, str):
                raise ValueError(f"content part at index {index} is missing a valid type")

            if part_type != "text":
                # Non-text parts are currently ignored.
                continue

            text = part.get("text", "")
            if text is None:
                text = ""
            if not isinstance(text, str):
                raise ValueError(f"text content part at index {index} must have string text")
            text_parts.append(text)

        return "\n".join(text_parts)

    raise ValueError("content must be a string or an array of content parts")


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserResponse(BaseModel):
    id: int
    username: str
    email: str
    is_admin: bool
    is_active: bool


class ProfileUpdateRequest(BaseModel):
    email: str | None = Field(default=None, min_length=3, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=255)


class ApiKeyResponse(BaseModel):
    id: int
    user_id: int
    user_username: str
    name: str
    created_at: str | None = None


class ApiKeyCreateResponse(BaseModel):
    status: str
    api_key: ApiKeyResponse
    plain_text_key: str


class BootstrapStatusResponse(BaseModel):
    requires_setup: bool
    has_admin_user: bool = False
    has_enabled_device: bool = False
    has_active_model: bool = False
    users_can_register: bool = False
    sitename: str = "Pawpile"


class BootstrapAdminRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=255)


class UserRegistrationRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=255)


class AppSettingsResponse(BaseModel):
    users_can_register: bool = False
    auto_load_enabled_models_on_startup: bool = False
    sitename: str = "Pawpile"


class AppSettingsUpdateRequest(BaseModel):
    users_can_register: bool | None = None
    auto_load_enabled_models_on_startup: bool | None = None
    sitename: str | None = None


class UserCreateRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=255)
    is_admin: bool = False
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    username: str | None = Field(default=None, min_length=3, max_length=64)
    email: str | None = Field(default=None, min_length=3, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=255)
    is_admin: bool | None = None
    is_active: bool | None = None


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class DeviceUpdateRequest(BaseModel):
    name: str | None = None
    enabled: bool | None = None
    priority: int | None = None
    max_threads: int | None = None
    max_slots: int | None = None


class DeviceReorderItem(BaseModel):
    id: int
    priority: int


class DeviceReorderRequest(BaseModel):
    devices: list[DeviceReorderItem]


class ModelReorderItem(BaseModel):
    id: int
    priority: int


class ModelReorderRequest(BaseModel):
    models: list[ModelReorderItem]


class ModelUpdateRequest(BaseModel):
    alias: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    chat_template: str | None = None
    context_length: int | None = Field(default=None, ge=256)
    gpu_layers: int | None = None
    threads: int | None = Field(default=None, ge=1)
    assignment_mode: str | None = None
    pinned_device_id: int | None = None


class ChatMessageRequest(BaseModel):
    role: str
    content: str | list[dict[str, Any]]

    @field_validator("content", mode="before")
    @classmethod
    def _normalize_content(cls, value: Any) -> str:
        return normalize_message_content(value)


class ChatCreateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)


class ChatRenameRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class ChatMessageAppendRequest(BaseModel):
    role: str = Field(min_length=1, max_length=32)
    content: str | list[dict[str, Any]]

    @field_validator("content", mode="before")
    @classmethod
    def _normalize_content(cls, value: Any) -> str:
        return normalize_message_content(value)

    @field_validator("content")
    @classmethod
    def _require_non_empty_content(cls, value: str) -> str:
        if len(value) < 1:
            raise ValueError("content must not be empty")
        return value


class OpenAIChatRequest(BaseModel):
    model: str
    messages: list[ChatMessageRequest]
    stream: bool = False
    temperature: float | None = 0.7
    max_tokens: int | None = 512
