from pydantic import BaseModel, Field


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
    allow_anonymous_chat: bool = True
    users_can_register: bool = False


class BootstrapAdminRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=255)


class UserRegistrationRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=8, max_length=255)


class AppSettingsResponse(BaseModel):
    allow_anonymous_chat: bool = True
    users_can_register: bool = False


class AppSettingsUpdateRequest(BaseModel):
    allow_anonymous_chat: bool | None = None
    users_can_register: bool | None = None


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
    content: str


class ChatCreateRequest(BaseModel):
    title: str | None = Field(default=None, max_length=255)


class ChatRenameRequest(BaseModel):
    title: str = Field(min_length=1, max_length=255)


class ChatMessageAppendRequest(BaseModel):
    role: str = Field(min_length=1, max_length=32)
    content: str = Field(min_length=1)


class OpenAIChatRequest(BaseModel):
    model: str
    messages: list[ChatMessageRequest]
    stream: bool = False
    temperature: float | None = 0.7
    max_tokens: int | None = 512
