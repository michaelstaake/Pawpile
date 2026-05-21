import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { DeviceStatusRecord, StatusModelRecord, StatusResponse } from "../lib/records";
import { useAuth } from "../context/AuthContext";

const POLL_INTERVAL_MS = 5000;
const MODEL_COLORS = [
  "#d97706",
  "#0f766e",
  "#2563eb",
  "#be123c",
  "#7c3aed",
  "#15803d",
  "#c2410c",
  "#1d4ed8",
  "#9f1239",
  "#4338ca",
];

const numberFormatter = new Intl.NumberFormat();

function clampPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, value));
}

function formatMemory(memoryMb: number) {
  if (memoryMb >= 1024) {
    return `${(memoryMb / 1024).toFixed(1)} GB`;
  }

  return `${numberFormatter.format(memoryMb)} MB`;
}

function colorForModel(model: StatusModelRecord) {
  let hash = 0;
  const key = `${model.model_id}:${model.alias}`;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return MODEL_COLORS[hash % MODEL_COLORS.length];
}

function usageLabel(device: DeviceStatusRecord) {
  if (device.usage_percent === null) {
    return `${device.models.length}/${device.max_slots} slots active`;
  }

  return `${device.usage_percent.toFixed(1)}% in use`;
}

function DeviceCard({ device }: { device: DeviceStatusRecord }) {
  const usagePercent = clampPercent(device.usage_percent ?? (device.models.length / Math.max(1, device.max_slots)) * 100);
  const memoryPercent = clampPercent((device.memory_used_mb / Math.max(1, device.memory_total_mb)) * 100);
  const modelMemoryTotal = device.models.reduce((sum, model) => sum + model.memory_used_mb, 0);
  const unassignedMemoryPercent = clampPercent(memoryPercent - clampPercent((modelMemoryTotal / Math.max(1, device.memory_total_mb)) * 100));
  const occupancySegments = device.models.length > 0 ? device.models : Array.from({ length: Math.max(1, device.max_slots) }, (_, index) => ({ model_id: index, alias: "Open slot", memory_used_mb: 0, pid: null }));

  return (
    <article className={`overflow-hidden rounded-[28px] border p-5 shadow-sm backdrop-blur ${device.enabled ? "border-black/10 bg-white/80" : "border-black/10 bg-white/50 opacity-80"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl text-ink">{device.name}</h3>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${device.enabled ? "bg-emerald-100 text-emerald-800" : "bg-black/5 text-black/50"}`}>
              {device.enabled ? "Ready" : "Disabled"}
            </span>
          </div>
          <p className="mt-2 text-sm text-black/60">
            {device.vendor} {device.device_type} · {device.hardware_id}
          </p>
        </div>
        <div className="rounded-2xl border border-black/10 bg-[#fff9ec] px-4 py-3 text-right">
          <p className="text-[11px] uppercase tracking-[0.24em] text-black/45">Loaded Models</p>
          <p className="mt-1 font-display text-2xl text-ink">{device.models.length}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.9fr)]">
        <div className="grid gap-4">
          <section className="rounded-2xl border border-black/10 bg-[#f8f5ea] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Usage</p>
                <p className="mt-1 text-sm text-black/65">{usageLabel(device)}</p>
              </div>
              <p className="font-display text-2xl text-ink">{usagePercent.toFixed(1)}%</p>
            </div>
            <div className="mt-4 h-4 overflow-hidden rounded-full bg-black/10">
              <div className="h-full rounded-full bg-[linear-gradient(90deg,#174f48_0%,#d97706_100%)] transition-[width] duration-500" style={{ width: `${usagePercent}%` }} />
            </div>
            <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-black/8">
              {occupancySegments.map((model) => (
                <div
                  key={`${device.id}-${model.model_id}-${model.alias}`}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${100 / occupancySegments.length}%`,
                    backgroundColor: device.models.length > 0 ? colorForModel(model) : "rgba(0,0,0,0.08)",
                  }}
                  title={device.models.length > 0 ? model.alias : "Open slot"}
                />
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-black/10 bg-[#f3efe2] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Memory</p>
                <p className="mt-1 text-sm text-black/65">{formatMemory(device.memory_used_mb)} of {formatMemory(device.memory_total_mb)}</p>
              </div>
              <p className="font-display text-2xl text-ink">{memoryPercent.toFixed(1)}%</p>
            </div>
            <div className="mt-4 flex h-5 overflow-hidden rounded-full bg-black/10">
              {device.models.map((model) => (
                <div
                  key={`${device.id}-memory-${model.model_id}`}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${clampPercent((model.memory_used_mb / Math.max(1, device.memory_total_mb)) * 100)}%`,
                    backgroundColor: colorForModel(model),
                  }}
                  title={`${model.alias}: ${formatMemory(model.memory_used_mb)}`}
                />
              ))}
              {unassignedMemoryPercent > 0 ? <div className="h-full bg-black/20" style={{ width: `${unassignedMemoryPercent}%` }} title="Used by runtime or system overhead" /> : null}
            </div>
            <p className="mt-3 text-xs text-black/50">Telemetry: usage from {device.usage_source}, memory from {device.memory_source}.</p>
          </section>
        </div>

        <section className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Model Map</p>
              <p className="mt-1 text-sm text-black/60">Each active model keeps a distinct color for this device.</p>
            </div>
            <p className="text-sm text-black/45">Slots {device.models.length}/{device.max_slots}</p>
          </div>

          <div className="mt-4 space-y-3">
            {device.models.length > 0 ? device.models.map((model) => (
              <div key={`${device.id}-legend-${model.model_id}`} className="rounded-2xl border border-black/10 bg-white px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colorForModel(model) }} />
                    <div>
                      <p className="text-sm font-semibold text-ink">{model.alias}</p>
                      <p className="text-xs text-black/50">Model #{model.model_id}{model.pid ? ` · PID ${model.pid}` : ""}</p>
                    </div>
                  </div>
                  <p className="text-sm text-black/60">{formatMemory(model.memory_used_mb)}</p>
                </div>
              </div>
            )) : (
              <div className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/55">
                No models are currently loaded on this device.
              </div>
            )}
          </div>
        </section>
      </div>
    </article>
  );
}

