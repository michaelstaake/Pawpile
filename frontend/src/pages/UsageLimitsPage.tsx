import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiGet, apiPatch, resolveApiUrl } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { AppSettingsRecord } from "../lib/records";
import { getStoredToken } from "../lib/session";

type OpenAIModelRecord = {
  id: string;
};

const PERIOD_FIELDS = [
  { key: "usage_limit_tokens_60_minutes" as const, label: "60 Minutes" },
  { key: "usage_limit_tokens_24_hours" as const, label: "24 Hours" },
  { key: "usage_limit_tokens_7_days" as const, label: "7 Days" },
  { key: "usage_limit_tokens_30_days" as const, label: "30 Days" },
];

const DEFAULT_SETTINGS: AppSettingsRecord = {
  users_can_register: false,
  sitename: "Pawpile",
  background_color: "#efe8d2",
  background_image_path: null,
  background_image_mode: "fill",
  input_price_per_1m: 0,
  output_price_per_1m: 0,
  public_url: "",
  cloudflare_turnstile_enabled: false,
  cloudflare_turnstile_site_key: null,
  cloudflare_turnstile_secret_key_set: false,
  two_factor_enabled: false,
  usage_limit_tokens_60_minutes: 0,
  usage_limit_tokens_24_hours: 0,
  usage_limit_tokens_7_days: 0,
  usage_limit_tokens_30_days: 0,
  usage_fallback_model_alias: null,
};

function parseLimitValue(rawValue: string): number | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return 0;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
    return null;
  }

  return parsed;
}

function validateUsageLimits(values: {
  usage_limit_tokens_60_minutes: number;
  usage_limit_tokens_24_hours: number;
  usage_limit_tokens_7_days: number;
  usage_limit_tokens_30_days: number;
}): string | null {
  const ordered = [
    { label: "60 Minutes", value: values.usage_limit_tokens_60_minutes },
    { label: "24 Hours", value: values.usage_limit_tokens_24_hours },
    { label: "7 Days", value: values.usage_limit_tokens_7_days },
    { label: "30 Days", value: values.usage_limit_tokens_30_days },
  ];

  const enabled = ordered.filter((period) => period.value > 0);
  for (let shorterIndex = 0; shorterIndex < enabled.length; shorterIndex += 1) {
    for (let longerIndex = shorterIndex + 1; longerIndex < enabled.length; longerIndex += 1) {
      if (enabled[longerIndex].value < enabled[shorterIndex].value) {
        return `The ${enabled[longerIndex].label} token limit cannot be lower than the ${enabled[shorterIndex].label} limit when both are enabled.`;
      }
    }
  }

  return null;
}

