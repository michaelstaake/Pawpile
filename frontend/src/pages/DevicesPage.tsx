import { useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { DeviceRecord, DeviceUpdateResponse, GpuPoolRecord } from "../lib/records";

const AUTO_SAVE_DELAY_MS = 700;

function buildDevicePayload(device: DeviceRecord) {
  return {
    name: device.name,
    enabled: device.enabled,
    priority: device.priority,
    max_threads: device.max_threads,
    max_slots: device.max_slots,
  };
}

function serializeDevice(device: DeviceRecord) {
  return JSON.stringify(buildDevicePayload(device));
}

type DevicesPageProps = {
  setupMode?: boolean;
  onContinue?: () => void;
};

export default function DevicesPage({ setupMode = false, onContinue }: DevicesPageProps) {
  const { token } = useAuth();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savingDeviceIds, setSavingDeviceIds] = useState<number[]>([]);
  const [pendingDeviceIds, setPendingDeviceIds] = useState<number[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const latestDevicesRef = useRef<DeviceRecord[]>([]);
  const savedSnapshotsRef = useRef<Record<number, string>>({});
  const saveTimeoutsRef = useRef<Record<number, number>>({});
  const savingIdsRef = useRef<Set<number>>(new Set());
  const resaveRequestedRef = useRef<Set<number>>(new Set());

  // GPU Pool state
  const [pool, setPool] = useState<GpuPoolRecord | null>(null);
  const [poolLoading, setPoolLoading] = useState(false);
  const [selectedPoolDeviceIds, setSelectedPoolDeviceIds] = useState<number[]>([]);
  const [poolEditing, setPoolEditing] = useState(false);
  const [showDeletePoolConfirm, setShowDeletePoolConfirm] = useState(false);

  useEffect(() => {
    latestDevicesRef.current = devices;
  }, [devices]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void refreshDevices(token);
    void refreshPool(token);
  }, [token]);

  async function refreshDevices(activeToken: string) {
    setIsLoading(true);
    try {
      const response = await apiGet<DeviceRecord[]>("/api/devices", activeToken);
      savedSnapshotsRef.current = Object.fromEntries(response.map((device) => [device.id, serializeDevice(device)]));
      setDevices(response);
      setPendingDeviceIds([]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load devices");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshPool(activeToken: string) {
    try {
      const response = await apiGet<GpuPoolRecord | null>("/api/devices/pool", activeToken);
      setPool(response);
      if (response) {
        setSelectedPoolDeviceIds(response.devices.map((d) => d.id));
      }
    } catch {
      // pool endpoint errors are non-fatal
    }
  }

  useEffect(() => () => {
    Object.values(saveTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId));
  }, []);

  function scheduleDeviceSave(deviceId: number) {
    const existingTimeout = saveTimeoutsRef.current[deviceId];
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    setPendingDeviceIds((current) => (current.includes(deviceId) ? current : [...current, deviceId]));

    saveTimeoutsRef.current[deviceId] = window.setTimeout(() => {
      delete saveTimeoutsRef.current[deviceId];
      void persistDevice(deviceId);
    }, AUTO_SAVE_DELAY_MS);
  }

  function updateDeviceDraft(deviceId: number, updates: Partial<DeviceRecord>) {
    setErrorMessage("");
    setSuccessMessage("");
    setDevices((current) => current.map((device) => (device.id === deviceId ? { ...device, ...updates } : device)));
    scheduleDeviceSave(deviceId);
  }

  async function persistDevice(deviceId: number) {
    if (!token) {
      return;
    }

    if (savingIdsRef.current.has(deviceId)) {
      resaveRequestedRef.current.add(deviceId);
      return;
    }

    const device = latestDevicesRef.current.find((item) => item.id === deviceId);
    if (!device) {
      return;
    }

    if (savedSnapshotsRef.current[deviceId] === serializeDevice(device)) {
      setPendingDeviceIds((current) => current.filter((id) => id !== deviceId));
      return;
    }

    savingIdsRef.current.add(deviceId);
    setSavingDeviceIds((current) => (current.includes(deviceId) ? current : [...current, deviceId]));
    setPendingDeviceIds((current) => current.filter((id) => id !== deviceId));
    setErrorMessage("");
    setSuccessMessage("");

    let savedSuccessfully = false;

    try {
      const response = await apiPatch<Record<string, string | number | boolean>, DeviceUpdateResponse>(`/api/devices/${device.id}`, {
        ...buildDevicePayload(device),
      }, token);
      savedSnapshotsRef.current[device.id] = serializeDevice(response.device);
      setDevices((current) => current.map((item) => (item.id === device.id ? response.device : item)));
      setSuccessMessage(`Saved device settings for ${response.device.name}.`);
      savedSuccessfully = true;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Device update failed");
    } finally {
      savingIdsRef.current.delete(deviceId);
      setSavingDeviceIds((current) => current.filter((id) => id !== deviceId));

      const latestDevice = latestDevicesRef.current.find((item) => item.id === deviceId);
      const needsResave = savedSuccessfully && latestDevice && savedSnapshotsRef.current[deviceId] !== serializeDevice(latestDevice);
      const shouldResave = resaveRequestedRef.current.has(deviceId) || Boolean(needsResave);
      resaveRequestedRef.current.delete(deviceId);

      if (shouldResave) {
        scheduleDeviceSave(deviceId);
      }
    }
  }

  const enabledDevices = devices.filter((device) => device.enabled).length;

  const nvidiaDevices = devices.filter((d) => d.vendor === "nvidia");
  const showPoolSection = !setupMode && nvidiaDevices.length > 1;
  const poolDeviceIds = new Set(pool?.devices.map((d) => d.id) ?? []);
  const poolEnabled = pool !== null && pool.devices.length > 0 &&
    pool.devices.every((poolDevice) => devices.find((d) => d.id === poolDevice.id)?.enabled === true);

  function togglePoolDevice(deviceId: number) {
    setSelectedPoolDeviceIds((current) =>
      current.includes(deviceId) ? current.filter((id) => id !== deviceId) : [...current, deviceId],
    );
  }

  async function handleTogglePool() {
    if (!token || !pool) return;
    const nextEnabled = !poolEnabled;
    setPoolLoading(true);
    setErrorMessage("");
    try {
      await Promise.all(
        pool.devices.map((poolDevice) =>
          apiPatch<{ enabled: boolean }, { status: string; device: DeviceRecord }>(
            `/api/devices/${poolDevice.id}`,
            { enabled: nextEnabled },
            token,
          ),
        ),
      );
      await refreshDevices(token);
      setSuccessMessage(`GPU pool ${nextEnabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to toggle pool");
      await refreshDevices(token);
    } finally {
      setPoolLoading(false);
    }
  }

  async function handleCreatePool() {
    if (!token || selectedPoolDeviceIds.length < 2) return;
    setPoolLoading(true);
    setErrorMessage("");
    try {
      const response = await apiPost<{ device_ids: number[] }, { pool: GpuPoolRecord }>("/api/devices/pool", { device_ids: selectedPoolDeviceIds }, token);
      setPool(response.pool);
      setPoolEditing(false);
      setSuccessMessage("GPU pool created.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create GPU pool");
    } finally {
      setPoolLoading(false);
    }
  }

  async function handleUpdatePool() {
    if (!token || selectedPoolDeviceIds.length < 2 || !pool) return;
    const removedDeviceIds = pool.devices.map((d) => d.id).filter((id) => !selectedPoolDeviceIds.includes(id));
    setPoolLoading(true);
    setErrorMessage("");
    try {
      const response = await apiPatch<{ device_ids: number[] }, { pool: GpuPoolRecord }>("/api/devices/pool", { device_ids: selectedPoolDeviceIds }, token);
      // Disable any devices that were removed from the pool
      if (removedDeviceIds.length > 0) {
        await Promise.all(
          removedDeviceIds.map((deviceId) =>
            apiPatch<{ enabled: boolean }, { status: string; device: DeviceRecord }>(
              `/api/devices/${deviceId}`,
              { enabled: false },
              token,
            ),
          ),
        );
      }
      setPool(response.pool);
      setPoolEditing(false);
      await refreshDevices(token);
      setSuccessMessage("GPU pool updated.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update GPU pool");
    } finally {
      setPoolLoading(false);
    }
  }

  async function handleDeletePool() {
    if (!token) return;
    const memberDeviceIds = pool?.devices.map((d) => d.id) ?? [];
    setPoolLoading(true);
    setErrorMessage("");
    setShowDeletePoolConfirm(false);
    try {
      await apiDelete<{ status: string }>("/api/devices/pool", token);
      // Disable all former pool member devices
      if (memberDeviceIds.length > 0) {
        await Promise.all(
          memberDeviceIds.map((deviceId) =>
            apiPatch<{ enabled: boolean }, { status: string; device: DeviceRecord }>(
              `/api/devices/${deviceId}`,
              { enabled: false },
              token,
            ),
          ),
        );
      }
      setPool(null);
      setSelectedPoolDeviceIds([]);
      await refreshDevices(token);
      setSuccessMessage("GPU pool deleted. Any models assigned to the pool have been reverted to Auto.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete GPU pool");
    } finally {
      setPoolLoading(false);
    }
  }

  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="mt-2 font-display text-xl">{setupMode ? "Step 2: Devices" : "Devices"}</h2>
            {setupMode ? <p className="mt-2 max-w-3xl text-sm text-black/70">Enable at least one device so models have somewhere to run.</p> : null}
          </div>
        </div>

        {errorMessage ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
        {successMessage ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

        <div className="mt-5 space-y-4">
          {showPoolSection ? (
            <article className="rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-display text-base text-violet-900">GPU Pool</h3>
                  <p className="mt-1 text-sm text-violet-700/80">
                    Combine multiple NVIDIA GPUs to load larger models across them using llama.cpp tensor splitting.
                  </p>
                </div>
                {pool && !poolEditing ? (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleTogglePool()}
                      disabled={poolLoading}
                      className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${poolEnabled ? "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : "border-black/15 bg-white text-black/55 hover:bg-black/5"}`}
                    >
                      {poolLoading ? "Saving..." : poolEnabled ? "Enabled" : "Disabled"}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setPoolEditing(true); setSelectedPoolDeviceIds(pool.devices.map((d) => d.id)); }}
                      className="cursor-pointer rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-100"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowDeletePoolConfirm(true)}
                      className="cursor-pointer rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-50"
                    >
                      Delete Pool
                    </button>
                  </div>
                ) : null}
              </div>

              {showDeletePoolConfirm ? (
                <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                  <p className="text-sm text-rose-800">Delete the GPU pool? Models assigned to it will be unloaded and reverted to Auto. Pool member GPUs will be disabled.</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => void handleDeletePool()} disabled={poolLoading} className="cursor-pointer rounded-lg border border-rose-300 bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
                      {poolLoading ? "Deleting..." : "Confirm Delete"}
                    </button>
                    <button type="button" onClick={() => setShowDeletePoolConfirm(false)} className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold text-black/70 hover:bg-black/5">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {pool && !poolEditing ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.15em] text-violet-600">Pool Members</p>
                  <ul className="mt-2 space-y-1">
                    {pool.devices.map((d) => (
                      <li key={d.id} className="text-sm text-violet-900">
                        {d.name} <span className="text-violet-500">· {d.hardware_id} · {d.memory_mb.toLocaleString()} MB</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {(!pool || poolEditing) ? (
                <div className="mt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-violet-600">
                    {poolEditing ? "Edit Pool Members" : "Select GPUs for Pool"}
                  </p>
                  {!poolEditing && nvidiaDevices.some((d) => d.enabled) ? (
                    <p className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Disable all devices before creating a pool. Pool enable/disable will manage these GPUs.
                    </p>
                  ) : null}
                  <div className="space-y-2">
                    {nvidiaDevices.map((d) => (
                      <label key={d.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-black/80 hover:bg-violet-50">
                        <input
                          type="checkbox"
                          checked={selectedPoolDeviceIds.includes(d.id)}
                          onChange={() => togglePoolDevice(d.id)}
                        />
                        <span className="flex-1">{d.name}</span>
                        <span className="text-xs text-black/45">{d.hardware_id} · {d.memory_mb.toLocaleString()} MB</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      disabled={selectedPoolDeviceIds.length < 2 || poolLoading || (!poolEditing && nvidiaDevices.some((d) => d.enabled))}
                      onClick={poolEditing ? () => void handleUpdatePool() : () => void handleCreatePool()}
                      className="cursor-pointer rounded-lg border border-violet-400 bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {poolLoading ? "Saving..." : poolEditing ? "Save Pool" : "Create Pool"}
                    </button>
                    {poolEditing ? (
                      <button
                        type="button"
                        onClick={() => { setPoolEditing(false); setSelectedPoolDeviceIds(pool?.devices.map((d) => d.id) ?? []); }}
                        className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm font-semibold text-black/70 hover:bg-black/5"
                      >
                        Cancel
                      </button>
                    ) : null}
                  </div>
                  {selectedPoolDeviceIds.length < 2 ? (
                    <p className="mt-2 text-xs text-violet-500">Select at least 2 NVIDIA GPUs to create a pool.</p>
                  ) : null}
                </div>
              ) : null}
            </article>
          ) : null}

          {devices.map((device) => {
            const inPool = poolDeviceIds.has(device.id);
            return (
            <article
              key={device.id}
              className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-base">{device.name}</h3>
                    {inPool && (
                      <span className="rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">In Pool</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-black/70">{device.vendor} {device.device_type} · {device.hardware_id} · {device.memory_mb.toLocaleString()} MB</p>
                </div>
                {inPool ? (
                  <span className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-600">
                    Managed by Pool
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => updateDeviceDraft(device.id, { enabled: !device.enabled })}
                    className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${device.enabled ? "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : "border-black/15 bg-white text-black/55 hover:bg-black/5"}`}
                  >
                    {device.enabled ? "Enabled" : "Disabled"}
                  </button>
                )}
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm text-black/70">
                  Name
                  <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={device.name} onChange={(event) => updateDeviceDraft(device.id, { name: event.target.value })} />
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
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="break-all text-xs text-black/45">{device.hardware_id}</p>
                {savingDeviceIds.includes(device.id) || pendingDeviceIds.includes(device.id) ? (
                  <p className="text-sm text-black/55">
                    {savingDeviceIds.includes(device.id) ? "Saving..." : "Saving changes..."}
                  </p>
                ) : null}
              </div>
            </article>
            );
          })}
          {devices.length === 0 ? <p className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">No devices detected yet.</p> : null}
        </div>

        {setupMode ? (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-sand/60 px-4 py-4 text-sm text-black/70">
            <p>{enabledDevices > 0 ? `${enabledDevices} device${enabledDevices === 1 ? " is" : "s are"} ready.` : "Enable at least one device to continue."}</p>
            <button className="rounded-xl bg-ink px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={onContinue} disabled={enabledDevices === 0 || pendingDeviceIds.length > 0 || savingDeviceIds.length > 0}>
              Continue to Models
            </button>
          </div>
        ) : null}
      </article>
    </section>
  );
}
