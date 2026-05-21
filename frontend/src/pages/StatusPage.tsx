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
    return "Live utilization unavailable";
  }

  return `${device.usage_percent.toFixed(1)}% live load`;
}

function DeviceCard({ device }: { device: DeviceStatusRecord }) {
  const usagePercent = clampPercent(device.usage_percent);
  const hasUsage = device.usage_percent !== null;
  const memoryPercent = clampPercent((device.memory_used_mb / Math.max(1, device.memory_total_mb)) * 100);
  const modelMemoryTotal = device.models.reduce((sum, model) => sum + model.memory_used_mb, 0);
  const unassignedMemoryPercent = clampPercent(memoryPercent - clampPercent((modelMemoryTotal / Math.max(1, device.memory_total_mb)) * 100));

  return (
    <article className="overflow-hidden rounded-[28px] border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-xl text-ink">{device.name}</h3>
          <p className="mt-2 text-sm text-black/65">
            {device.vendor} {device.device_type} · {device.hardware_id} · {device.models.length}/{device.max_slots} slots active
          </p>
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
              <p className="font-display text-2xl text-ink">{hasUsage ? `${usagePercent.toFixed(1)}%` : "N/A"}</p>
            </div>
            <div className="mt-4 h-4 overflow-hidden rounded-full bg-black/10">
              <div
                className={`h-full rounded-full transition-[width] duration-500 ${hasUsage ? "bg-blue-600" : "bg-black/25"}`}
                style={{ width: hasUsage ? `${usagePercent}%` : "100%" }}
              />
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
          </section>
        </div>

        <section className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Loaded Models</p>

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
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadStatus(showSpinner: boolean) {
      if (showSpinner) {
        setIsLoading(true);
      }

      try {
        const response = await apiGet<StatusResponse>("/api/status", token || undefined);
        if (!isMounted) {
          return;
        }
        setDevices(response.devices);
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

  const visibleDevices = useMemo(() => devices.filter((device) => device.enabled), [devices]);

  const summary = useMemo(() => {
    const activeModels = visibleDevices.reduce((sum, device) => sum + device.models.length, 0);
    const totalMemory = visibleDevices.reduce((sum, device) => sum + device.memory_total_mb, 0);
    const usedMemory = visibleDevices.reduce((sum, device) => sum + device.memory_used_mb, 0);
    const devicesWithUsage = visibleDevices.filter((device) => device.usage_percent !== null);
    const averageUsage = devicesWithUsage.length > 0
      ? devicesWithUsage.reduce((sum, device) => sum + clampPercent(device.usage_percent), 0) / devicesWithUsage.length
      : 0;

    return {
      onlineDevices: visibleDevices.length,
      activeModels,
      totalMemory,
      usedMemory,
      averageUsage,
      devicesWithUsageCount: devicesWithUsage.length,
    };
  }, [visibleDevices]);

  return (
    <section className="grid gap-4">
      <article className="overflow-hidden rounded-[32px] border border-black/10 bg-[linear-gradient(135deg,rgba(255,250,236,0.96)_0%,rgba(241,247,241,0.92)_54%,rgba(231,240,237,0.96)_100%)] p-6 shadow-sm backdrop-blur">
        <h2 className="font-display text-3xl text-ink md:text-4xl">Status</h2>

        <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-2xl border border-black/10 bg-white/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Devices</p>
            <p className="mt-2 font-display text-3xl text-ink">{summary.onlineDevices}</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Loaded Models</p>
            <p className="mt-2 font-display text-3xl text-ink">{summary.activeModels}</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Memory In Use</p>
            <p className="mt-2 font-display text-3xl text-ink">{summary.totalMemory > 0 ? `${clampPercent((summary.usedMemory / summary.totalMemory) * 100).toFixed(1)}%` : "0.0%"}</p>
            <p className="mt-1 text-sm text-black/55">{formatMemory(summary.usedMemory)} of {formatMemory(summary.totalMemory)}</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Average Usage</p>
            <p className="mt-2 font-display text-3xl text-ink">{summary.devicesWithUsageCount > 0 ? `${summary.averageUsage.toFixed(1)}%` : "N/A"}</p>
            <p className="mt-2 text-xs text-black/50">{summary.devicesWithUsageCount > 0 ? `From ${summary.devicesWithUsageCount} device${summary.devicesWithUsageCount === 1 ? "" : "s"} with live telemetry` : "No live telemetry available"}</p>
          </div>
        </div>
      </article>

      {errorMessage ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p> : null}

      {isLoading ? (
        <div className="rounded-2xl border border-black/10 bg-white/80 px-4 py-8 text-sm text-black/55 shadow-sm">Loading live device telemetry...</div>
      ) : visibleDevices.length > 0 ? (
        <div className="grid gap-4">
          {visibleDevices.map((device) => <DeviceCard key={device.id} device={device} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-black/15 bg-white/60 px-4 py-8 text-sm text-black/55 shadow-sm">No ready devices are available.</div>
      )}
    </section>
  );
}