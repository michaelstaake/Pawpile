import type { BackgroundImageMode } from "./session";

export type KnowledgeBaseDocumentRecord = {
  id: number;
  user_id: number;
  title: string;
  content: string;
  created_at: string | null;
  updated_at: string | null;
};

export type WebSearchProviderRecord = {
  id: number;
  provider_type: string;
  display_name: string;
  description: string;
  enabled: boolean;
  api_key_set: boolean;
  result_count: number;
};

export type ActiveProviderRecord = {
  provider_type: string | null;
};

export type FetchProgressRecord = {
  job_id: string;
  status: "downloading" | "processing" | "completed" | "error";
  downloaded: number;
  total: number | null;
  percent: number;
  file_name: string | null;
  model: Record<string, unknown> | null;
  error: string | null;
};

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
  discourage_thinking: boolean;
  vision_enabled: boolean;
  web_search_enabled: boolean;
  rag_enabled: boolean;
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

export type TokenUsageMetricRecord = {
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
};

export type TopTokenUserRecord = {
  username: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
} | null;

export type TokenUsageSummaryRecord = {
  since_startup: TokenUsageMetricRecord;
  last_1_hour: TokenUsageMetricRecord;
  last_24_hours: TokenUsageMetricRecord;
  last_7_days: TokenUsageMetricRecord;
  last_30_days: TokenUsageMetricRecord;
  forever: TokenUsageMetricRecord;
  top_user_last_24_hours: TopTokenUserRecord;
  top_user_forever: TopTokenUserRecord;
};

export type StatusResponse = {
  status: string;
  refreshed_at: string;
  system_cpu_usage_percent: number | null;
  system_disk_free_bytes: number;
  input_tokens_processed: number;
  output_tokens_processed: number;
  tokens_processed: number;
  token_usage: TokenUsageSummaryRecord;
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

export type ModelActivationResponse = {
  status: string;
  model_id: number;
  device_id?: number;
  pool_id?: number;
  elapsed_seconds?: number;
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
  background_color: string;
  background_image_path: string | null;
  background_image_mode: BackgroundImageMode;
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