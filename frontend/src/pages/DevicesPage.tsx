import { useEffect, useRef, useState } from "react";
import { apiGet, apiPatch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { DeviceRecord, DeviceUpdateResponse } from "../lib/records";

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

  useEffect(() => {
    latestDevicesRef.current = devices;
  }, [devices]);

  useEffect(() => {
    if (!token) {
      return;
    }
    void refreshDevices(token);
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
          {devices.map((device) => (
            <article
              key={device.id}
              className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4"
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
                  Enabled
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
                {savingDeviceIds.includes(device.id) || pendingDeviceIds.includes(device.id) ? (
                  <p className="text-sm text-black/55">
                    {savingDeviceIds.includes(device.id) ? "Saving..." : "Saving changes..."}
                  </p>
                ) : null}
              </div>
            </article>
          ))}
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
