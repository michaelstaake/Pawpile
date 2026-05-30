from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def _normalize_background_color(value: str | None) -> str:
    if value is None:
        return "#efe8d2"

    normalized = value.strip().lower()
    if not normalized:
        return "#efe8d2"

    if len(normalized) != 7 or not normalized.startswith("#"):
        raise ValueError("background_color must be a hex color like #efe8d2")

    if any(character not in "0123456789abcdef#" for character in normalized):
        raise ValueError("background_color must be a hex color like #efe8d2")

    return normalized


def normalize_message_content(content: Any) -> str:
    """Normalize OpenAI-style content to plain text for text-only backends.

    Supported inputs:
    - string content
    - list of content parts (only text parts are kept)
    """
    if content is None:
        return ""

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


def validate_openai_message_content(content: Any) -> str | list[dict[str, Any]]:
    """Validate OpenAI-style content while preserving multimodal parts."""
    if content is None:
        return ""

    if isinstance(content, str):
        return content

    if isinstance(content, list):
        normalized_parts: list[dict[str, Any]] = []
        for index, part in enumerate(content):
            if not isinstance(part, dict):
                raise ValueError(f"content part at index {index} must be an object")

            part_type = part.get("type")
            if not isinstance(part_type, str):
                raise ValueError(f"content part at index {index} is missing a valid type")

            if part_type == "text":
                text = part.get("text", "")
                if text is None:
                    text = ""
                if not isinstance(text, str):
                    raise ValueError(f"text content part at index {index} must have string text")
                normalized_parts.append({**part, "text": text})
                continue

            if part_type == "image_url":
                image_url = part.get("image_url")
                if not isinstance(image_url, dict):
                    raise ValueError(f"image_url content part at index {index} must have an image_url object")
                url = image_url.get("url")
                if not isinstance(url, str) or not url:
                    raise ValueError(f"image_url content part at index {index} must include a non-empty string url")
                normalized_parts.append(part)
                continue

            if part_type == "input_text":
                text = part.get("text", "")
                if text is None:
                    text = ""
                if not isinstance(text, str):
                    raise ValueError(f"input_text content part at index {index} must have string text")
                normalized_parts.append({**part, "text": text})
                continue

            if part_type == "input_image":
                image_url = part.get("image_url") or part.get("image")
                if not isinstance(image_url, str) or not image_url:
                    raise ValueError(f"input_image content part at index {index} must include a non-empty image string")
                normalized_parts.append(part)
                continue

            raise ValueError(f"unsupported content part type at index {index}: {part_type}")

        return normalized_parts

    raise ValueError("content must be a string or an array of content parts")


def content_includes_vision(content: str | list[dict[str, Any]] | None) -> bool:
    if not isinstance(content, list):
        return False

    for part in content:
        if not isinstance(part, dict):
            continue
        if part.get("type") in {"image_url", "input_image"}:
            return True

    return False


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
    last_used_at: str | None = None


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
    background_color: str = "#efe8d2"
    background_image_path: str | None = None
    background_image_mode: Literal["fill", "stretch", "repeat"] = "fill"

    @field_validator("background_color", mode="before")
    @classmethod
    def validate_background_color(cls, value: str | None) -> str:
        return _normalize_background_color(value)


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
    sitename: str = "Pawpile"
    background_color: str = "#efe8d2"
    background_image_path: str | None = None
    background_image_mode: Literal["fill", "stretch", "repeat"] = "fill"

    @field_validator("background_color", mode="before")
    @classmethod
    def validate_background_color(cls, value: str | None) -> str:
        return _normalize_background_color(value)


class AppSettingsUpdateRequest(BaseModel):
    users_can_register: bool | None = None
    sitename: str | None = None
    background_color: str | None = None
    background_image_mode: Literal["fill", "stretch", "repeat"] | None = None

    @field_validator("background_color", mode="before")
    @classmethod
    def validate_background_color(cls, value: str | None) -> str | None:
        if value is None:
            return None
        return _normalize_background_color(value)


class WebSearchProviderResponse(BaseModel):
    id: int
    provider_type: str
    display_name: str
    description: str
    enabled: bool
    api_key_set: bool
    result_count: int


