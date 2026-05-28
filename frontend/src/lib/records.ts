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
  last_used_at: string | null;
};

export type ModelRecord = {
  id: number;
  priority: number;
  file_name: string;
  model_dir_name: string;
  file_path: string;
  file_size: number | null;
  alias: string;
  description: string;
  system_prompt: string;
  chat_template: string;
  max_context_length: number | null;
  context_length: number;
  gpu_layers: number;
  threads: number;
  temperature: number;
  top_p: number;
  top_k: number;
  presence_penalty: number;
  repetition_penalty: number;
  tool_calling_enabled: boolean;
  thinking_enabled: boolean;
  vision_enabled: boolean;
  mmproj_file_name: string | null;
  assignment_mode: string;
  pinned_device_id: number | null;
  pinned_pool_id: number | null;
  activated: boolean;
};

export type DeviceRecord = {
  id: number;
  hardware_id: string;
  stable_hardware_id: string | null;
  stable_hardware_id_source: string | null;
  display_suffix: string;
  name: string;
  vendor: string;
  device_type: string;
  memory_mb: number;
  enabled: boolean;
  priority: number;
  max_threads: number;
  max_slots: number;
};

export type GpuPoolRecord = {
  id: number;
  name: string;
  vendor: string;
  devices: DeviceRecord[];
};

export type StatusModelRecord = {
  model_id: number;
  alias: string;
  file_name: string;
  memory_used_mb: number;
  display_memory_used_mb: number;
  pid: number | null;
};

export type DeviceStatusRecord = {
  id: number;
  hardware_id: string;
  stable_hardware_id: string | null;
  stable_hardware_id_source: string | null;
  display_suffix: string;
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
  system_cpu_usage_percent: number | null;
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

export type AssetUploadResponse = {
  status: string;
  uploaded: string[];
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
  users_can_register: boolean;
  sitename: string;
};

export type ApiKeyCreateResponse = {
  status: string;
  api_key: ApiKeyRecord;
  plain_text_key: string;
};

export type ActivityLogRecord = {
  id: number;
  created_at: string | null;
  event_type: string;
  user_id: number | null;
  username: string | null;
  ip_address: string | null;
  details: string | null;
};

export type LogsResponse = {
  total: number;
  page: number;
  page_size: number;
  items: ActivityLogRecord[];
};

export type DockerContainersResponse = {
  containers: string[];
};

export type DockerLogsResponse = {
  container: string;
  lines: string[];
};