export default function StatusPage() {
  const { token } = useAuth();
  const [devices, setDevices] = useState<DeviceStatusRecord[]>([]);
  const [runtimeErrors, setRuntimeErrors] = useState<StatusResponse["runtime_errors"]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshedAt, setRefreshedAt] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadStatus(showSpinner: boolean) {
      if (showSpinner) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const response = await apiGet<StatusResponse>("/api/status", token || undefined);
        if (!isMounted) {
          return;
        }
        setDevices(response.devices);
        setRuntimeErrors(response.runtime_errors);
        setRefreshedAt(response.refreshed_at);
        setErrorMessage("");
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : "Failed to load status");
      } finally {
        if (!isMounted) {
          return;
        }
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }

    void loadStatus(true);
    const intervalId = window.setInterval(() => {
      void loadStatus(false);
    }, POLL_INTERVAL_MS);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [token]);

  const summary = useMemo(() => {
    const onlineDevices = devices.filter((device) => device.enabled).length;
    const activeModels = devices.reduce((sum, device) => sum + device.models.length, 0);
    const totalMemory = devices.reduce((sum, device) => sum + device.memory_total_mb, 0);
    const usedMemory = devices.reduce((sum, device) => sum + device.memory_used_mb, 0);
    const averageUsage = devices.length > 0
      ? devices.reduce((sum, device) => sum + clampPercent(device.usage_percent ?? (device.models.length / Math.max(1, device.max_slots)) * 100), 0) / devices.length
      : 0;

    return {
      onlineDevices,
      activeModels,
      totalMemory,
      usedMemory,
      averageUsage,
    };
  }, [devices]);

  return (
    <section className="grid gap-4">
      <article className="overflow-hidden rounded-[32px] border border-black/10 bg-[linear-gradient(135deg,rgba(255,250,236,0.96)_0%,rgba(241,247,241,0.92)_54%,rgba(231,240,237,0.96)_100%)] p-6 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-black/45">Runtime Status</p>
            <h2 className="mt-3 font-display text-3xl text-ink md:text-4xl">Live device load across your Pawpile runtimes</h2>
            <p className="mt-3 text-sm text-black/65 md:text-base">Track utilization, memory pressure, and exactly which models are occupying each device. The page refreshes automatically every five seconds.</p>
          </div>
          <div className="rounded-3xl border border-black/10 bg-white/75 px-4 py-3 text-sm text-black/60 shadow-sm">
            <p>{isRefreshing ? "Refreshing telemetry..." : refreshedAt ? `Updated ${new Date(refreshedAt).toLocaleTimeString()}` : "Waiting for telemetry..."}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-black/10 bg-white/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Devices Ready</p>
            <p className="mt-2 font-display text-3xl text-ink">{summary.onlineDevices}</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Active Models</p>
            <p className="mt-2 font-display text-3xl text-ink">{summary.activeModels}</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Memory In Use</p>
            <p className="mt-2 font-display text-3xl text-ink">{summary.totalMemory > 0 ? `${clampPercent((summary.usedMemory / summary.totalMemory) * 100).toFixed(1)}%` : "0.0%"}</p>
            <p className="mt-1 text-sm text-black/55">{formatMemory(summary.usedMemory)} of {formatMemory(summary.totalMemory)}</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Average Usage</p>
            <p className="mt-2 font-display text-3xl text-ink">{summary.averageUsage.toFixed(1)}%</p>
          </div>
        </div>
      </article>

      {errorMessage ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p> : null}
      {runtimeErrors.length > 0 ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Some runtimes did not respond, so telemetry may be partial.</p> : null}

      {isLoading ? (
        <div className="rounded-2xl border border-black/10 bg-white/80 px-4 py-8 text-sm text-black/55 shadow-sm">Loading live device telemetry...</div>
      ) : devices.length > 0 ? (
        <div className="grid gap-4">
          {devices.map((device) => <DeviceCard key={device.id} device={device} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-black/15 bg-white/60 px-4 py-8 text-sm text-black/55 shadow-sm">No devices are registered yet.</div>
      )}
    </section>
  );
}