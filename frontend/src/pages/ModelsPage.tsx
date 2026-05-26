import { type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { apiGet, apiPatch, apiPost, apiPostFormWithProgress } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { formatDeviceIdLabel } from "../lib/deviceIds";
import { DeviceRecord, GpuPoolRecord, ModelRecord, ModelUpdateResponse, ScanResponse, UploadResponse } from "../lib/records";
import Modal from "../components/ui/Modal";

const AUTO_SAVE_DELAY_MS = 700;

const ASSIGNMENT_MODE_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Manual", value: "manual" },
] as const;

const CONTEXT_LENGTH_MODE_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "Custom", value: "custom" },
] as const;

type ContextLengthMode = (typeof CONTEXT_LENGTH_MODE_OPTIONS)[number]["value"];
type AssignmentUiMode = (typeof ASSIGNMENT_MODE_OPTIONS)[number]["value"];

type AssignmentTarget = {
  label: string;
  value: string;
  assignment_mode: "pinned" | "pool";
  id: number;
};

function buildAssignmentTargets(devices: DeviceRecord[], pools: GpuPoolRecord[]): AssignmentTarget[] {
  return [
    ...devices.filter((device) => device.enabled).map((device) => ({
      label: `${device.name} (${device.vendor} device, ${formatDeviceIdLabel(device)})`,
      value: `device:${device.id}`,
      assignment_mode: "pinned" as const,
      id: device.id,
    })),
    ...pools.map((pool) => ({
      label: `${pool.name} (${pool.vendor} pool, ${pool.devices.length} GPU${pool.devices.length === 1 ? "" : "s"})`,
      value: `pool:${pool.id}`,
      assignment_mode: "pool" as const,
      id: pool.id,
    })),
  ];
}

function getAssignmentUiMode(model: ModelRecord): AssignmentUiMode {
  return model.assignment_mode === "auto" ? "auto" : "manual";
}

function getAssignmentTargetValue(model: ModelRecord): string {
  if (model.assignment_mode === "pool" && model.pinned_pool_id != null) {
    return `pool:${model.pinned_pool_id}`;
  }

  if (model.assignment_mode === "pinned" && model.pinned_device_id != null) {
    return `device:${model.pinned_device_id}`;
  }

  return "";
}

function buildAssignmentUpdate(targetValue: string): Pick<ModelRecord, "assignment_mode" | "pinned_device_id" | "pinned_pool_id"> {
  if (targetValue.startsWith("pool:")) {
    return {
      assignment_mode: "pool",
      pinned_device_id: null,
      pinned_pool_id: Number(targetValue.slice(5)) || null,
    };
  }

  if (targetValue.startsWith("device:")) {
    return {
      assignment_mode: "pinned",
      pinned_device_id: Number(targetValue.slice(7)) || null,
      pinned_pool_id: null,
    };
  }

  return {
    assignment_mode: "auto",
    pinned_device_id: null,
    pinned_pool_id: null,
  };
}

type ModelsPageProps = {
  setupMode?: boolean;
  onComplete?: () => void;
};

type UploadProgressState = {
  loaded: number;
  total: number;
};

function buildModelPayload(model: ModelRecord) {
  return {
    alias: model.alias,
    description: model.description,
    system_prompt: model.system_prompt,
    chat_template: model.chat_template,
    context_length: model.context_length,
    gpu_layers: model.gpu_layers,
    threads: model.threads,
    temperature: model.temperature,
    top_p: model.top_p,
    tool_calling_enabled: model.tool_calling_enabled,
    thinking_enabled: model.thinking_enabled,
    assignment_mode: model.assignment_mode,
    pinned_device_id: model.assignment_mode === "pinned" ? model.pinned_device_id : null,
    pinned_pool_id: model.assignment_mode === "pool" ? model.pinned_pool_id : null,
  };
}

function serializeModelConfig(model: ModelRecord) {
  return JSON.stringify(buildModelPayload(model));
}

function mergeSavedModel(current: ModelRecord, sent: ModelRecord, saved: ModelRecord): ModelRecord {
  const merged = { ...saved };
  for (const key of Object.keys(current) as Array<keyof ModelRecord>) {
    if (current[key] !== sent[key]) {
      (merged as any)[key] = current[key];
    }
  }
  return merged;
}

function sortModels(models: ModelRecord[]) {
  return [...models].sort((left, right) => left.priority - right.priority || left.id - right.id);
}

