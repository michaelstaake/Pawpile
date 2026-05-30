import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "../lib/api";
import { formatDeviceIdLabel } from "../lib/deviceIds";
import { DeviceStatusRecord, GpuPoolRecord, StatusModelRecord, StatusResponse, TokenUsageMetricRecord, TokenUsageSummaryRecord, TopTokenUserRecord } from "../lib/records";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const POLL_INTERVAL_MS = 5000;
const PRIMARY_MODEL_COLORS = [
  "#770088",
  "#004CFF",
  "#028121",
  "#FFEE00",
  "#FF8D00",
  "#E50000",
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

function getModelColor(modelColors: Map<number, string>, modelId: number) {
  return modelColors.get(modelId) ?? FALLBACK_MODEL_COLORS[0];
}

function formatModelMemoryTooltip(model: StatusModelRecord) {
  if (model.display_memory_used_mb !== model.memory_used_mb) {
    return `${model.alias}: ${formatMemory(model.display_memory_used_mb)} attributed on this GPU (${formatMemory(model.memory_used_mb)} reported directly)`;
  }

  return `${model.alias}: ${formatMemory(model.display_memory_used_mb)}`;
}

function formatRawModelMemoryTooltip(model: StatusModelRecord) {
  return `${model.alias}: ${formatMemory(model.memory_used_mb)}`;
}

function formatTokenTooltip(metric: TokenUsageMetricRecord | TopTokenUserRecord) {
  if (!metric) {
    return undefined;
  }

  return `${numberFormatter.format(metric.input_tokens)} input / ${numberFormatter.format(metric.output_tokens)} output`;
}

function formatTokenValue(metric: TokenUsageMetricRecord | TopTokenUserRecord) {
  if (!metric) {
    return "N/A";
  }

  return numberFormatter.format(metric.total_tokens);
}

function formatWholePercent(value: number) {
  return `${Math.round(clampPercent(value))}%`;
}

function getSystemHealth(activeModels: number, memoryUsagePercent: number | null) {
  if (activeModels === 0) {
    return {
      label: "Unready",
      iconClassName: "bi bi-x-octagon-fill",
      iconColorClassName: "text-[#c63f3f]",
      detail: "No models are currently loaded.",
    };
  }

  if (memoryUsagePercent !== null && memoryUsagePercent > 80) {
    return {
      label: "Warning",
      iconClassName: "bi bi-exclamation-triangle-fill",
      iconColorClassName: "text-[#c98a13]",
      detail: "AI memory usage is above 80%.",
    };
  }

  return {
    label: "Ready",
    iconClassName: "bi bi-check-circle-fill",
    iconColorClassName: "text-[#2f8f4e]",
    detail: "Everything is awesome!",
  };
}

function DeviceCard({ device, isPooled, modelColors }: { device: DeviceStatusRecord; isPooled: boolean; modelColors: Map<number, string> }) {
  const isCpuDevice = device.device_type.toLowerCase() === "cpu" || device.vendor.toLowerCase() === "cpu";
  const memoryPercent = getMemoryPercent(device.memory_used_mb, device.memory_total_mb);
  const modelMemoryTotal = device.models.reduce(
    (sum, model) => sum + (isCpuDevice ? model.memory_used_mb : model.display_memory_used_mb),
    0,
  );
  const assignedMemoryPercent = getMemoryPercent(modelMemoryTotal, device.memory_total_mb);
  const unassignedMemoryPercent = memoryPercent !== null && assignedMemoryPercent !== null
    ? clampPercent(memoryPercent - assignedMemoryPercent)
    : 0;
  const memoryBarSegments = memoryPercent !== null ? [
    ...(isCpuDevice && unassignedMemoryPercent > 0 ? [{
      key: `${device.id}-memory-system`,
      width: unassignedMemoryPercent,
      backgroundColor: "#000000",
      title: "System RAM used outside Pawpile",
    }] : []),
    ...device.models.map((model) => ({
      key: `${device.id}-memory-${model.model_id}`,
      width: getMemoryPercent(isCpuDevice ? model.memory_used_mb : model.display_memory_used_mb, device.memory_total_mb) ?? 0,
      backgroundColor: getModelColor(modelColors, model.model_id),
      title: isCpuDevice ? formatRawModelMemoryTooltip(model) : formatModelMemoryTooltip(model),
    })).filter((segment) => segment.width > 0),
    ...(!isCpuDevice && unassignedMemoryPercent > 0 ? [{
      key: `${device.id}-memory-unassigned`,
      width: unassignedMemoryPercent,
      backgroundColor: "rgba(0, 0, 0, 0.2)",
      title: "Used by runtime or system overhead",
    }] : []),
  ] : [];

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
            {device.device_type.toUpperCase()} {device.display_suffix}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
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
              {memoryPercent !== null ? memoryBarSegments.map((segment, index) => (
                <div
                  key={segment.key}
                  className={`h-full ${memoryBarSegments.length === 1 ? "rounded-full" : index === 0 ? "rounded-l-full" : index === memoryBarSegments.length - 1 ? "rounded-r-full" : ""}`}
                  style={{
                    width: `${segment.width}%`,
                    backgroundColor: segment.backgroundColor,
                  }}
                  title={segment.title}
                />
              )) : <div className="h-full w-full rounded-full bg-black/25" title="Memory capacity unavailable" />}
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
  const { showError } = useToast();
  const [devices, setDevices] = useState<DeviceStatusRecord[]>([]);
  const [pools, setPools] = useState<GpuPoolRecord[]>([]);
  const [systemCpuUsagePercent, setSystemCpuUsagePercent] = useState<number | null>(null);
  const [tokenUsage, setTokenUsage] = useState<TokenUsageSummaryRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const lastErrorMessageRef = useRef<string | null>(null);

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
        setSystemCpuUsagePercent(response.system_cpu_usage_percent);
        setTokenUsage(response.token_usage);
        lastErrorMessageRef.current = null;
      } catch (error) {
        if (!isMounted) {
          return;
        }
        setSystemCpuUsagePercent(null);
        setTokenUsage(null);
        const message = error instanceof Error ? error.message : "Failed to load status";
        if (lastErrorMessageRef.current !== message) {
          showError(message, { id: "status-error" });
          lastErrorMessageRef.current = message;
        }
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

  const tokenCards = useMemo(() => {
    const emptyMetric: TokenUsageMetricRecord = { total_tokens: 0, input_tokens: 0, output_tokens: 0 };
    const summary = tokenUsage;
    const topUserLast24Hours = summary?.top_user_last_24_hours ?? null;
    const last24HoursTotalTokens = summary?.last_24_hours.total_tokens ?? 0;
    const topUserLast24HoursPercent = topUserLast24Hours && last24HoursTotalTokens > 0
      ? (topUserLast24Hours.total_tokens / last24HoursTotalTokens) * 100
      : 0;

    return [
      {
        label: "Since Startup",
        value: formatTokenValue(summary?.since_startup ?? emptyMetric),
        title: formatTokenTooltip(summary?.since_startup ?? emptyMetric),
        detail: "Tokens",
      },
      {
        label: "Last 1 Hour",
        value: formatTokenValue(summary?.last_1_hour ?? emptyMetric),
        title: formatTokenTooltip(summary?.last_1_hour ?? emptyMetric),
        detail: "Tokens",
      },
      {
        label: "Last 24 Hours",
        value: formatTokenValue(summary?.last_24_hours ?? emptyMetric),
        title: formatTokenTooltip(summary?.last_24_hours ?? emptyMetric),
        detail: "Tokens",
      },
      {
        label: "Last 7 Days",
        value: formatTokenValue(summary?.last_7_days ?? emptyMetric),
        title: formatTokenTooltip(summary?.last_7_days ?? emptyMetric),
        detail: "Tokens",
      },
      {
        label: "Last 30 Days",
        value: formatTokenValue(summary?.last_30_days ?? emptyMetric),
        title: formatTokenTooltip(summary?.last_30_days ?? emptyMetric),
        detail: "Tokens",
      },
      {
        label: "Forever",
        value: formatTokenValue(summary?.forever ?? emptyMetric),
        title: formatTokenTooltip(summary?.forever ?? emptyMetric),
        detail: "Tokens",
      },
      {
        label: "Top User 24h",
        value: topUserLast24Hours?.username ?? "No usage yet",
        title: formatTokenTooltip(topUserLast24Hours),
        detail: topUserLast24Hours ? formatWholePercent(topUserLast24HoursPercent) : "0%",
      },
      {
        label: "Top User Forever",
        value: formatTokenValue(summary?.top_user_forever ?? null),
        title: formatTokenTooltip(summary?.top_user_forever ?? null),
        detail: summary?.top_user_forever?.username ?? "No usage yet",
      },
    ];
  }, [tokenUsage]);

  const systemHealth = useMemo(
    () => getSystemHealth(summary.activeModels, summary.memoryUsagePercent),
    [summary.activeModels, summary.memoryUsagePercent],
  );

  return (
    <section className="grid gap-4">
      <article className="overflow-hidden rounded-[32px] border border-black/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.88)_0%,rgba(245,240,226,0.78)_100%)] p-6 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-2xl text-ink md:text-3xl">Status</h3>
            {/* <p className="mt-1 text-sm text-black/55">Live system health plus persisted token usage across recent windows and top users.</p> */}
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Host CPU</p>
            <p className="mt-2 font-display text-3xl text-ink">{systemCpuUsagePercent !== null ? `${systemCpuUsagePercent.toFixed(1)}%` : "N/A"}</p>
            <p className="mt-1 text-sm text-black/55">Total utilization</p>
          </div>

          <div className="rounded-2xl border border-black/10 bg-white/80 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">AI Memory</p>
            <p className="mt-2 font-display text-3xl text-ink">{summary.memoryUsagePercent !== null ? `${summary.memoryUsagePercent.toFixed(1)}%` : "N/A"}</p>
            <p className="mt-1 text-sm text-black/55">{formatMemorySummary(summary.usedMemory, summary.totalMemory)}</p>
          </div>

          <div className="rounded-2xl border border-black/10 bg-white/80 p-4 sm:col-span-2 lg:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">System Health</p>
            <div className="mt-2 flex items-center gap-3">
              <i className={`${systemHealth.iconClassName} ${systemHealth.iconColorClassName} text-[28px] leading-none`} aria-hidden="true" />
              <p className="font-display text-3xl text-ink">{systemHealth.label}</p>
            </div>
            <p className="mt-1 text-sm text-black/55">{systemHealth.detail}</p>
          </div>

          {tokenCards.map((card) => (
            <div key={card.label} className="rounded-2xl border border-black/10 bg-white/80 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">{card.label}</p>
              <p className="mt-2 font-display text-3xl text-ink" title={card.title}>{card.value}</p>
              <p className="mt-1 text-sm text-black/55">{card.detail}</p>
            </div>
          ))}
        </div>
      </article>

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