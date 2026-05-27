import { useEffect, useMemo, useState } from "react";
import { apiGet } from "../lib/api";
import { formatDeviceIdLabel } from "../lib/deviceIds";
import { DeviceStatusRecord, GpuPoolRecord, StatusModelRecord, StatusResponse } from "../lib/records";
import { useAuth } from "../context/AuthContext";

const POLL_INTERVAL_MS = 5000;
const PRIMARY_MODEL_COLORS = [
  "#dc2626",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#2563eb",
  "#9333ea",
];
const FALLBACK_MODEL_COLORS = [
  "#5b5b5b",
  "#737373",
  "#8a8a8a",
  "#a3a3a3",
  "#bdbdbd",
  "#d4d4d4",
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

function hasKnownMemoryCapacity(memoryTotalMb: number) {
  return memoryTotalMb > 0;
}

function getMemoryPercent(memoryUsedMb: number, memoryTotalMb: number) {
  if (!hasKnownMemoryCapacity(memoryTotalMb)) {
    return null;
  }

  return clampPercent((memoryUsedMb / memoryTotalMb) * 100);
}

function formatMemorySummary(memoryUsedMb: number, memoryTotalMb: number) {
  if (!hasKnownMemoryCapacity(memoryTotalMb)) {
    return formatMemory(memoryUsedMb);
  }

  return `${formatMemory(memoryUsedMb)} of ${formatMemory(memoryTotalMb)}`;
}

function colorForModel(index: number) {
  if (index < PRIMARY_MODEL_COLORS.length) {
    return PRIMARY_MODEL_COLORS[index];
  }

  return FALLBACK_MODEL_COLORS[(index - PRIMARY_MODEL_COLORS.length) % FALLBACK_MODEL_COLORS.length];
}

function formatSlotCapacity(slots: number) {
  return slots === 0 ? "unlimited" : numberFormatter.format(slots);
}

function getModelColor(modelColors: Map<number, string>, modelId: number) {
  return modelColors.get(modelId) ?? FALLBACK_MODEL_COLORS[0];
}

function formatModelMemoryTooltip(model: StatusModelRecord) {
  if (model.display_memory_used_mb !== model.memory_used_mb) {
    return `${model.alias}: ${formatMemory(model.display_memory_used_mb)} attributed on this GPU (${formatMemory(model.memory_used_mb)} reported directly)`;
  }

  return `${model.alias}: ${formatMemory(model.display_memory_used_mb)}`;
}

function DeviceCard({ device, isPooled, modelColors }: { device: DeviceStatusRecord; isPooled: boolean; modelColors: Map<number, string> }) {
  const memoryPercent = getMemoryPercent(device.memory_used_mb, device.memory_total_mb);
  const modelMemoryTotal = device.models.reduce((sum, model) => sum + model.display_memory_used_mb, 0);
  const assignedMemoryPercent = getMemoryPercent(modelMemoryTotal, device.memory_total_mb);
  const unassignedMemoryPercent = memoryPercent !== null && assignedMemoryPercent !== null
    ? clampPercent(memoryPercent - assignedMemoryPercent)
    : 0;

  return (
    <article className="overflow-hidden rounded-[28px] border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-display text-xl text-ink">{device.name}</h3>
            {isPooled && (
              <span className="rounded-full border border-violet-200 bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-700">Pooled</span>
            )}
          </div>
          <p className="mt-2 text-sm text-black/65">
            {device.vendor} {device.device_type} · {formatDeviceIdLabel(device)} · {device.models.length}/{formatSlotCapacity(device.max_slots)} slots active
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.9fr)]">
        <div className="grid gap-4">
          <section className="rounded-2xl border border-black/10 bg-[#f3efe2] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Memory</p>
                <p className="mt-1 text-sm text-black/65">{formatMemorySummary(device.memory_used_mb, device.memory_total_mb)}</p>
              </div>
              <p className="font-display text-2xl text-ink">{memoryPercent !== null ? `${memoryPercent.toFixed(1)}%` : "N/A"}</p>
            </div>
            <div className="mt-4 flex h-4 overflow-hidden rounded-full bg-black/10">
              {memoryPercent !== null ? device.models.map((model, index) => (
                <div
                  key={`${device.id}-memory-${model.model_id}`}
                  className="h-full first:rounded-l-full last:rounded-r-full"
                  style={{
                    width: `${getMemoryPercent(model.display_memory_used_mb, device.memory_total_mb) ?? 0}%`,
                    backgroundColor: getModelColor(modelColors, model.model_id),
                  }}
                  title={formatModelMemoryTooltip(model)}
                />
              )) : <div className="h-full w-full rounded-full bg-black/25" title="Memory capacity unavailable" />}
              {unassignedMemoryPercent > 0 ? (
                <div
                  className={`h-full bg-black/20 ${device.models.length > 0 ? "rounded-r-full" : "rounded-full"}`}
                  style={{ width: `${unassignedMemoryPercent}%` }}
                  title="Used by runtime or system overhead"
                />
              ) : null}
            </div>
          </section>
        </div>

        <section className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Loaded Models</p>

          <div className="mt-4 space-y-3">
            {device.models.length > 0 ? device.models.map((model, index) => (
              <div key={`${device.id}-legend-${model.model_id}`} className="rounded-2xl border border-black/10 bg-white px-3 py-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: getModelColor(modelColors, model.model_id) }} />
                    <span>{model.alias}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-black/50">
                    {model.file_name}
                  </p>
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
  const [pools, setPools] = useState<GpuPoolRecord[]>([]);
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

  useEffect(() => {
    if (!token) {
      return;
    }
    apiGet<GpuPoolRecord[]>("/api/devices/pools", token).then(setPools).catch(() => {});
  }, [token]);

  const visibleDevices = useMemo(() => devices.filter((device) => device.enabled), [devices]);
  const poolDeviceIds = useMemo(() => new Set(pools.flatMap((pool) => pool.devices.map((d) => d.id))), [pools]);
  const modelColors = useMemo(() => {
    const modelIds = Array.from(new Set(visibleDevices.flatMap((device) => device.models.map((model) => model.model_id)))).sort((left, right) => left - right);
    return new Map(modelIds.map((modelId, index) => [modelId, colorForModel(index)]));
  }, [visibleDevices]);

  const summary = useMemo(() => {
    const activeModels = visibleDevices.reduce((sum, device) => sum + device.models.length, 0);
    const totalMemory = visibleDevices.reduce((sum, device) => sum + device.memory_total_mb, 0);
    const usedMemory = visibleDevices.reduce((sum, device) => sum + device.memory_used_mb, 0);
    const hasKnownTotalMemory = totalMemory > 0;
    const memoryUsagePercent = hasKnownTotalMemory ? getMemoryPercent(usedMemory, totalMemory) : null;

    return {
      onlineDevices: visibleDevices.length,
      activeModels,
      totalMemory,
      usedMemory,
      memoryUsagePercent,
    };
  }, [visibleDevices]);

  return (
    <section className="grid gap-4">
      <article className="overflow-hidden rounded-[32px] border border-black/10 bg-[linear-gradient(135deg,rgba(255,250,236,0.96)_0%,rgba(241,247,241,0.92)_54%,rgba(231,240,237,0.96)_100%)] p-6 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-display text-3xl text-ink md:text-4xl">Status</h2>

          <div className="rounded-2xl border border-black/10 bg-white/75 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Memory Usage</p>
            <p className="mt-2 font-display text-3xl text-ink">{summary.memoryUsagePercent !== null ? `${summary.memoryUsagePercent.toFixed(1)}%` : "N/A"}</p>
            <p className="mt-1 text-sm text-black/55">{formatMemorySummary(summary.usedMemory, summary.totalMemory)}</p>
          </div>
        </div>
      </article>

      {errorMessage ? <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p> : null}

      {isLoading ? (
        <div className="rounded-2xl border border-black/10 bg-white/80 px-4 py-8 text-sm text-black/55 shadow-sm">Loading...</div>
      ) : visibleDevices.length > 0 ? (
        <div className="grid gap-4">
          {visibleDevices.map((device) => <DeviceCard key={device.id} device={device} isPooled={poolDeviceIds.has(device.id)} modelColors={modelColors} />)}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-black/15 bg-white/60 px-4 py-8 text-sm text-black/55 shadow-sm">No ready devices are available.</div>
      )}
    </section>
  );
}