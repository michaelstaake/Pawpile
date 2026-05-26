import { useEffect, useState } from "react";
import { apiGet, apiPatch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { AppSettingsRecord } from "../lib/records";

export default function ConfigurationPage() {
  const { refreshPublicSettings, token } = useAuth();
  const [settings, setSettings] = useState<AppSettingsRecord>({
    users_can_register: false,
    sitename: "Pawpile",
  });
  const [localSitename, setLocalSitename] = useState("Pawpile");
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

  useEffect(() => {
    if (settings.sitename) {
      setLocalSitename(settings.sitename);
    }
  }, [settings.sitename]);

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

  async function updateSetting(settingName: keyof AppSettingsRecord, nextValue: boolean | string) {
    if (!token) {
      return;
    }

    const previousSettings = settings;
    const nextSettings = { ...settings, [settingName]: nextValue };
    setSettings(nextSettings as AppSettingsRecord);
    setIsSaving(settingName);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await apiPatch<Partial<AppSettingsRecord>, AppSettingsRecord>("/api/admin/settings", { [settingName]: nextValue }, token);
      setSettings(response);
      await refreshPublicSettings();
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
      {errorMessage ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 shadow-sm">
          {errorMessage}
        </div>
      ) : null}
      {successMessage ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 shadow-sm">
          {successMessage}
        </div>
      ) : null}

      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <h2 className="font-display text-xl">General</h2>

        <div className="mt-5 grid gap-3">
          <div className="flex flex-col gap-2 rounded-2xl border border-black/10 bg-[#fffdf7] px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-black">Sitename</div>
                <p className="mt-1 text-sm text-black/65">
                  Change the name of this self-hosted workspace. This will update the browser title and the header.
                </p>
              </div>
            </div>
            <div className="mt-2 max-w-md">
              <input
                type="text"
                className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-ink/20"
                value={localSitename}
                onChange={(e) => setLocalSitename(e.target.value)}
                onBlur={() => {
                  if (localSitename && localSitename !== settings.sitename) {
                    void updateSetting("sitename", localSitename);
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && localSitename && localSitename !== settings.sitename) {
                    void updateSetting("sitename", localSitename);
                  }
                }}
                disabled={isLoading || isSaving === "sitename"}
                placeholder="Pawpile"
              />
            </div>
          </div>
        </div>
      </article>

      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <h2 className="font-display text-xl">Access control</h2>

        <div className="mt-5 grid gap-3">
          <label className="flex items-start justify-between gap-4 rounded-2xl border border-black/10 bg-[#fffdf7] px-4 py-4">
            <div>
              <div className="text-sm font-semibold text-black">Users can register</div>
              <p className="mt-1 text-sm text-black/65">
                If enabled, visitors can create standard accounts for themselves. If disabled, only admins can create users.
              </p>
            </div>
            <input
              type="checkbox"
              checked={settings.users_can_register}
              disabled={isLoading || isSaving === "users_can_register"}
              onChange={(event) => void updateSetting("users_can_register", event.target.checked)}
            />
          </label>
        </div>
      </article>

      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <h2 className="font-display text-xl">Pawpile v{__APP_VERSION__}</h2>
        <div className="mt-4 text-sm text-black/65">
          <p className="mt-2">
            Learn more, get help, and contribute on {" "}
            <a
              href="https://github.com/michaelstaake/Pawpile"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-ink underline underline-offset-2 hover:text-ink/85"
            >
              GitHub
            </a>.
          </p>
        </div>
      </article>
    </section>
  );
}