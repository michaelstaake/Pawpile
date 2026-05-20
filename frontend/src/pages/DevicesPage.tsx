import React from "react";

import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPatch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { DeviceRecord, DeviceUpdateResponse } from "../lib/records";

type DevicesPageProps = {
  setupMode?: boolean;
  onContinue?: () => void;
};

export default function DevicesPage({ setupMode = false, onContinue }: DevicesPageProps) {
  const { token } = useAuth();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [savingDeviceId, setSavingDeviceId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

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
      setDevices(response);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load devices");
    } finally {
      setIsLoading(false);
    }
  }

  function updateDeviceDraft(deviceId: number, updates: Partial<DeviceRecord>) {
    setDevices((current) => current.map((device) => (device.id === deviceId ? { ...device, ...updates } : device)));
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
        max_slots: device.max_slots,
      }, token);
      setDevices((current) => current.map((item) => (item.id === device.id ? response.device : item)));
      setSuccessMessage(`Saved device settings for ${response.device.name}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Device update failed");
    } finally {
      setSavingDeviceId(null);
    }
  }

  const enabledDevices = devices.filter((device) => device.enabled).length;

  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Device Scheduler</p>
            <h2 className="mt-2 font-display text-xl">{setupMode ? "Step 2: Devices" : "Devices"}</h2>
            <p className="mt-2 max-w-3xl text-sm text-black/70">
              {setupMode ? "Enable at least one device so models have somewhere to run." : "Enable and tune the devices Pawpile can schedule models onto."}
            </p>
          </div>
          <button className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => token && void refreshDevices(token)} disabled={!token || isLoading}>
            {isLoading ? "Refreshing..." : "Refresh Devices"}
          </button>
        </div>

        {errorMessage ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
        {successMessage ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

        <div className="mt-5 space-y-4">
          {devices.map((device) => (
            <form
              key={device.id}
              className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
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

        {setupMode ? (
          <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-black/10 bg-sand/60 px-4 py-4 text-sm text-black/70">
            <p>{enabledDevices > 0 ? `${enabledDevices} device${enabledDevices === 1 ? " is" : "s are"} ready.` : "Enable at least one device to continue."}</p>
            <button className="rounded-xl bg-ink px-4 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={onContinue} disabled={enabledDevices === 0}>
              Continue to Models
            </button>
          </div>
        ) : null}
      </article>
    </section>
  );
}
}