function moveModel(models: ModelRecord[], fromIndex: number, toIndex: number) {
  const nextModels = [...models];
  const [movedModel] = nextModels.splice(fromIndex, 1);
  nextModels.splice(toIndex, 0, movedModel);
  return nextModels.map((model, index) => ({ ...model, priority: index }));
}

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

function formatUploadSizeInWholeMb(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024)).toLocaleString()} MB`;
}

export default function ModelsPage({ setupMode = false, onComplete }: ModelsPageProps) {
  const { token } = useAuth();
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [pools, setPools] = useState<GpuPoolRecord[]>([]);
  const [settingsModelId, setSettingsModelId] = useState<number | null>(null);
  const [modalDraft, setModalDraft] = useState<ModelRecord | null>(null);
  const [modalContextLengthMode, setModalContextLengthMode] = useState<ContextLengthMode>("custom");
  const [modalNumericDrafts, setModalNumericDraftsState] = useState<Record<string, string>>({});
  const [isSavingModal, setIsSavingModal] = useState(false);
  const [modalError, setModalError] = useState("");
  const [draggedModelId, setDraggedModelId] = useState<number | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressState>({ loaded: 0, total: 0 });
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [savingModelIds, setSavingModelIds] = useState<number[]>([]);
  const [pendingModelIds, setPendingModelIds] = useState<number[]>([]);
  const [loadingActivationIds, setLoadingActivationIds] = useState<number[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const latestModelsRef = useRef<ModelRecord[]>([]);
  const savedConfigRef = useRef<Record<number, string>>({});
  const savedActivationRef = useRef<Record<number, boolean>>({});
  const saveTimeoutsRef = useRef<Record<number, number>>({});
  const savingIdsRef = useRef<Set<number>>(new Set());
  const resaveRequestedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    latestModelsRef.current = models;
  }, [models]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void refreshData(token);
  }, [token]);

  async function refreshData(activeToken: string) {
    setIsLoading(true);
    try {
      const [modelsResponse, devicesResponse, poolResponse] = await Promise.all([
        apiGet<ModelRecord[]>("/api/models", activeToken),
        apiGet<DeviceRecord[]>("/api/devices", activeToken),
        apiGet<GpuPoolRecord[]>("/api/devices/pools", activeToken),
      ]);
      const orderedModels = sortModels(modelsResponse);
      savedConfigRef.current = Object.fromEntries(orderedModels.map((model) => [model.id, serializeModelConfig(model)]));
      savedActivationRef.current = Object.fromEntries(orderedModels.map((model) => [model.id, model.activated]));
      setModels(orderedModels);
      setDevices(devicesResponse);
      setPools(poolResponse);
      setPendingModelIds([]);
      setLoadingActivationIds([]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load model data");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => () => {
    Object.values(saveTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
  }, []);

  function scheduleModelSave(modelId: number) {
    const existingTimeout = saveTimeoutsRef.current[modelId];
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    setPendingModelIds((current) => (current.includes(modelId) ? current : [...current, modelId]));

    saveTimeoutsRef.current[modelId] = window.setTimeout(() => {
      delete saveTimeoutsRef.current[modelId];
      void persistModel(modelId);
    }, AUTO_SAVE_DELAY_MS);
  }

  function updateModelDraft(modelId: number, updates: Partial<ModelRecord>) {
    setErrorMessage("");
    setSuccessMessage("");
    setModels((current) => current.map((model) => (model.id === modelId ? { ...model, ...updates } : model)));
    scheduleModelSave(modelId);
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
    setUploadProgress({ loaded: 0, total: selectedFile.size });

    try {
      const response = await apiPostFormWithProgress<UploadResponse>("/api/models/upload", formData, token, (progress) => {
        setUploadProgress({
          loaded: progress.loaded,
          total: progress.total || selectedFile.size,
        });
      });
      savedConfigRef.current[response.model.id] = serializeModelConfig(response.model);
      savedActivationRef.current[response.model.id] = response.model.activated;
      setModels((current) => sortModels([...current.filter((model) => model.id !== response.model.id), response.model]));
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

  async function persistModel(modelId: number) {
    if (!token) {
      return;
    }

    if (savingIdsRef.current.has(modelId)) {
      resaveRequestedRef.current.add(modelId);
      return;
    }

    const model = latestModelsRef.current.find((item) => item.id === modelId);
    if (!model) {
      return;
    }

    const configChanged = savedConfigRef.current[modelId] !== serializeModelConfig(model);
    const activationChanged = savedActivationRef.current[modelId] !== model.activated;

    if (!configChanged && !activationChanged) {
      setPendingModelIds((current) => current.filter((id) => id !== modelId));
      return;
    }

    savingIdsRef.current.add(modelId);
    setSavingModelIds((current) => (current.includes(modelId) ? current : [...current, modelId]));
    setPendingModelIds((current) => current.filter((id) => id !== modelId));
    setErrorMessage("");
    setSuccessMessage("");

    let savedSuccessfully = false;

    try {
      if (configChanged) {
        const response = await apiPatch<Record<string, string | number | boolean | null>, ModelUpdateResponse>(`/api/models/${model.id}`, buildModelPayload(model), token);
        savedConfigRef.current[model.id] = serializeModelConfig(response.model);
        if (!activationChanged) {
          savedActivationRef.current[model.id] = response.model.activated;
        }
        setModels((current) =>
          current.map((item) => {
            if (item.id !== model.id) {
              return item;
            }
            const merged = mergeSavedModel(item, model, response.model);
            return {
              ...merged,
              activated: activationChanged ? item.activated : merged.activated,
            };
          })
        );
      }

      if (activationChanged) {
        await apiPost<Record<string, never>, { status: string }>(`/api/models/${model.id}/${model.activated ? "activate" : "deactivate"}`, {}, token);
        savedActivationRef.current[model.id] = model.activated;
        setModels((current) => current.map((item) => (item.id === model.id ? { ...item, activated: model.activated } : item)));
      }

      setSuccessMessage(`Saved settings for ${model.alias}.`);
      savedSuccessfully = true;
    } catch (error) {
      if (activationChanged) {
        const previousActivation = savedActivationRef.current[model.id];
        setModels((current) => current.map((item) => (item.id === model.id ? { ...item, activated: previousActivation } : item)));
      }
      setErrorMessage(error instanceof Error ? error.message : "Model update failed");
    } finally {
      savingIdsRef.current.delete(modelId);
      setSavingModelIds((current) => current.filter((id) => id !== modelId));

      const latestModel = latestModelsRef.current.find((item) => item.id === modelId);
      const configStillDirty = latestModel ? savedConfigRef.current[modelId] !== serializeModelConfig(latestModel) : false;
      const activationStillDirty = latestModel ? savedActivationRef.current[modelId] !== latestModel.activated : false;
      const shouldResave = savedSuccessfully && (resaveRequestedRef.current.has(modelId) || configStillDirty || activationStillDirty);
      resaveRequestedRef.current.delete(modelId);

      if (shouldResave) {
        scheduleModelSave(modelId);
      }
    }
  }

  async function persistModelOrder(nextModels: ModelRecord[], previousModels: ModelRecord[]) {
    if (!token) {
      return;
    }

    setIsReordering(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await apiPost<{ models: { id: number; priority: number }[] }, { status: string }>(
        "/api/models/reorder",
        {
          models: nextModels.map((model, index) => ({ id: model.id, priority: index })),
        },
        token,
      );
      setSuccessMessage("Saved model order.");
    } catch (error) {
      setModels(previousModels);
      setErrorMessage(error instanceof Error ? error.message : "Failed to save model order");
    } finally {
      setIsReordering(false);
    }
  }

  async function toggleModelActivation(model: ModelRecord) {
    if (!token) {
      return;
    }
    const nextActivated = !model.activated;
    setLoadingActivationIds((current) => (current.includes(model.id) ? current : [...current, model.id]));
    setErrorMessage("");
    setSuccessMessage("");
    try {
      await apiPost<Record<string, never>, { status: string }>(`/api/models/${model.id}/${nextActivated ? "activate" : "deactivate"}`, {}, token);
      setModels((current) => current.map((item) => (item.id === model.id ? { ...item, activated: nextActivated } : item)));
      savedActivationRef.current[model.id] = nextActivated;
      setSuccessMessage(`${model.alias} ${nextActivated ? "enabled" : "disabled"}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update model activation");
    } finally {
      setLoadingActivationIds((current) => current.filter((itemId) => itemId !== model.id));
    }
  }

  function openSettingsModal(model: ModelRecord) {
    setSettingsModelId(model.id);
    setModalDraft({ ...model });
    setModalContextLengthMode(model.max_context_length != null && model.context_length === model.max_context_length ? "auto" : "custom");
    setModalNumericDraftsState({});
    setModalError("");
  }

  function closeSettingsModal() {
    setSettingsModelId(null);
    setModalDraft(null);
    setModalContextLengthMode("custom");
    setModalNumericDraftsState({});
    setModalError("");
  }

  function updateModalDraft(updates: Partial<ModelRecord>) {
    setModalDraft((current) => (current ? { ...current, ...updates } : null));
  }

  function setModalNumericDraft(field: string, value: string) {
    setModalNumericDraftsState((current) => ({ ...current, [field]: value }));
  }

  function commitModalNumericDraft(field: keyof ModelRecord, value: string, clamp: (n: number) => number) {
    setModalNumericDraftsState((current) => {
      const next = { ...current };
      delete next[field as string];
      return next;
    });
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && value.trim() !== "") {
      updateModalDraft({ [field]: clamp(parsed) } as Partial<ModelRecord>);
    }
  }

  function updateModalContextLengthMode(mode: ContextLengthMode) {
    setModalContextLengthMode(mode);
    setModalNumericDraftsState((current) => {
      if (!("context_length" in current)) {
        return current;
      }
      const next = { ...current };
      delete next.context_length;
      return next;
    });

    if (mode === "auto" && modalDraft?.max_context_length != null) {
      updateModalDraft({ context_length: modalDraft.max_context_length });
    }
  }

  async function saveModalDraft() {
    if (!token || !modalDraft) {
      return;
    }
    setIsSavingModal(true);
    setModalError("");
    try {
      const response = await apiPatch<Record<string, string | number | boolean | null>, ModelUpdateResponse>(`/api/models/${modalDraft.id}`, buildModelPayload(modalDraft), token);
      savedConfigRef.current[modalDraft.id] = serializeModelConfig(response.model);
      setModels((current) =>
        current.map((item) => {
          if (item.id !== modalDraft.id) {
            return item;
          }
          return { ...response.model, activated: item.activated };
        })
      );
      setSuccessMessage(`Saved settings for ${response.model.alias}.`);
      closeSettingsModal();
    } catch (error) {
      setModalError(error instanceof Error ? error.message : "Failed to save model settings");
    } finally {
      setIsSavingModal(false);
    }
  }

  function handleDragStart(event: DragEvent<HTMLElement>, modelId: number) {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") {
      event.preventDefault();
      return;
    }
    setDraggedModelId(modelId);
  }

  function handleDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
  }

  function handleDragEnd() {
    setDraggedModelId(null);
  }

  function handleModelDrop(targetModelId: number) {
    if (draggedModelId === null || draggedModelId === targetModelId || isReordering) {
      setDraggedModelId(null);
      return;
    }

    const fromIndex = models.findIndex((model) => model.id === draggedModelId);
    const toIndex = models.findIndex((model) => model.id === targetModelId);
    if (fromIndex === -1 || toIndex === -1) {
      setDraggedModelId(null);
      return;
    }

    const previousModels = models;
    const nextModels = moveModel(models, fromIndex, toIndex);
    setDraggedModelId(null);
    setModels(nextModels);
    void persistModelOrder(nextModels, previousModels);
  }

  const activeModels = models.filter((model) => model.activated).length;
  const uploadTotal = uploadProgress.total || selectedFile?.size || 0;
  const uploadPercent = uploadTotal > 0 ? Math.min(100, Math.round((uploadProgress.loaded / uploadTotal) * 100)) : 0;
  const assignmentTargets = buildAssignmentTargets(devices, pools);
  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="mt-2 font-display text-xl">{setupMode ? "Step 3: Models" : "Models"}</h2>
          </div>
          <button className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={handleScan} disabled={isScanning}>
            {isScanning ? "Scanning..." : "Scan Models Folder"}
          </button>
        </div>

        {setupMode ? <p className="mt-2 max-w-3xl text-sm text-black/70">Register and activate at least one model to complete setup.</p> : null}

        {errorMessage ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
        {successMessage ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

        <form className="mt-3 grid gap-3 rounded-2xl border border-dashed border-black/15 bg-sand/70 p-4" onSubmit={handleUpload}>
          <h3 className="font-display text-base">Upload GGUF Model</h3>
            <input id="model-upload-input" className="block w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-amber file:px-3 file:py-2 file:font-semibold disabled:cursor-not-allowed disabled:opacity-60" type="file" accept=".gguf" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} disabled={isUploading} />
          {isUploading && uploadTotal > 0 ? (
            <div className="grid gap-2 rounded-xl border border-black/10 bg-white/70 px-3 py-3">
              <div className="flex items-center justify-between gap-3 text-sm text-black/70">
                <span>{uploadPercent}%</span>
                <span>{formatUploadSizeInWholeMb(uploadProgress.loaded)} / {formatUploadSizeInWholeMb(uploadTotal)}</span>
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
          </div>
        </form>

        <div className="mt-5 space-y-4">
          {models.map((model) => {
            const isActivationLoading = loadingActivationIds.includes(model.id);
            const activationButtonClassName = isActivationLoading
              ? "border-sky-300 bg-sky-100 text-sky-800"
              : model.activated
                ? "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                : "border-black/15 bg-white text-black/55 hover:bg-black/5";
            const activationButtonLabel = isActivationLoading ? "Loading..." : model.activated ? "Enabled" : "Disabled";

            return (
              <article
                key={model.id}
                className={`rounded-2xl border border-black/10 bg-[#fffdf7] p-4 transition-shadow ${draggedModelId === model.id ? "shadow-lg ring-2 ring-amber/60" : ""}`}
                draggable={!isReordering}
                onDragStart={(event) => handleDragStart(event, model.id)}
                onDragOver={handleDragOver}
                onDragEnd={handleDragEnd}
                onDrop={() => handleModelDrop(model.id)}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-base">{model.alias}</h3>
                    <p className="mt-0.5 text-sm text-black/55">
                      {model.file_name}
                      {model.file_size != null ? <span className="ml-2">({formatFileSize(model.file_size)})</span> : null}
                    </p>
                    {model.description ? <p className="mt-1 text-sm text-black/70">{model.description}</p> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {savingModelIds.includes(model.id) || pendingModelIds.includes(model.id) ? (
                      <span className="text-xs text-black/45">{savingModelIds.includes(model.id) ? "Saving..." : "Pending..."}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void toggleModelActivation(model)}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed ${activationButtonClassName}`}
                      disabled={isActivationLoading}
                    >
                      {activationButtonLabel}
                    </button>
                    <button
                      className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors hover:bg-black/5"
                      type="button"
                      onClick={() => openSettingsModal(model)}
                    >
                      Settings
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
          {models.length === 0 ? <p className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">No models registered yet.</p> : null}
        </div>

        {setupMode ? (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-sand/60 px-4 py-4 text-sm text-black/70">
            <p>{activeModels > 0 ? `${activeModels} model${activeModels === 1 ? " is" : "s are"} active.` : "Activate at least one model to finish setup."}</p>
            <button className="rounded-xl bg-ink px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={onComplete} disabled={activeModels === 0 || pendingModelIds.length > 0 || savingModelIds.length > 0}>
              Finish Setup
            </button>
          </div>
        ) : null}
      </article>

      {modalDraft ? (
        <Modal
          open={settingsModelId !== null}
          onClose={closeSettingsModal}
          labelledBy="model-settings-modal-title"
          panelClassName="w-full max-w-2xl"
        >
          <div className="p-6">
            <h2 id="model-settings-modal-title" className="font-display text-xl">Model Settings</h2>
            <p className="mt-1 text-sm text-black/55">
              {modalDraft.file_name}
              {modalDraft.file_size != null ? <span className="ml-2">({formatFileSize(modalDraft.file_size)})</span> : null}
            </p>

            {modalError ? (
              <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{modalError}</p>
            ) : null}

            <div className="mt-5 grid gap-5">
              <section>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-black/45">General</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm text-black/70 md:col-span-2">
                    Name
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={modalDraft.alias} onChange={(event) => updateModalDraft({ alias: event.target.value })} />
                  </label>
                  <label className="grid gap-1 text-sm text-black/70 md:col-span-2">
                    Description
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={modalDraft.description} onChange={(event) => updateModalDraft({ description: event.target.value })} />
                  </label>
                </div>
              </section>

              <section>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-black/45">Context Length</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm text-black/70">
                    Mode
                    <select
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                      value={modalContextLengthMode}
                      onChange={(event) => updateModalContextLengthMode(event.target.value as ContextLengthMode)}
                    >
                      {CONTEXT_LENGTH_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value} disabled={option.value === "auto" && modalDraft.max_context_length == null}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm text-black/70">
                    Context Length
                    <input
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm disabled:bg-black/5 disabled:text-black/45"
                      type="number"
                      min={256}
                      value={modalNumericDrafts.context_length ?? String(modalDraft.context_length)}
                      onChange={(event) => setModalNumericDraft("context_length", event.target.value)}
                      onBlur={(event) => commitModalNumericDraft("context_length", event.target.value, (n) => Math.max(256, Math.round(n)))}
                      disabled={modalContextLengthMode === "auto"}
                    />
                  </label>
                </div>
              </section>

              <section>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-black/45">Features</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-black/70">
                    <input type="checkbox" checked={modalDraft.tool_calling_enabled} onChange={(event) => updateModalDraft({ tool_calling_enabled: event.target.checked })} />
                    Tool Calling Enabled
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-black/70">
                    <input type="checkbox" checked={modalDraft.thinking_enabled} onChange={(event) => updateModalDraft({ thinking_enabled: event.target.checked })} />
                    Thinking Enabled
                  </label>
                </div>
              </section>

              <section>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-black/45">Devices</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm text-black/70">
                    Assignment Mode
                    <select className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={getAssignmentUiMode(modalDraft)} onChange={(event) => {
                      const mode = event.target.value as AssignmentUiMode;
                      if (mode === "auto") {
                        updateModalDraft({
                          assignment_mode: "auto",
                          pinned_device_id: null,
                          pinned_pool_id: null,
                        });
                        return;
                      }

                      const existingTargetValue = getAssignmentTargetValue(modalDraft);
                      const nextTargetValue = existingTargetValue || assignmentTargets[0]?.value || "";
                      updateModalDraft(buildAssignmentUpdate(nextTargetValue));
                    }}>
                      {ASSIGNMENT_MODE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm text-black/70">
                    Assignment Target
                    <select
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm disabled:bg-black/5"
                      value={getAssignmentTargetValue(modalDraft)}
                      disabled={modalDraft.assignment_mode === "auto"}
                      onChange={(event) => {
                        updateModalDraft(buildAssignmentUpdate(event.target.value));
                      }}
                    >
                      <option value="">Choose a device or pool</option>
                      {assignmentTargets.map((target) => (
                        <option key={target.value} value={target.value}>{target.label}</option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm text-black/70">
                    GPU Layers
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" value={modalNumericDrafts.gpu_layers ?? String(modalDraft.gpu_layers)} onChange={(event) => setModalNumericDraft("gpu_layers", event.target.value)} onBlur={(event) => commitModalNumericDraft("gpu_layers", event.target.value, (n) => Math.max(0, Math.round(n)))} />
                  </label>
                  <label className="grid gap-1 text-sm text-black/70">
                    Threads
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" min={1} value={modalNumericDrafts.threads ?? String(modalDraft.threads)} onChange={(event) => setModalNumericDraft("threads", event.target.value)} onBlur={(event) => commitModalNumericDraft("threads", event.target.value, (n) => Math.max(1, Math.round(n)))} />
                  </label>
                </div>
              </section>

              <section>
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-black/45">Behavior</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="grid gap-1 text-sm text-black/70">
                    Temperature
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" min={0} max={2} step={0.05} value={modalNumericDrafts.temperature ?? String(modalDraft.temperature)} onChange={(event) => setModalNumericDraft("temperature", event.target.value)} onBlur={(event) => commitModalNumericDraft("temperature", event.target.value, (n) => Math.min(2, Math.max(0, n)))} />
                  </label>
                  <label className="grid gap-1 text-sm text-black/70">
                    Top P
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" min={0} max={1} step={0.05} value={modalNumericDrafts.top_p ?? String(modalDraft.top_p)} onChange={(event) => setModalNumericDraft("top_p", event.target.value)} onBlur={(event) => commitModalNumericDraft("top_p", event.target.value, (n) => Math.min(1, Math.max(0, n)))} />
                  </label>
                  <label className="grid gap-1 text-sm text-black/70 md:col-span-2">
                    System Prompt
                    <textarea className="min-h-24 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={modalDraft.system_prompt} onChange={(event) => updateModalDraft({ system_prompt: event.target.value })} />
                  </label>
                  <label className="grid gap-1 text-sm text-black/70 md:col-span-2">
                    Chat Template
                    <textarea className="min-h-24 rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={modalDraft.chat_template} onChange={(event) => updateModalDraft({ chat_template: event.target.value })} />
                  </label>
                </div>
              </section>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-black/10 pt-4">
              <button
                type="button"
                className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold text-black hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
                onClick={closeSettingsModal}
                disabled={isSavingModal}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => void saveModalDraft()}
                disabled={isSavingModal}
              >
                {isSavingModal ? "Saving..." : modalDraft.activated ? "Save and Reload" : "Save"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
