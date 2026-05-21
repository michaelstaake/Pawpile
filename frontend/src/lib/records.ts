export type UserRecord = {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  password?: string;
};

export type ApiKeyRecord = {
  id: number;
  user_id: number;
  user_username: string;
  name: string;
  created_at: string | null;
};

export type ModelRecord = {
  id: number;
  priority: number;
  file_name: string;
  file_path: string;
  alias: string;
  description: string;
  system_prompt: string;
  chat_template: string;
  context_length: number;
  gpu_layers: number;
  threads: number;
  assignment_mode: string;
  pinned_device_id: number | null;
  activated: boolean;
};

export type DeviceRecord = {
  id: number;
  hardware_id: string;
  name: string;
  vendor: string;
  device_type: string;
  memory_mb: number;
  enabled: boolean;
  priority: number;
  max_threads: number;
  max_slots: number;
};

export type StatusModelRecord = {
  model_id: number;
  alias: string;
  memory_used_mb: number;
  pid: number | null;
};

export type DeviceStatusRecord = {
  id: number;
  hardware_id: string;
  name: string;
  vendor: string;
  device_type: string;
  enabled: boolean;
  priority: number;
  max_slots: number;
  max_threads: number;
  memory_total_mb: number;
  memory_used_mb: number;
  usage_percent: number | null;
  usage_source: string;
  memory_source: string;
  models: StatusModelRecord[];
};

export type StatusResponse = {
  status: string;
  refreshed_at: string;
  devices: DeviceStatusRecord[];
  runtime_errors: {
    vendor: string;
    base_url: string;
    detail: string;
  }[];
};

export type ScanResponse = {
  status: string;
  discovered: number;
  added: number;
};

export type UploadResponse = {
  status: string;
  model: ModelRecord;
};

export type ModelUpdateResponse = {
  status: string;
  model: ModelRecord;
};

export type DeviceUpdateResponse = {
  status: string;
  device: DeviceRecord;
};

export type UserUpdateResponse = {
  status: string;
  user: UserRecord;
};

export type AppSettingsRecord = {
  allow_anonymous_chat: boolean;
  users_can_register: boolean;
  auto_load_enabled_models_on_startup: boolean;
  sitename: string;
};

export type ApiKeyCreateResponse = {
  status: string;
  api_key: ApiKeyRecord;
  plain_text_key: string;
};