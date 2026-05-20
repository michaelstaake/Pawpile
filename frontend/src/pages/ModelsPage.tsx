import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost, apiPostForm } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { DeviceRecord, ModelRecord, ModelUpdateResponse, ScanResponse, UploadResponse } from "../lib/records";

const ASSIGNMENT_MODE_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Pinned device", value: "pinned" },
] as const;

type ModelsPageProps = {
  setupMode?: boolean;
  onComplete?: () => void;
};

export default function ModelsPage({ setupMode = false, onComplete }: ModelsPageProps) {
  const { token, refreshAuthState } = useAuth();
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [savingModelId, setSavingModelId] = useState<number | null>(null);
  const [togglingModelId, setTogglingModelId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!token) {
      return;
    }
    void refreshData(token);
  }, [token]);

  async function refreshData(activeToken: string) {
    setIsLoading(true);
    try {
      const [modelsResponse, devicesResponse] = await Promise.all([
        apiGet<ModelRecord[]>("/api/models", activeToken),
        apiGet<DeviceRecord[]>("/api/devices", activeToken),
      ]);
      setModels(modelsResponse);
      setDevices(devicesResponse);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load model data");
    } finally {
      setIsLoading(false);
    }
  }

  function updateModelDraft(modelId: number, updates: Partial<ModelRecord>) {
    setModels((current) => current.map((model) => (model.id === modelId ? { ...model, ...updates } : model)));
  }

  async function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile || !token) {
      setErrorMessage("Choose a .gguf file to upload.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    setErrorMessage("");
    setSuccessMessage("");
    setIsUploading(true);

    try {
      const response = await apiPostForm<UploadResponse>("/api/models/upload", formData, token);
      setModels((current) => [response.model, ...current.filter((model) => model.id !== response.model.id)].sort((left, right) => left.alias.localeCompare(right.alias)));
      setSelectedFile(null);
      const input = document.getElementById("model-upload-input") as HTMLInputElement | null;
      if (input) {
        input.value = "";
      }
      setSuccessMessage(`Uploaded ${response.model.file_name}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleScan() {
    if (!token) {
      return;
    }

    setErrorMessage("");
    setSuccessMessage("");
    setIsScanning(true);

    try {
      const response = await apiPost<Record<string, never>, ScanResponse>("/api/models/scan", {}, token);
      await refreshData(token);
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
        pinned_device_id: model.assignment_mode === "pinned" ? model.pinned_device_id : null,
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
      await refreshData(token);
      await refreshAuthState();
      setSuccessMessage(`${model.activated ? "Deactivated" : "Activated"} ${model.alias}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Model toggle failed");
    } finally {
      setTogglingModelId(null);
    }
  }

  const activeModels = models.filter((model) => model.activated).length;

  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Model Intake</p>
            <h2 className="mt-2 font-display text-xl">{setupMode ? "Step 3: Models" : "Models"}</h2>
            <p className="mt-2 max-w-3xl text-sm text-black/70">
              {setupMode ? "Register and activate at least one model to complete setup." : "Upload, scan, assign, and activate the models your users can chat with."}
            </p>
          </div>
          <button className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => token && void refreshData(token)} disabled={!token || isLoading}>
            {isLoading ? "Refreshing..." : "Refresh Models"}
          </button>
        </div>

        {errorMessage ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
        {successMessage ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

        <form className="mt-5 grid gap-3 rounded-2xl border border-dashed border-black/15 bg-sand/70 p-4" onSubmit={handleUpload}>
          <h3 className="font-display text-base">Upload GGUF Model</h3>
          <input id="model-upload-input" className="block w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-amber file:px-3 file:py-2 file:font-semibold" type="file" accept=".gguf" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
          <div className="flex flex-wrap gap-2">
            <button className="rounded-xl bg-amber px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isUploading || !selectedFile}>
              {isUploading ? "Uploading..." : "Upload Model"}
            </button>
            <button className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={handleScan} disabled={isScanning}>
              {isScanning ? "Scanning..." : "Scan Models Folder"}
            </button>
          </div>
        </form>

        <div className="mt-5 space-y-4">
          {models.map((model) => (
            <form
              key={model.id}
              className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
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

        {setupMode ? (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-sand/60 px-4 py-4 text-sm text-black/70">
            <p>{activeModels > 0 ? `${activeModels} model${activeModels === 1 ? " is" : "s are"} active.` : "Activate at least one model to finish setup."}</p>
            <button className="rounded-xl bg-ink px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={onComplete} disabled={activeModels === 0}>
              Finish Setup
            </button>
          </div>
        ) : null}
      </article>
    </section>
  );
}