class WebSearchProviderUpdateRequest(BaseModel):
    enabled: bool | None = None
    api_key: str | None = None
    result_count: int | None = Field(default=None, ge=1, le=20)


class ActiveProviderResponse(BaseModel):
    provider_type: str | None


class ActiveProviderUpdateRequest(BaseModel):
    provider_type: str | None


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
    max_slots: int | None = Field(default=None, ge=0)


class GpuPoolCreateRequest(BaseModel):
    name: str = Field(default="GPU Pool", min_length=1, max_length=120)
    vendor: str = Field(default="nvidia", min_length=1, max_length=32)
    device_ids: list[int] = Field(min_length=2)


class GpuPoolUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    vendor: str | None = Field(default=None, min_length=1, max_length=32)
    device_ids: list[int] = Field(min_length=2)


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
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    top_p: float | None = Field(default=None, ge=0.0, le=1.0)
    top_k: int | None = Field(default=None, ge=0)
    presence_penalty: float | None = Field(default=None, ge=-2.0, le=2.0)
    repetition_penalty: float | None = Field(default=None, ge=0.0)
    tool_calling_enabled: bool | None = None
    discourage_thinking: bool | None = None
    vision_enabled: bool | None = None
    web_search_enabled: bool | None = None
    assignment_mode: str | None = None
    pinned_device_id: int | None = None
    pinned_pool_id: int | None = None


class ChatMessageRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    role: str
    content: str | list[dict[str, Any]] | None = None
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    function_call: dict[str, Any] | None = None

    @field_validator("content", mode="before")
    @classmethod
    def _normalize_content(cls, value: Any) -> str | list[dict[str, Any]]:
        return validate_openai_message_content(value)

    def includes_tooling(self) -> bool:
        return (
            self.role == "tool"
            or self.tool_call_id is not None
            or bool(self.tool_calls)
            or self.function_call is not None
        )

    def includes_vision(self) -> bool:
        return content_includes_vision(self.content)


class ChatCreateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)


class ChatRenameRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class ChatMessageAppendRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    role: str = Field(min_length=1, max_length=32)
    content: str | list[dict[str, Any]]
    model_name: str | None = Field(default=None, alias="modelName", min_length=1, max_length=120)
    stats: "ChatMessageStatsRequest | None" = None

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


class ChatMessageStatsRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    model: str = Field(min_length=1, max_length=120)
    elapsed_seconds: float = Field(alias="elapsedSeconds", ge=0)
    prompt_tokens: int | None = Field(default=None, alias="promptTokens", ge=0)
    completion_tokens: int | None = Field(default=None, alias="completionTokens", ge=0)
    total_tokens: int | None = Field(default=None, alias="totalTokens", ge=0)
    tokens_per_second: float | None = Field(default=None, alias="tokensPerSecond", ge=0)


class AttachmentExtractionResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    content_type: str | None = Field(default=None, alias="contentType")
    size: int = Field(ge=0)
    status: Literal["ok", "unsupported", "error"]
    content: str | None = None
    detail: str | None = None
    truncated: bool = False
    extractor: str | None = None


class AttachmentExtractionResponse(BaseModel):
    attachments: list[AttachmentExtractionResult]


class OpenAIChatRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    model: str
    messages: list[ChatMessageRequest]
    stream: bool = False
    enable_thinking: bool | None = None
    temperature: float | None = None
    top_p: float | None = None
    top_k: int | None = Field(default=None, ge=0)
    presence_penalty: float | None = None
    repetition_penalty: float | None = Field(default=None, ge=0.0)
    max_tokens: int | None = None
    use_web_search: bool | None = None
    tools: list[dict[str, Any]] | None = None
    tool_choice: str | dict[str, Any] | None = None
    parallel_tool_calls: bool | None = None
    functions: list[dict[str, Any]] | None = None
    function_call: str | dict[str, Any] | None = None
    response_format: dict[str, Any] | None = None

    def requests_tooling(self) -> bool:
        return (
            bool(self.tools)
            or self.tool_choice is not None
            or self.parallel_tool_calls is not None
            or bool(self.functions)
            or self.function_call is not None
            or any(message.includes_tooling() for message in self.messages)
        )

    def requests_vision(self) -> bool:
        return any(message.includes_vision() for message in self.messages)
