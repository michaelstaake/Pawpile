import { FormEvent, useEffect, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPostFormWithProgress } from "../lib/api";

type LoginResponse = {
  access_token: string;
  token_type: string;
};

type BootstrapStatus = {
  requires_setup: boolean;
};

type UserRecord = {
  id: number;
  username: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  password?: string;
};

type ApiKeyRecord = {
  id: number;
  user_id: number;
  user_username: string;
  name: string;
  created_at: string | null;
};

type ModelRecord = {
  id: number;
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

type DeviceRecord = {
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

type ScanResponse = {
  status: string;
  discovered: number;
  added: number;
};

type UploadResponse = {
  status: string;
  model: ModelRecord;
};

type ModelUpdateResponse = {
  status: string;
  model: ModelRecord;
};

type DeviceUpdateResponse = {
  status: string;
  device: DeviceRecord;
};

type UserResponse = {
  status: string;
  user: UserRecord;
};

type ApiKeyCreateResponse = {
  status: string;
  api_key: ApiKeyRecord;
  plain_text_key: string;
};

type UploadProgressState = {
  loaded: number;
  total: number;
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

const ADMIN_TOKEN_KEY = "pawpile.adminToken";
const ASSIGNMENT_MODE_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Pinned device", value: "pinned" }
] as const;

export default function SettingsPage() {
  const [token, setToken] = useState<string>(() => window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? "");
  const [requiresSetup, setRequiresSetup] = useState(false);
  const [isCheckingSetup, setIsCheckingSetup] = useState(true);

  const [loginUsername, setLoginUsername] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("");
  const [bootstrapUsername, setBootstrapUsername] = useState("admin");
  const [bootstrapEmail, setBootstrapEmail] = useState("admin@localhost");
  const [bootstrapPassword, setBootstrapPassword] = useState("");

  const [models, setModels] = useState<ModelRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>({ loaded: 0, total: 0 });
  const [newUser, setNewUser] = useState({ username: "", email: "", password: "", is_admin: false, is_active: true });
  const [newApiKey, setNewApiKey] = useState({ user_id: "", name: "" });
  const [latestApiKey, setLatestApiKey] = useState("");

  const [isLoadingDashboard, setIsLoadingDashboard] = useState(false);
  const [isSubmittingLogin, setIsSubmittingLogin] = useState(false);
  const [isSubmittingBootstrap, setIsSubmittingBootstrap] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [savingModelId, setSavingModelId] = useState<number | null>(null);
  const [togglingModelId, setTogglingModelId] = useState<number | null>(null);
  const [savingDeviceId, setSavingDeviceId] = useState<number | null>(null);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [isCreatingApiKey, setIsCreatingApiKey] = useState(false);
  const [revokingApiKeyId, setRevokingApiKeyId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    void checkBootstrapStatus();
  }, []);

  useEffect(() => {
    if (!token || requiresSetup) {
      return;
    }
    void refreshDashboard(token);
  }, [token, requiresSetup]);

  async function checkBootstrapStatus() {
    setIsCheckingSetup(true);
    try {
      const response = await apiGet<BootstrapStatus>("/api/auth/bootstrap-status");
      setRequiresSetup(response.requires_setup);
      if (response.requires_setup) {
        window.localStorage.removeItem(ADMIN_TOKEN_KEY);
        setToken("");
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to check setup state");
    } finally {
      setIsCheckingSetup(false);
    }
  }

  async function refreshDashboard(nextToken: string) {
    setIsLoadingDashboard(true);
    try {
      const [modelsResponse, devicesResponse, usersResponse, keysResponse] = await Promise.all([
        apiGet<ModelRecord[]>("/api/models", nextToken),
        apiGet<DeviceRecord[]>("/api/devices", nextToken),
        apiGet<UserRecord[]>("/api/admin/users", nextToken),
        apiGet<ApiKeyRecord[]>("/api/admin/api-keys", nextToken)
      ]);
      setModels(modelsResponse);
      setDevices(devicesResponse);
      setUsers(usersResponse.map((user) => ({ ...user, password: "" })));
      setApiKeys(keysResponse);
      setNewApiKey((current) => ({
        ...current,
        user_id: current.user_id || (usersResponse[0] ? String(usersResponse[0].id) : "")
      }));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load admin data");
    } finally {
      setIsLoadingDashboard(false);
    }
  }

  async function handleBootstrap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmittingBootstrap(true);

    try {
      const response = await apiPost<{ username: string; email: string; password: string }, LoginResponse>("/api/auth/bootstrap-admin", {
        username: bootstrapUsername,
        email: bootstrapEmail,
        password: bootstrapPassword
      });
      window.localStorage.setItem(ADMIN_TOKEN_KEY, response.access_token);
      setToken(response.access_token);
      setRequiresSetup(false);
      setBootstrapPassword("");
      setSuccessMessage("Initial admin account created.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Initial admin creation failed";
      if (message.includes("Request failed: 500")) {
        setErrorMessage("Initial admin creation failed with a server error. On Linux hosts, check backend logs and ensure the ./data directory is writable by Docker before retrying.");
      } else {
        setErrorMessage(message);
      }
    } finally {
      setIsSubmittingBootstrap(false);
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");
    setIsSubmittingLogin(true);

    try {
      const response = await apiPost<{ username: string; password: string }, LoginResponse>("/api/auth/login", {
        username: loginUsername,
        password: loginPassword
      });
      window.localStorage.setItem(ADMIN_TOKEN_KEY, response.access_token);
      setToken(response.access_token);
      setLoginPassword("");
      setSuccessMessage("Admin session ready.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Login failed");
    } finally {
      setIsSubmittingLogin(false);
    }
  }

  function handleLogout() {
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    setToken("");
    setUsers([]);
    setApiKeys([]);
    setDevices([]);
    setModels([]);
    setLatestApiKey("");
    setSuccessMessage("Admin session cleared.");
    setErrorMessage("");
  }

  function updateModelDraft(modelId: number, updates: Partial<ModelRecord>) {
    setModels((current) => current.map((model) => (model.id === modelId ? { ...model, ...updates } : model)));
  }

  function updateDeviceDraft(deviceId: number, updates: Partial<DeviceRecord>) {
    setDevices((current) => current.map((device) => (device.id === deviceId ? { ...device, ...updates } : device)));
  }

  function updateUserDraft(userId: number, updates: Partial<UserRecord>) {
    setUsers((current) => current.map((user) => (user.id === userId ? { ...user, ...updates } : user)));
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      setErrorMessage("Choose a .gguf file to upload.");
      return;
    }
    if (!token) {
      setErrorMessage("Sign in as an admin before uploading models.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    setErrorMessage("");
    setSuccessMessage("");
    setIsUploading(true);
    setUploadProgress({ loaded: 0, total: selectedFile.size });
    try {
      const response = await apiPostFormWithProgress<UploadResponse>("/api/models/upload", formData, token, (progress) => {
        setUploadProgress({
          loaded: progress.loaded,
          total: progress.total || selectedFile.size,
        });
      });
      setModels((current) => [response.model, ...current.filter((model) => model.id !== response.model.id)].sort((left, right) => left.alias.localeCompare(right.alias)));
      setSelectedFile(null);
      const input = document.getElementById("model-upload-input") as HTMLInputElement | null;
      if (input) {
        input.value = "";
      }
      setUploadProgress({ loaded: selectedFile.size, total: selectedFile.size });
      setSuccessMessage(`Uploaded ${response.model.file_name}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleScan() {
    if (!token) {
      setErrorMessage("Sign in as an admin before scanning the models folder.");
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setIsScanning(true);
    try {
      const response = await apiPost<Record<string, never>, ScanResponse>("/api/models/scan", {}, token);
      await refreshDashboard(token);
      setSuccessMessage(`Scan finished. Found ${response.discovered} files and added ${response.added} new models.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Scan failed");
    } finally {
      setIsScanning(false);
    }
  }

  async function handleModelSave(model: ModelRecord) {
    if (!token) {
      return;
    }
    setSavingModelId(model.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await apiPatch<Record<string, string | number | null>, ModelUpdateResponse>(`/api/models/${model.id}`, {
        alias: model.alias,
        description: model.description,
        system_prompt: model.system_prompt,
        chat_template: model.chat_template,
        context_length: model.context_length,
        gpu_layers: model.gpu_layers,
        threads: model.threads,
        assignment_mode: model.assignment_mode,
        pinned_device_id: model.assignment_mode === "pinned" ? model.pinned_device_id : null
      }, token);
      setModels((current) => current.map((item) => (item.id === model.id ? response.model : item)));
      setSuccessMessage(`Saved settings for ${response.model.alias}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Model update failed");
    } finally {
      setSavingModelId(null);
    }
  }

  async function handleModelToggle(model: ModelRecord) {
    if (!token) {
      return;
    }
    setTogglingModelId(model.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await apiPost<Record<string, never>, { status: string }>(`/api/models/${model.id}/${model.activated ? "deactivate" : "activate"}`, {}, token);
      await refreshDashboard(token);
      setSuccessMessage(`${model.activated ? "Deactivated" : "Activated"} ${model.alias}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Model toggle failed");
    } finally {
      setTogglingModelId(null);
    }
  }

  async function handleDeviceSave(device: DeviceRecord) {
    if (!token) {
      return;
    }
    setSavingDeviceId(device.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await apiPatch<Record<string, string | number | boolean>, DeviceUpdateResponse>(`/api/devices/${device.id}`, {
        name: device.name,
        enabled: device.enabled,
        priority: device.priority,
        max_threads: device.max_threads,
        max_slots: device.max_slots
      }, token);
      setDevices((current) => current.map((item) => (item.id === device.id ? response.device : item)));
      setSuccessMessage(`Saved device settings for ${response.device.name}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Device update failed");
    } finally {
      setSavingDeviceId(null);
    }
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }
    setIsCreatingUser(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await apiPost<typeof newUser, UserResponse>("/api/admin/users", newUser, token);
      setUsers((current) => [...current, { ...response.user, password: "" }].sort((left, right) => left.username.localeCompare(right.username)));
      setNewUser({ username: "", email: "", password: "", is_admin: false, is_active: true });
      setNewApiKey((current) => ({ ...current, user_id: current.user_id || String(response.user.id) }));
      setSuccessMessage(`Created user ${response.user.username}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "User creation failed");
    } finally {
      setIsCreatingUser(false);
    }
  }

  async function handleSaveUser(user: UserRecord) {
    if (!token) {
      return;
    }
    setSavingUserId(user.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const payload: Record<string, string | boolean> = {
        username: user.username,
        email: user.email,
        is_admin: user.is_admin,
        is_active: user.is_active
      };
      if (user.password && user.password.trim()) {
        payload.password = user.password;
      }

      const response = await apiPatch<Record<string, string | boolean>, UserResponse>(`/api/admin/users/${user.id}`, payload, token);
      setUsers((current) => current.map((item) => (item.id === user.id ? { ...response.user, password: "" } : item)));
      setSuccessMessage(`Saved ${response.user.username}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "User update failed");
    } finally {
      setSavingUserId(null);
    }
  }

  async function handleCreateApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !newApiKey.user_id) {
      setErrorMessage("Choose a user before creating an API key.");
      return;
    }
    setIsCreatingApiKey(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await apiPost<{ name: string }, ApiKeyCreateResponse>(`/api/admin/users/${newApiKey.user_id}/api-keys`, { name: newApiKey.name }, token);
      setApiKeys((current) => [response.api_key, ...current]);
      setLatestApiKey(response.plain_text_key);
      setNewApiKey((current) => ({ ...current, name: "" }));
      setSuccessMessage(`Created API key ${response.api_key.name} for ${response.api_key.user_username}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "API key creation failed");
    } finally {
      setIsCreatingApiKey(false);
    }
  }

  async function handleRevokeApiKey(keyId: number) {
    if (!token) {
      return;
    }
    setRevokingApiKeyId(keyId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await apiDelete<{ status: string }>(`/api/admin/api-keys/${keyId}`, token);
      setApiKeys((current) => current.filter((key) => key.id !== keyId));
      setSuccessMessage("API key revoked.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "API key revoke failed");
    } finally {
      setRevokingApiKeyId(null);
    }
  }

  if (isCheckingSetup) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Checking installation state...</section>;
  }

  const uploadTotal = uploadProgress.total || selectedFile?.size || 0;
  const uploadPercent = uploadTotal > 0 ? Math.min(100, Math.round((uploadProgress.loaded / uploadTotal) * 100)) : 0;

  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Admin Access</p>
            <h2 className="mt-2 font-display text-xl">Control Plane</h2>
            <p className="mt-2 max-w-3xl text-sm text-black/70">Use the browser to create the first admin, manage users and API keys, upload models, and tune devices.</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${token ? "bg-emerald-100 text-emerald-800" : "bg-black/5 text-black/55"}`}>
            {token ? "Signed in" : requiresSetup ? "Setup required" : "Signed out"}
          </span>
        </div>

        {requiresSetup ? (
          <form className="mt-5 grid gap-3" onSubmit={handleBootstrap}>
            <div>
              <h3 className="font-display text-base">Create Initial Admin</h3>
              <p className="mt-1 text-sm text-black/65">This account is written to the database and becomes the first administrator for the instance.</p>
            </div>
            <label className="grid gap-1 text-sm text-black/70">
              Username
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={bootstrapUsername} onChange={(event) => setBootstrapUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="grid gap-1 text-sm text-black/70">
              Email
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="email" value={bootstrapEmail} onChange={(event) => setBootstrapEmail(event.target.value)} autoComplete="email" />
            </label>
            <label className="grid gap-1 text-sm text-black/70">
              Password
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="password" value={bootstrapPassword} onChange={(event) => setBootstrapPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmittingBootstrap}>
                {isSubmittingBootstrap ? "Creating..." : "Create Admin"}
              </button>
            </div>
          </form>
        ) : (
          <form className="mt-5 grid gap-3 md:max-w-md" onSubmit={handleLogin}>
            <label className="grid gap-1 text-sm text-black/70">
              Username
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="grid gap-1 text-sm text-black/70">
              Password
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSubmittingLogin}>
                {isSubmittingLogin ? "Signing in..." : token ? "Refresh Session" : "Sign In"}
              </button>
              <button className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={handleLogout} disabled={!token}>
                Sign Out
              </button>
              <button className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => token && void refreshDashboard(token)} disabled={!token || isLoadingDashboard}>
                {isLoadingDashboard ? "Refreshing..." : "Refresh Admin Data"}
              </button>
            </div>
          </form>
        )}

        {errorMessage ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
        {successMessage ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}
        {latestApiKey ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">New API key: <span className="font-mono">{latestApiKey}</span></p> : null}
      </article>

      {!requiresSetup && token ? (
        <>
          <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
            <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Users</p>
                  <h2 className="mt-2 font-display text-xl">Accounts</h2>
                </div>
              </div>

              <form className="mt-5 grid gap-3 rounded-2xl border border-dashed border-black/15 bg-sand/70 p-4" onSubmit={handleCreateUser}>
                <h3 className="font-display text-base">Create User</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm text-black/70">
                    Username
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={newUser.username} onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} />
                  </label>
                  <label className="grid gap-1 text-sm text-black/70">
                    Email
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} />
                  </label>
                  <label className="grid gap-1 text-sm text-black/70">
                    Password
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} />
                  </label>
                  <div className="flex flex-wrap gap-3 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-black/70 md:self-end">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={newUser.is_admin} onChange={(event) => setNewUser((current) => ({ ...current, is_admin: event.target.checked }))} />
                      Admin
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={newUser.is_active} onChange={(event) => setNewUser((current) => ({ ...current, is_active: event.target.checked }))} />
                      Active
                    </label>
                  </div>
                </div>
                <div>
                  <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isCreatingUser}>
                    {isCreatingUser ? "Creating..." : "Create User"}
                  </button>
                </div>
              </form>

              <div className="mt-5 space-y-4">
                {users.map((user) => (
                  <form
                    key={user.id}
                    className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleSaveUser(user);
                    }}
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="grid gap-1 text-sm text-black/70">
                        Username
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={user.username} onChange={(event) => updateUserDraft(user.id, { username: event.target.value })} />
                      </label>
                      <label className="grid gap-1 text-sm text-black/70">
                        Email
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="email" value={user.email} onChange={(event) => updateUserDraft(user.id, { email: event.target.value })} />
                      </label>
                      <label className="grid gap-1 text-sm text-black/70">
                        Reset Password
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="password" value={user.password ?? ""} onChange={(event) => updateUserDraft(user.id, { password: event.target.value })} placeholder="Leave blank to keep current password" />
                      </label>
                      <div className="flex flex-wrap gap-3 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-black/70 md:self-end">
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={user.is_admin} onChange={(event) => updateUserDraft(user.id, { is_admin: event.target.checked })} />
                          Admin
                        </label>
                        <label className="flex items-center gap-2">
                          <input type="checkbox" checked={user.is_active} onChange={(event) => updateUserDraft(user.id, { is_active: event.target.checked })} />
                          Active
                        </label>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={savingUserId === user.id}>
                        {savingUserId === user.id ? "Saving..." : "Save User"}
                      </button>
                    </div>
                  </form>
                ))}
              </div>
            </article>

            <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">API Keys</p>
              <h2 className="mt-2 font-display text-xl">Client Access</h2>

              <form className="mt-5 grid gap-3 rounded-2xl border border-dashed border-black/15 bg-sand/70 p-4" onSubmit={handleCreateApiKey}>
                <h3 className="font-display text-base">Create API Key</h3>
                <label className="grid gap-1 text-sm text-black/70">
                  User
                  <select className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={newApiKey.user_id} onChange={(event) => setNewApiKey((current) => ({ ...current, user_id: event.target.value }))}>
                    <option value="">Choose a user</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.username}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-sm text-black/70">
                  Key Name
                  <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={newApiKey.name} onChange={(event) => setNewApiKey((current) => ({ ...current, name: event.target.value }))} placeholder="Desktop client" />
                </label>
                <div>
                  <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isCreatingApiKey}>
                    {isCreatingApiKey ? "Creating..." : "Create API Key"}
                  </button>
                </div>
              </form>

              <div className="mt-5 space-y-3">
                {apiKeys.map((apiKey) => (
                  <div key={apiKey.id} className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-display text-base">{apiKey.name}</h3>
                        <p className="mt-1 text-sm text-black/70">{apiKey.user_username}</p>
                        <p className="mt-1 text-xs text-black/45">{apiKey.created_at ? new Date(apiKey.created_at).toLocaleString() : "Unknown date"}</p>
                      </div>
                      <button className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => void handleRevokeApiKey(apiKey.id)} disabled={revokingApiKeyId === apiKey.id}>
                        {revokingApiKeyId === apiKey.id ? "Revoking..." : "Revoke"}
                      </button>
                    </div>
                  </div>
                ))}
                {apiKeys.length === 0 ? <p className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">No API keys created yet.</p> : null}
              </div>
            </article>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
            <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Model Intake</p>
                  <h2 className="mt-2 font-display text-xl">Models</h2>
                </div>
              </div>

              <form className="mt-5 grid gap-3 rounded-2xl border border-dashed border-black/15 bg-sand/70 p-4" onSubmit={handleUpload}>
                <h3 className="font-display text-base">Upload GGUF Model</h3>
                <input id="model-upload-input" className="block w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-amber file:px-3 file:py-2 file:font-semibold disabled:cursor-not-allowed disabled:opacity-60" type="file" accept=".gguf" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} disabled={isUploading} />
                {isUploading && uploadTotal > 0 ? (
                  <div className="grid gap-2 rounded-xl border border-black/10 bg-white/70 px-3 py-3">
                    <div className="flex items-center justify-between gap-3 text-sm text-black/70">
                      <span>{uploadPercent}%</span>
                      <span>{formatFileSize(uploadProgress.loaded)} / {formatFileSize(uploadTotal)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-black/10">
                      <div className="h-full rounded-full bg-amber transition-[width] duration-150" style={{ width: `${uploadPercent}%` }} />
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button className="rounded-xl bg-amber px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isUploading || !selectedFile}>
                    {isUploading ? "Uploading..." : "Upload Model"}
                  </button>
                  <button className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={handleScan} disabled={isScanning || isUploading}>
                    {isScanning ? "Scanning..." : isUploading ? "Upload in progress..." : "Scan Models Folder"}
                  </button>
                </div>
              </form>

              <div className="mt-5 space-y-4">
                {models.map((model) => (
                  <form
                    key={model.id}
                    className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleModelSave(model);
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-display text-base">{model.alias}</h3>
                        <p className="mt-1 text-sm text-black/70">{model.file_name}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${model.activated ? "bg-emerald-100 text-emerald-800" : "bg-black/5 text-black/55"}`}>
                          {model.activated ? "Active" : "Inactive"}
                        </span>
                        <button className="rounded-xl border border-black/15 px-3 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => void handleModelToggle(model)} disabled={togglingModelId === model.id}>
                          {togglingModelId === model.id ? "Working..." : model.activated ? "Deactivate" : "Activate"}
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="grid gap-1 text-sm text-black/70">
                        Alias
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={model.alias} onChange={(event) => updateModelDraft(model.id, { alias: event.target.value })} />
                      </label>
                      <label className="grid gap-1 text-sm text-black/70">
                        Description
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={model.description} onChange={(event) => updateModelDraft(model.id, { description: event.target.value })} />
                      </label>
                      <label className="grid gap-1 text-sm text-black/70">
                        Context Length
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" min={256} value={model.context_length} onChange={(event) => updateModelDraft(model.id, { context_length: Number(event.target.value) || 256 })} />
                      </label>
                      <label className="grid gap-1 text-sm text-black/70">
                        Threads
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" min={1} value={model.threads} onChange={(event) => updateModelDraft(model.id, { threads: Number(event.target.value) || 1 })} />
                      </label>
                      <label className="grid gap-1 text-sm text-black/70">
                        GPU Layers
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" value={model.gpu_layers} onChange={(event) => updateModelDraft(model.id, { gpu_layers: Number(event.target.value) || 0 })} />
                      </label>
                      <label className="grid gap-1 text-sm text-black/70">
                        Assignment Mode
                        <select className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={model.assignment_mode} onChange={(event) => updateModelDraft(model.id, { assignment_mode: event.target.value, pinned_device_id: event.target.value === "pinned" ? model.pinned_device_id : null })}>
                          {ASSIGNMENT_MODE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="mt-3 grid gap-1 text-sm text-black/70">
                      Pinned Device
                      <select className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm disabled:bg-black/5" value={model.pinned_device_id ?? ""} onChange={(event) => updateModelDraft(model.id, { pinned_device_id: event.target.value ? Number(event.target.value) : null })} disabled={model.assignment_mode !== "pinned"}>
                        <option value="">Choose a device</option>
                        {devices.filter((device) => device.enabled).map((device) => (
                          <option key={device.id} value={device.id}>
                            {device.name} ({device.vendor})
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="mt-3 grid gap-1 text-sm text-black/70">
                      System Prompt
                      <textarea className="min-h-24 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={model.system_prompt} onChange={(event) => updateModelDraft(model.id, { system_prompt: event.target.value })} />
                    </label>

                    <label className="mt-3 grid gap-1 text-sm text-black/70">
                      Chat Template
                      <textarea className="min-h-24 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={model.chat_template} onChange={(event) => updateModelDraft(model.id, { chat_template: event.target.value })} />
                    </label>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="break-all text-xs text-black/45">{model.file_path}</p>
                      <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={savingModelId === model.id}>
                        {savingModelId === model.id ? "Saving..." : "Save Model Settings"}
                      </button>
                    </div>
                  </form>
                ))}
                {models.length === 0 ? <p className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">No models registered yet.</p> : null}
              </div>
            </article>

            <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Device Scheduler</p>
              <h2 className="mt-2 font-display text-xl">Devices</h2>

              <div className="mt-5 space-y-4">
                {devices.map((device) => (
                  <form
                    key={device.id}
                    className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void handleDeviceSave(device);
                    }}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-display text-base">{device.name}</h3>
                        <p className="mt-1 text-sm text-black/70">{device.vendor} {device.device_type}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${device.enabled ? "bg-emerald-100 text-emerald-800" : "bg-black/5 text-black/55"}`}>
                        {device.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>

                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <label className="grid gap-1 text-sm text-black/70">
                        Name
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={device.name} onChange={(event) => updateDeviceDraft(device.id, { name: event.target.value })} />
                      </label>
                      <label className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-black/70 md:self-end">
                        <input type="checkbox" checked={device.enabled} onChange={(event) => updateDeviceDraft(device.id, { enabled: event.target.checked })} />
                        Enabled for scheduling
                      </label>
                      <label className="grid gap-1 text-sm text-black/70">
                        Priority
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" value={device.priority} onChange={(event) => updateDeviceDraft(device.id, { priority: Number(event.target.value) || 0 })} />
                      </label>
                      <label className="grid gap-1 text-sm text-black/70">
                        Max Threads
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" value={device.max_threads} onChange={(event) => updateDeviceDraft(device.id, { max_threads: Number(event.target.value) || 0 })} />
                      </label>
                      <label className="grid gap-1 text-sm text-black/70">
                        Max Slots
                        <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" min={1} value={device.max_slots} onChange={(event) => updateDeviceDraft(device.id, { max_slots: Number(event.target.value) || 1 })} />
                      </label>
                      <div className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-black/60">
                        <p className="font-semibold text-black/75">Memory</p>
                        <p>{device.memory_mb.toLocaleString()} MB</p>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                      <p className="break-all text-xs text-black/45">{device.hardware_id}</p>
                      <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={savingDeviceId === device.id}>
                        {savingDeviceId === device.id ? "Saving..." : "Save Device Settings"}
                      </button>
                    </div>
                  </form>
                ))}
                {devices.length === 0 ? <p className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">No devices detected yet.</p> : null}
              </div>
            </article>
          </div>
        </>
      ) : null}
    </section>
  );
}