export default function UsageLimitsPage() {
  const { token } = useAuth();
  const { showError, showSuccess } = useToast();
  const [settings, setSettings] = useState<AppSettingsRecord>(DEFAULT_SETTINGS);
  const [draft, setDraft] = useState({
    usage_limit_tokens_60_minutes: "0",
    usage_limit_tokens_24_hours: "0",
    usage_limit_tokens_7_days: "0",
    usage_limit_tokens_30_days: "0",
    usage_fallback_model_alias: "",
  });
  const [models, setModels] = useState<OpenAIModelRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }

    void loadPageData(token);
  }, [token]);

  async function loadPageData(activeToken: string) {
    setIsLoading(true);
    try {
      const [settingsResponse, modelsResponse] = await Promise.all([
        apiGet<AppSettingsRecord>("/api/admin/settings", activeToken),
        loadModels(),
      ]);
      setSettings(settingsResponse);
      setDraft({
        usage_limit_tokens_60_minutes: String(settingsResponse.usage_limit_tokens_60_minutes ?? 0),
        usage_limit_tokens_24_hours: String(settingsResponse.usage_limit_tokens_24_hours ?? 0),
        usage_limit_tokens_7_days: String(settingsResponse.usage_limit_tokens_7_days ?? 0),
        usage_limit_tokens_30_days: String(settingsResponse.usage_limit_tokens_30_days ?? 0),
        usage_fallback_model_alias: settingsResponse.usage_fallback_model_alias ?? "",
      });
      setModels(modelsResponse);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to load usage limits");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadModels(): Promise<OpenAIModelRecord[]> {
    const authToken = getStoredToken() || undefined;
    const headers: Record<string, string> = {};
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetch(resolveApiUrl("/v1/models"), { headers });
    if (!response.ok) {
      throw new Error("Failed to load models");
    }

    const payload = (await response.json()) as { data?: OpenAIModelRecord[] };
    return payload.data ?? [];
  }

  const parsedLimits = useMemo(() => {
    const values = {
      usage_limit_tokens_60_minutes: parseLimitValue(draft.usage_limit_tokens_60_minutes),
      usage_limit_tokens_24_hours: parseLimitValue(draft.usage_limit_tokens_24_hours),
      usage_limit_tokens_7_days: parseLimitValue(draft.usage_limit_tokens_7_days),
      usage_limit_tokens_30_days: parseLimitValue(draft.usage_limit_tokens_30_days),
    };

    if (
      values.usage_limit_tokens_60_minutes === null
      || values.usage_limit_tokens_24_hours === null
      || values.usage_limit_tokens_7_days === null
      || values.usage_limit_tokens_30_days === null
    ) {
      return { valid: false as const, message: "Token limits must be whole numbers of zero or greater." };
    }

    const validationMessage = validateUsageLimits(values);
    if (validationMessage) {
      return { valid: false as const, message: validationMessage };
    }

    return { valid: true as const, values };
  }, [draft]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !parsedLimits.valid) {
      if (!parsedLimits.valid) {
        showError(parsedLimits.message);
      }
      return;
    }

    setIsSaving(true);
    try {
      const response = await apiPatch<
        Pick<
          AppSettingsRecord,
          | "usage_limit_tokens_60_minutes"
          | "usage_limit_tokens_24_hours"
          | "usage_limit_tokens_7_days"
          | "usage_limit_tokens_30_days"
          | "usage_fallback_model_alias"
        >,
        AppSettingsRecord
      >(
        "/api/admin/settings",
        {
          ...parsedLimits.values,
          usage_fallback_model_alias: draft.usage_fallback_model_alias.trim() || null,
        },
        token,
      );
      setSettings(response);
      setDraft({
        usage_limit_tokens_60_minutes: String(response.usage_limit_tokens_60_minutes ?? 0),
        usage_limit_tokens_24_hours: String(response.usage_limit_tokens_24_hours ?? 0),
        usage_limit_tokens_7_days: String(response.usage_limit_tokens_7_days ?? 0),
        usage_limit_tokens_30_days: String(response.usage_limit_tokens_30_days ?? 0),
        usage_fallback_model_alias: response.usage_fallback_model_alias ?? "",
      });
      showSuccess("Usage limits updated.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to save usage limits");
    } finally {
      setIsSaving(false);
    }
  }

  const limitsEnabled = parsedLimits.valid
    && Object.values(parsedLimits.values).some((value) => value > 0);

  if (isLoading) {
    return <div className="rounded-2xl border border-black/10 bg-white/80 px-4 py-8 text-sm text-black/55 shadow-sm">Loading usage limits...</div>;
  }

  return (
    <form className="grid gap-4" onSubmit={handleSubmit}>
      <section className="rounded-[28px] border border-black/10 bg-white/80 p-6 shadow-sm backdrop-blur">
        <h2 className="font-display text-2xl text-ink">Usage Limits</h2>
        <p className="mt-2 max-w-3xl text-sm text-black/60">
          Set per-account token limits for standard users. Admin users are not limited. Use zero to disable a time window.
          When every limit is zero, usage is unlimited for everyone.
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {PERIOD_FIELDS.map((period) => (
            <div key={period.key}>
              <label htmlFor={period.key} className="block text-sm font-medium text-black/70">
                {period.label}
              </label>
              <input
                id={period.key}
                type="number"
                min={0}
                step={1}
                value={draft[period.key]}
                onChange={(event) => setDraft((current) => ({ ...current, [period.key]: event.target.value }))}
                className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-ink outline-none focus:border-black/30"
              />
              <p className="mt-1 text-xs text-black/50">0 = unlimited for this window</p>
            </div>
          ))}
        </div>

        <div className="mt-6">
          <label htmlFor="usage_fallback_model_alias" className="block text-sm font-medium text-black/70">
            Fallback model
          </label>
          <select
            id="usage_fallback_model_alias"
            value={draft.usage_fallback_model_alias}
            onChange={(event) => setDraft((current) => ({ ...current, usage_fallback_model_alias: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-ink outline-none focus:border-black/30"
          >
            <option value="">No fallback model</option>
            {models.map((model) => (
              <option key={model.id} value={model.id}>
                {model.id}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-black/50">
            Standard users who hit a limit can still chat with this model until usage resets. Without a fallback, they are blocked entirely.
          </p>
        </div>

        {!parsedLimits.valid ? (
          <p className="mt-4 text-sm text-[#b42318]">{parsedLimits.message}</p>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-black/55">
            {limitsEnabled
              ? "Limits are active for standard users."
              : "All limits are currently disabled (unlimited usage)."}
          </p>
          <button
            type="submit"
            disabled={isSaving || !parsedLimits.valid}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-black/85 disabled:opacity-50"
          >
            {isSaving ? "Saving..." : "Save usage limits"}
          </button>
        </div>
      </section>

      {settings.usage_fallback_model_alias ? (
        <p className="text-xs text-black/45">
          Current fallback: <span className="font-medium text-ink">{settings.usage_fallback_model_alias}</span>
        </p>
      ) : null}
    </form>
  );
}
