import { useEffect, useMemo, useRef, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { DeviceRecord, DeviceUpdateResponse, GpuPoolRecord } from "../lib/records";

const AUTO_SAVE_DELAY_MS = 700;
const POOL_VENDORS = ["nvidia", "vulkan"] as const;

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

function sortPools(pools: GpuPoolRecord[]) {
  return [...pools].sort((left, right) => left.vendor.localeCompare(right.vendor) || left.name.localeCompare(right.name) || left.id - right.id);
}

function vendorLabel(vendor: string) {
  return vendor === "nvidia" ? "NVIDIA" : vendor === "vulkan" ? "Vulkan" : vendor;
}

function parseNonNegativeInput(value: string) {
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }

  return Math.max(0, parsed);
}

function formatSlotCapacity(slots: number) {
  return slots === 0 ? "Unlimited" : `${slots} slot${slots === 1 ? "" : "s"}`;
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

  const [pools, setPools] = useState<GpuPoolRecord[]>([]);
  const [poolLoadingTarget, setPoolLoadingTarget] = useState<string | null>(null);
  const [selectedPoolDeviceIds, setSelectedPoolDeviceIds] = useState<number[]>([]);
  const [poolDraftName, setPoolDraftName] = useState("GPU Pool");
  const [poolDraftVendor, setPoolDraftVendor] = useState<(typeof POOL_VENDORS)[number]>("nvidia");
  const [editingPoolId, setEditingPoolId] = useState<number | null>(null);
  const [showDeletePoolConfirmId, setShowDeletePoolConfirmId] = useState<number | null>(null);

  useEffect(() => {
    latestDevicesRef.current = devices;
  }, [devices]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void refreshDevices(token);
    void refreshPools(token);
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

  async function refreshPools(activeToken: string) {
    try {
      const response = await apiGet<GpuPoolRecord[]>("/api/devices/pools", activeToken);
      setPools(sortPools(response));
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
  const availablePoolVendors = useMemo(
    () => POOL_VENDORS.filter((vendor) => devices.filter((device) => device.vendor === vendor).length > 1),
    [devices],
  );
  const draftVendorOptions = useMemo(() => {
    const currentVendor = editingPoolId === null ? null : pools.find((pool) => pool.id === editingPoolId)?.vendor ?? null;
    return Array.from(new Set([...(currentVendor ? [currentVendor] : []), ...availablePoolVendors]));
  }, [availablePoolVendors, editingPoolId, pools]);
  const showPoolSection = !setupMode && availablePoolVendors.length > 0;
  const poolDeviceToPool = useMemo(() => {
    const mapping = new Map<number, GpuPoolRecord>();
    for (const pool of pools) {
      for (const device of pool.devices) {
        mapping.set(device.id, pool);
      }
    }
    return mapping;
  }, [pools]);
  const editablePool = editingPoolId === null ? null : pools.find((pool) => pool.id === editingPoolId) ?? null;
  const filteredDraftDevices = useMemo(
    () => devices.filter((device) => {
      if (device.vendor !== poolDraftVendor) {
        return false;
      }
      const owningPool = poolDeviceToPool.get(device.id);
      return !owningPool || owningPool.id === editingPoolId;
    }),
    [devices, editingPoolId, poolDeviceToPool, poolDraftVendor],
  );

  useEffect(() => {
    if (draftVendorOptions.length === 0) {
      return;
    }
    if (!draftVendorOptions.includes(poolDraftVendor)) {
      setPoolDraftVendor(draftVendorOptions[0] as (typeof POOL_VENDORS)[number]);
    }
  }, [draftVendorOptions, poolDraftVendor]);

  useEffect(() => {
    setSelectedPoolDeviceIds((current) => current.filter((deviceId) => filteredDraftDevices.some((device) => device.id === deviceId)));
  }, [filteredDraftDevices]);

  function resetPoolDraft() {
    setEditingPoolId(null);
    setPoolDraftName("GPU Pool");
    setPoolDraftVendor((draftVendorOptions[0] ?? availablePoolVendors[0] ?? "nvidia") as (typeof POOL_VENDORS)[number]);
    setSelectedPoolDeviceIds([]);
    setShowDeletePoolConfirmId(null);
  }

  function startEditingPool(pool: GpuPoolRecord) {
    setEditingPoolId(pool.id);
    setPoolDraftName(pool.name);
    setPoolDraftVendor(pool.vendor as (typeof POOL_VENDORS)[number]);
    setSelectedPoolDeviceIds(pool.devices.map((device) => device.id));
    setShowDeletePoolConfirmId(null);
  }

  function togglePoolDevice(deviceId: number) {
    setSelectedPoolDeviceIds((current) =>
      current.includes(deviceId) ? current.filter((id) => id !== deviceId) : [...current, deviceId],
    );
  }

  function isPoolEnabled(pool: GpuPoolRecord) {
    return pool.devices.length > 0 && pool.devices.every((poolDevice) => devices.find((device) => device.id === poolDevice.id)?.enabled === true);
  }

  async function handleTogglePool(pool: GpuPoolRecord) {
    if (!token) return;
    const nextEnabled = !isPoolEnabled(pool);
    setPoolLoadingTarget(`toggle:${pool.id}`);
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
      setSuccessMessage(`${pool.name} ${nextEnabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to toggle pool");
      await refreshDevices(token);
    } finally {
      setPoolLoadingTarget(null);
    }
  }

  async function handleCreatePool() {
    if (!token || selectedPoolDeviceIds.length < 2) return;
    setPoolLoadingTarget("create");
    setErrorMessage("");
    try {
      const response = await apiPost<{ name: string; vendor: string; device_ids: number[] }, { pool: GpuPoolRecord }>(
        "/api/devices/pools",
        { name: poolDraftName.trim(), vendor: poolDraftVendor, device_ids: selectedPoolDeviceIds },
        token,
      );
      setPools((current) => sortPools([...current, response.pool]));
      resetPoolDraft();
      setSuccessMessage(`Created ${response.pool.name}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create GPU pool");
    } finally {
      setPoolLoadingTarget(null);
    }
  }

  async function handleUpdatePool() {
    if (!token || selectedPoolDeviceIds.length < 2 || !editablePool) return;
    const removedDeviceIds = editablePool.devices.map((device) => device.id).filter((id) => !selectedPoolDeviceIds.includes(id));
    setPoolLoadingTarget(`update:${editablePool.id}`);
    setErrorMessage("");
    try {
      const response = await apiPatch<{ name: string; vendor: string; device_ids: number[] }, { pool: GpuPoolRecord }>(
        `/api/devices/pools/${editablePool.id}`,
        { name: poolDraftName.trim(), vendor: poolDraftVendor, device_ids: selectedPoolDeviceIds },
        token,
      );
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
      setPools((current) => sortPools(current.map((pool) => (pool.id === response.pool.id ? response.pool : pool))));
      resetPoolDraft();
      await refreshDevices(token);
      setSuccessMessage(`Updated ${response.pool.name}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update GPU pool");
    } finally {
      setPoolLoadingTarget(null);
    }
  }

  async function handleDeletePool(pool: GpuPoolRecord) {
    if (!token) return;
    const memberDeviceIds = pool.devices.map((device) => device.id);
    setPoolLoadingTarget(`delete:${pool.id}`);
    setErrorMessage("");
    setShowDeletePoolConfirmId(null);
    try {
      await apiDelete<{ status: string }>(`/api/devices/pools/${pool.id}`, token);
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
      setPools((current) => current.filter((item) => item.id !== pool.id));
      if (editingPoolId === pool.id) {
        resetPoolDraft();
      }
      await refreshDevices(token);
      setSuccessMessage(`${pool.name} deleted. Any models assigned to it have been reverted to Auto.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete GPU pool");
    } finally {
      setPoolLoadingTarget(null);
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
                  <h3 className="font-display text-base text-violet-900">GPU Pools</h3>
                  <p className="mt-1 text-sm text-violet-700/80">
                    Create named NVIDIA-only or Vulkan-only pools to load larger models across multiple GPUs using llama.cpp tensor splitting.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => resetPoolDraft()}
                  className="cursor-pointer rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-100"
                >
                  New Pool
                </button>
              </div>

              <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.9fr)]">
                <div className="space-y-3">
                  {pools.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-violet-200 bg-white/70 px-4 py-4 text-sm text-violet-700/80">No pools created yet.</p>
                  ) : (
                    pools.map((pool) => {
                      const poolEnabled = isPoolEnabled(pool);
                      return (
                        <div key={pool.id} className="rounded-xl border border-violet-200 bg-white/80 p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="flex flex-wrap items-center gap-2">
                                <h4 className="font-display text-base text-violet-950">{pool.name}</h4>
                                <span className="rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-violet-700">{vendorLabel(pool.vendor)}</span>
                              </div>
                              <p className="mt-1 text-sm text-violet-700/80">{pool.devices.length} member GPU{pool.devices.length === 1 ? "" : "s"}</p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => void handleTogglePool(pool)}
                                disabled={poolLoadingTarget !== null}
                                className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${poolEnabled ? "border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200" : "border-black/15 bg-white text-black/55 hover:bg-black/5"}`}
                              >
                                {poolLoadingTarget === `toggle:${pool.id}` ? "Saving..." : poolEnabled ? "Enabled" : "Disabled"}
                              </button>
                              <button
                                type="button"
                                onClick={() => startEditingPool(pool)}
                                className="cursor-pointer rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-100"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowDeletePoolConfirmId(pool.id)}
                                className="cursor-pointer rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-semibold text-rose-700 shadow-sm hover:bg-rose-50"
                              >
                                Delete
                              </button>
                            </div>
                          </div>

                          {showDeletePoolConfirmId === pool.id ? (
                            <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
                              <p className="text-sm text-rose-800">Delete {pool.name}? Models assigned to it will be unloaded and reverted to Auto. Pool member GPUs will be disabled.</p>
                              <div className="mt-3 flex gap-2">
                                <button type="button" onClick={() => void handleDeletePool(pool)} disabled={poolLoadingTarget !== null} className="cursor-pointer rounded-lg border border-rose-300 bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-60">
                                  {poolLoadingTarget === `delete:${pool.id}` ? "Deleting..." : "Confirm Delete"}
                                </button>
                                <button type="button" onClick={() => setShowDeletePoolConfirmId(null)} className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold text-black/70 hover:bg-black/5">
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : null}

                          <ul className="mt-3 space-y-1">
                            {pool.devices.map((device) => (
                              <li key={device.id} className="text-sm text-violet-900">
                                {device.name} <span className="text-violet-500">· {device.hardware_id} · {device.memory_mb.toLocaleString()} MB</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="rounded-xl border border-violet-200 bg-white/80 p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.15em] text-violet-600">
                    {editingPoolId === null ? "Create Pool" : "Edit Pool"}
                  </p>
                  <div className="grid gap-3">
                    <label className="grid gap-1 text-sm text-black/70">
                      Pool Name
                      <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={poolDraftName} onChange={(event) => setPoolDraftName(event.target.value)} />
                    </label>
                    <label className="grid gap-1 text-sm text-black/70">
                      Pool Vendor
                      <select className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={poolDraftVendor} onChange={(event) => setPoolDraftVendor(event.target.value as (typeof POOL_VENDORS)[number])}>
                        {draftVendorOptions.map((vendor) => (
                          <option key={vendor} value={vendor}>{vendorLabel(vendor)}</option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-violet-600">Pool Members</p>
                      <div className="space-y-2">
                        {filteredDraftDevices.length > 0 ? filteredDraftDevices.map((device) => (
                          <label key={device.id} className="flex cursor-pointer items-center gap-3 rounded-xl border border-violet-200 bg-white px-3 py-2 text-sm text-black/80 hover:bg-violet-50">
                            <input
                              type="checkbox"
                              checked={selectedPoolDeviceIds.includes(device.id)}
                              onChange={() => togglePoolDevice(device.id)}
                            />
                            <span className="flex-1">{device.name}</span>
                            <span className="text-xs text-black/45">{device.hardware_id} · {device.memory_mb.toLocaleString()} MB</span>
                          </label>
                        )) : (
                          <p className="rounded-xl border border-dashed border-violet-200 bg-violet-50/70 px-3 py-3 text-sm text-violet-700/80">No unassigned {vendorLabel(poolDraftVendor)} GPUs are available for this pool.</p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={selectedPoolDeviceIds.length < 2 || poolLoadingTarget !== null || poolDraftName.trim().length === 0}
                        onClick={editingPoolId === null ? () => void handleCreatePool() : () => void handleUpdatePool()}
                        className="cursor-pointer rounded-lg border border-violet-400 bg-violet-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {poolLoadingTarget === "create" || (editingPoolId !== null && poolLoadingTarget === `update:${editingPoolId}`) ? "Saving..." : editingPoolId === null ? "Create Pool" : "Save Pool"}
                      </button>
                      {editingPoolId !== null ? (
                        <button
                          type="button"
                          onClick={() => resetPoolDraft()}
                          className="cursor-pointer rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm font-semibold text-black/70 hover:bg-black/5"
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                    {selectedPoolDeviceIds.length < 2 ? (
                      <p className="text-xs text-violet-500">Select at least 2 {vendorLabel(poolDraftVendor)} GPUs.</p>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          ) : null}

          {isLoading && devices.length === 0 ? <p className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">Loading devices...</p> : null}
          {devices.map((device) => {
            const owningPool = poolDeviceToPool.get(device.id);
            const inPool = owningPool !== undefined;
            return (
              <article
                key={device.id}
                className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-base">{device.name}</h3>
                    </div>
                    <p className="mt-1 text-sm text-black/70">{device.vendor} {device.device_type} · {device.hardware_id} · {device.memory_mb.toLocaleString()} MB</p>
                  </div>
                  {inPool ? (
                    <span className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-600">
                      {owningPool.name}
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
                    <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="number" min={0} value={device.max_slots} onChange={(event) => updateDeviceDraft(device.id, { max_slots: parseNonNegativeInput(event.target.value) })} />
                    <span className="text-xs text-black/45">{formatSlotCapacity(device.max_slots)}</span>
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
          {devices.length === 0 && !isLoading ? <p className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">No devices detected yet.</p> : null}
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
