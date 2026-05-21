import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPatch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { AppSettingsRecord } from "../lib/records";

const settingsLinks = [
  { to: "/apikeys", label: "API" },
  { to: "/devices", label: "Devices" },
  { to: "/models", label: "Models" },
  { to: "/users", label: "Users" },
] as const;

export default function ConfigurationPage() {
  const { refreshAuthState, token } = useAuth();
  const [settings, setSettings] = useState<AppSettingsRecord>({
    allow_anonymous_chat: true,
    users_can_register: false,
    auto_load_enabled_models_on_startup: false,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<keyof AppSettingsRecord | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadSettings(token);
  }, [token]);

  async function loadSettings(activeToken: string) {
    setIsLoading(true);
    setErrorMessage("");
    try {
      const response = await apiGet<AppSettingsRecord>("/api/admin/settings", activeToken);
      setSettings(response);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load configuration settings");
    } finally {
      setIsLoading(false);
    }
  }

  async function updateSetting(settingName: keyof AppSettingsRecord, nextValue: boolean) {
    if (!token) {
      return;
    }

    const previousSettings = settings;
    const nextSettings = { ...settings, [settingName]: nextValue };
    setSettings(nextSettings);
    setIsSaving(settingName);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await apiPatch<Partial<AppSettingsRecord>, AppSettingsRecord>("/api/admin/settings", { [settingName]: nextValue }, token);
      setSettings(response);
      await refreshAuthState();
      setSuccessMessage("Configuration updated.");
    } catch (error) {
      setSettings(previousSettings);
      setErrorMessage(error instanceof Error ? error.message : "Failed to update configuration setting");
    } finally {
      setIsSaving(null);
    }
  }

  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Configuration</p>
        <h2 className="mt-2 font-display text-xl">Access Controls</h2>

        {errorMessage ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
        {successMessage ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

        <div className="mt-5 grid gap-3">
          <label className="flex items-start justify-between gap-4 rounded-2xl border border-black/10 bg-[#fffdf7] px-4 py-4">
            <div>
              <div className="text-sm font-semibold text-black">Allow anonymous chat</div>
              <p className="mt-1 text-sm text-black/65">If enabled, users can access the web UI and use or view chat without logging in. If disabled, the home page redirects to login for signed-out visitors.</p>
            </div>
            <input
              type="checkbox"
              checked={settings.allow_anonymous_chat}
              disabled={isLoading || isSaving === "allow_anonymous_chat"}
              onChange={(event) => void updateSetting("allow_anonymous_chat", event.target.checked)}
            />
          </label>

          <label className="flex items-start justify-between gap-4 rounded-2xl border border-black/10 bg-[#fffdf7] px-4 py-4">
            <div>
              <div className="text-sm font-semibold text-black">Users can register</div>
              <p className="mt-1 text-sm text-black/65">If enabled, visitors can create standard accounts for themselves. If disabled, only admins can create users.</p>
            </div>
            <input
              type="checkbox"
              checked={settings.users_can_register}
              disabled={isLoading || isSaving === "users_can_register"}
              onChange={(event) => void updateSetting("users_can_register", event.target.checked)}
            />
          </label>

          <label className="flex items-start justify-between gap-4 rounded-2xl border border-black/10 bg-[#fffdf7] px-4 py-4">
            <div>
              <div className="text-sm font-semibold text-black">Auto-load activated models on startup</div>
              <p className="mt-1 text-sm text-black/65">If enabled, Pawpile will automatically restart models that were left activated before the backend last shut down.</p>
            </div>
            <input
              type="checkbox"
              checked={settings.auto_load_enabled_models_on_startup}
              disabled={isLoading || isSaving === "auto_load_enabled_models_on_startup"}
              onChange={(event) => void updateSetting("auto_load_enabled_models_on_startup", event.target.checked)}
            />
          </label>
        </div>
      </article>

      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Other Settings</p>
        <div className="mt-4 flex flex-wrap gap-3">
          {settingsLinks.map((link) => (
            <Link key={link.to} to={link.to} className="rounded-xl border border-black/15 bg-[#fffdf7] px-4 py-2 text-sm font-semibold text-black transition hover:bg-black/5">
              {link.label}
            </Link>
          ))}
        </div>
      </article>
    </section>
  );
}