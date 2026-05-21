import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiGet, apiPatch, apiPost, apiPostFormWithProgress } from "../lib/api";
import { DeviceRecord, ModelRecord, ScanResponse, UploadResponse } from "../lib/records";

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

export default function SetupPage() {
  const navigate = useNavigate();
  const { token, bootstrapAdmin, isAuthenticating, setupStatus, refreshAuthState } = useAuth();
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState("admin");
  const [email, setEmail] = useState("admin@localhost");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Device Selection State (Step 2)
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<number | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [maxSlots, setMaxSlots] = useState(1);
  const [isDevicesLoading, setIsDevicesLoading] = useState(false);
  const [isSavingDevice, setIsSavingDevice] = useState(false);

  // Model Selection State (Step 3)
  const [models, setModels] = useState<ModelRecord[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [modelAlias, setModelAlias] = useState("");
  const [isModelsLoading, setIsModelsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ loaded: 0, total: 0 });
  const [isCompletingSetup, setIsCompletingSetup] = useState(false);

  useEffect(() => {
    if (setupStatus?.has_active_model) {
      navigate("/login", { replace: true });
      return;
    }
    if (setupStatus?.has_enabled_device) {
      setStep(3);
      return;
    }
    if (setupStatus?.has_admin_user) {
      setStep(2);
    }
  }, [navigate, setupStatus]);

  // Load devices for Step 2
  useEffect(() => {
    if (step === 2 && token) {
      setIsDevicesLoading(true);
      setErrorMessage("");
      apiGet<DeviceRecord[]>("/api/devices", token)
        .then((data) => {
          setDevices(data);
          const initial = data.find((d) => d.enabled) || data.find((d) => d.vendor !== "cpu") || data[0];
          if (initial) {
            setSelectedDeviceId(initial.id);
            setDeviceName(initial.name);
            setMaxSlots(initial.max_slots);
          }
        })
        .catch((err) => {
          setErrorMessage(err instanceof Error ? err.message : "Failed to load detected devices");
        })
        .finally(() => {
          setIsDevicesLoading(false);
        });
    }
  }, [step, token]);

  // Load models for Step 3
  const loadModels = async () => {
    if (!token) return;
    setIsModelsLoading(true);
    try {
      const data = await apiGet<ModelRecord[]>("/api/models", token);
      setModels(data);
      const initial = data.find((m) => m.activated) || data[0];
      if (initial) {
        setSelectedModelId(initial.id);
        setModelAlias(initial.alias);
      } else {
        setSelectedModelId(null);
        setModelAlias("");
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to load models");
    } finally {
      setIsModelsLoading(false);
    }
  };

  useEffect(() => {
    if (step === 3 && token) {
      void loadModels();
    }
  }, [step, token]);

  const changeStep = (nextStep: number) => {
    setErrorMessage("");
    setSuccessMessage("");
    setStep(nextStep);
  };

  async function handleBootstrap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    try {
      await bootstrapAdmin(username, email, password);
      setPassword("");
      changeStep(2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Initial admin creation failed";
      if (message.includes("Request failed: 500")) {
        setErrorMessage("Initial admin creation failed with a server error. Check backend logs and ensure the ./data directory is writable before retrying.");
      } else {
        setErrorMessage(message);
      }
    }
  }

  const handleDeviceChange = (id: number) => {
    const dev = devices.find((d) => d.id === id);
    if (dev) {
      setSelectedDeviceId(id);
      setDeviceName(dev.name);
      setMaxSlots(dev.max_slots);
    }
  };

  const handleSaveDevice = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedDeviceId || !token) return;
    setIsSavingDevice(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      // 1. Configure and enable the chosen device
      await apiPatch(`/api/devices/${selectedDeviceId}`, {
        name: deviceName,
        enabled: true,
        max_slots: maxSlots,
      }, token);

      // 2. Disable all other devices
      const otherDevices = devices.filter((d) => d.id !== selectedDeviceId);
      for (const d of otherDevices) {
        if (d.enabled) {
          await apiPatch(`/api/devices/${d.id}`, {
            enabled: false,
          }, token);
        }
      }

      changeStep(3);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to configure device");
    } finally {
      setIsSavingDevice(false);
    }
  };

  const handleScanModels = async () => {
    if (!token) return;
    setIsScanning(true);
    setErrorMessage("");
    setSuccessMessage("");
    try {
      const response = await apiPost<Record<string, never>, ScanResponse>("/api/models/scan", {}, token);
      await loadModels();
      setSuccessMessage(`Scan finished. Found ${response.discovered} files and added ${response.added} new models.`);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setIsScanning(false);
    }
  };

  const handleUploadModel = async (e: FormEvent) => {
    e.preventDefault();
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
      setSelectedFile(null);
      const input = document.getElementById("setup-model-upload") as HTMLInputElement | null;
      if (input) {
        input.value = "";
      }
      setSuccessMessage(`Uploaded and registered model: ${response.model.file_name}.`);
      
      // Reload and auto-select uploaded model
      const data = await apiGet<ModelRecord[]>("/api/models", token);
      setModels(data);
      setSelectedModelId(response.model.id);
      setModelAlias(response.model.alias);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleModelChange = (id: number) => {
    const model = models.find((m) => m.id === id);
    if (model) {
      setSelectedModelId(id);
      setModelAlias(model.alias);
    }
  };

  const handleCompleteSetup = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedModelId || !token) return;
    setIsCompletingSetup(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      // 1. Update model's alias if changed
      const currentModel = models.find((m) => m.id === selectedModelId);
      if (currentModel && currentModel.alias !== modelAlias) {
        await apiPatch(`/api/models/${selectedModelId}`, {
          alias: modelAlias,
        }, token);
      }

      // 2. Activate the model (enables it, starts inference worker on chosen device)
      await apiPost(`/api/models/${selectedModelId}/activate`, {}, token);

      // Deactivate any other models that might have been enabled
      const otherModels = models.filter((m) => m.id !== selectedModelId);
      for (const m of otherModels) {
        if (m.activated) {
          await apiPost(`/api/models/${m.id}/deactivate`, {}, token);
        }
      }

      await refreshAuthState();
      navigate("/login", { replace: true });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to activate selected model");
    } finally {
      setIsCompletingSetup(false);
    }
  };

  const activeDevice = devices.find((d) => d.id === selectedDeviceId);
  const activeModel = models.find((m) => m.id === selectedModelId);
  const uploadTotal = uploadProgress.total || selectedFile?.size || 0;
  const uploadPercent = uploadTotal > 0 ? Math.min(100, Math.round((uploadProgress.loaded / uploadTotal) * 100)) : 0;

  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <h2 className="font-display text-xl">Pawpile Setup</h2>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {["Create admin", "Configure standard device", "Configure primary model"].map((label, index) => {
            const stepNumber = index + 1;
            const isCurrent = step === stepNumber;
            const isDone = step > stepNumber;
            return (
              <div key={label} className={`rounded-2xl border px-4 py-3 text-sm ${isCurrent ? "border-ink bg-ink text-white" : isDone ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-black/10 bg-[#fffdf7] text-black/60"}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.2em]">Step {stepNumber}</p>
                <p className="mt-1 font-semibold">{label}</p>
              </div>
            );
          })}
        </div>
      </article>

      {errorMessage ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p>
      ) : null}
      {successMessage ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p>
      ) : null}

      {step === 1 ? (
        <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
          <h3 className="font-display text-lg">Create admin</h3>
          <form className="mt-5 grid gap-3 md:max-w-xl" onSubmit={handleBootstrap}>
            <label className="grid gap-1 text-sm text-black/70">
              Username
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="grid gap-1 text-sm text-black/70">
              Email
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </label>
            <label className="grid gap-1 text-sm text-black/70">
              Password
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <div className="mt-2">
              <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isAuthenticating}>
                {isAuthenticating ? "Creating..." : "Next"}
              </button>
            </div>
          </form>
        </article>
      ) : null}

      {step === 2 ? (
        <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg">Step 2: Choose active device</h3>
            <button className="rounded-xl border border-black/15 bg-[#fffdf7] px-3 py-1.5 text-xs font-semibold text-black/70 hover:bg-black/5" onClick={() => changeStep(1)}>
              Back
            </button>
          </div>
          <p className="mt-2 text-sm text-black/70">
            Select the primary system device you want Pawpile to use for running inference. All other background devices will be disabled.
          </p>

          {isDevicesLoading ? (
            <p className="mt-5 text-sm text-black/50">Detecting system hardware...</p>
          ) : (
            <form className="mt-5 grid gap-4 md:max-w-xl" onSubmit={handleSaveDevice}>
              <label className="grid gap-1 text-sm text-black/70">
                Primary Device
                <select
                  className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                  value={selectedDeviceId ?? ""}
                  onChange={(e) => handleDeviceChange(Number(e.target.value))}
                >
                  <option value="" disabled>Select hardware device</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name === "CPU" && d.vendor === "cpu" ? "System CPU (Default)" : `${d.name} (${d.vendor.toUpperCase()})`}
                    </option>
                  ))}
                </select>
              </label>

              {activeDevice ? (
                <div className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-sm text-black/75">
                  <p className="font-display font-semibold text-base mb-2">Device Details</p>
                  <div className="grid grid-cols-2 gap-2 text-black/70">
                    <div><span className="font-semibold text-black/45">Type:</span> {activeDevice.device_type}</div>
                    <div><span className="font-semibold text-black/45">Memory:</span> {activeDevice.memory_mb.toLocaleString()} MB</div>
                    <div className="col-span-2"><span className="font-semibold text-black/45">ID:</span> {activeDevice.hardware_id}</div>
                  </div>
                </div>
              ) : null}

              <label className="grid gap-1 text-sm text-black/70">
                Custom Name
                <input
                  className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  placeholder="E.g., Primary GPU, CPU Runner"
                />
              </label>

              <label className="grid gap-1 text-sm text-black/70">
                Max Concurrent Slots
                <input
                  className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                  type="number"
                  min={1}
                  value={maxSlots}
                  onChange={(e) => setMaxSlots(Number(e.target.value) || 1)}
                />
                <span className="text-xs text-black/45">Number of model request slots to run concurrently on this device.</span>
              </label>

              <div className="mt-2">
                <button
                  className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                  disabled={isSavingDevice || !selectedDeviceId}
                >
                  {isSavingDevice ? "Configuring Device..." : "Next: Configure Model"}
                </button>
              </div>
            </form>
          )}
        </article>
      ) : null}

      {step === 3 ? (
        <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
          <div className="flex items-center justify-between">
            <h3 className="font-display text-lg">Step 3: Register primary model</h3>
            <button className="rounded-xl border border-black/15 bg-[#fffdf7] px-3 py-1.5 text-xs font-semibold text-black/70 hover:bg-black/5" onClick={() => changeStep(2)}>
              Back
            </button>
          </div>
          <p className="mt-2 text-sm text-black/70">
            A GGUF format model needs to be added and activated before Pawpile can answer chat requests. Scan your existing models folder or upload a new model file now.
          </p>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
            <div className="space-y-4">
              <div className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
                <h4 className="font-display font-semibold mb-2">Scan Models Folder</h4>
                <p className="text-xs text-black/60 mb-3">
                  This scans your <code>./models/</code> workspace directory for any pre-downloaded <code>.gguf</code> model files.
                </p>
                <button
                  className="rounded-xl border border-black/15 bg-white hover:bg-black/5 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60"
                  type="button"
                  onClick={handleScanModels}
                  disabled={isScanning}
                >
                  {isScanning ? "Scanning Folder..." : "Scan Models Directory"}
                </button>
              </div>

              <form className="rounded-2xl border border-dashed border-black/15 bg-[#fffdf7] p-4" onSubmit={handleUploadModel}>
                <h4 className="font-display font-semibold mb-2 col-span-2">Upload GGUF Model</h4>
                <input
                  id="setup-model-upload"
                  className="block w-full rounded-xl border border-black/15 bg-white px-3 py-1.5 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-amber file:px-2 file:py-1 file:text-xs file:font-semibold"
                  type="file"
                  accept=".gguf"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                />
                {isUploading && uploadTotal > 0 ? (
                  <div className="mt-3 grid gap-1.5 rounded-xl border border-black/10 bg-white/70 p-3">
                    <div className="flex items-center justify-between gap-3 text-xs text-black/70">
                      <span>{uploadPercent}%</span>
                      <span>{formatFileSize(uploadProgress.loaded)} / {formatFileSize(uploadTotal)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
                      <div className="h-full rounded-full bg-amber transition-[width] duration-150" style={{ width: `${uploadPercent}%` }} />
                    </div>
                  </div>
                ) : null}
                <button
                  className="mt-3 rounded-xl bg-amber px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                  disabled={isUploading || !selectedFile}
                >
                  {isUploading ? "Uploading File..." : "Upload Model File"}
                </button>
              </form>
            </div>

            <div>
              <form className="grid gap-4" onSubmit={handleCompleteSetup}>
                <label className="grid gap-1 text-sm text-black/70">
                  Select Active Model
                  {isModelsLoading ? (
                    <span className="text-xs text-black/45">Loading available models...</span>
                  ) : models.length === 0 ? (
                    <span className="text-xs text-amber-800 font-semibold bg-amber-50 rounded-lg px-2.5 py-1 my-1 border border-amber-100">
                      No models available yet. Scan the directory or upload a model to continue.
                    </span>
                  ) : null}
                  <select
                    className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    value={selectedModelId ?? ""}
                    onChange={(e) => handleModelChange(Number(e.target.value))}
                    disabled={models.length === 0}
                  >
                    <option value="" disabled>Select model</option>
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.alias} ({m.file_name})
                      </option>
                    ))}
                  </select>
                </label>

                {activeModel ? (
                  <div className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-sm text-black/75">
                    <p className="font-display font-semibold text-base mb-1">Model Config</p>
                    <p className="text-xs text-black/45 break-all font-mono mb-2">{activeModel.file_name}</p>
                    <label className="grid gap-1 text-sm text-black/70 mt-3">
                      Model Friendly Alias
                      <input
                        className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                        value={modelAlias}
                        onChange={(e) => setModelAlias(e.target.value)}
                      />
                    </label>
                  </div>
                ) : null}

                <div className="mt-2">
                  <button
                    className="rounded-xl bg-ink px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                    type="submit"
                    disabled={isCompletingSetup || !selectedModelId}
                  >
                    {isCompletingSetup ? "Starting Inference & Activating..." : "Activate Model & Finish Setup"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </article>
      ) : null}
    </section>
  );
}
