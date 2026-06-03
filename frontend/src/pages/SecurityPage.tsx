import { useEffect, useState } from "react";
import { apiGet, apiPatch } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { AppSettingsRecord } from "../lib/records";

const DEFAULT_SITENAME = "Pawpile";

export default function SecurityPage() {
  const { token, refreshPublicSettings } = useAuth();
  const { showError, showSuccess } = useToast();
  const [settings, setSettings] = useState<AppSettingsRecord>({
    users_can_register: false,
    sitename: DEFAULT_SITENAME,
    background_color: "#efe8d2",
    background_image_path: null,
    background_image_mode: "fill",
    input_price_per_1m: 0,
    output_price_per_1m: 0,
    public_url: "",
    cloudflare_turnstile_enabled: false,
    cloudflare_turnstile_site_key: null,
    cloudflare_turnstile_secret_key: null,
    two_factor_enabled: false,
  });
  const [localSiteKey, setLocalSiteKey] = useState("");
  const [localSecretKey, setLocalSecretKey] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState<keyof AppSettingsRecord | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }
    void loadSettings(token);
  }, [token]);

  useEffect(() => {
    if (settings.cloudflare_turnstile_site_key) {
      setLocalSiteKey(settings.cloudflare_turnstile_site_key);
    }
  }, [settings.cloudflare_turnstile_site_key]);

  useEffect(() => {
    if (settings.cloudflare_turnstile_secret_key) {
      setLocalSecretKey(settings.cloudflare_turnstile_secret_key);
    }
  }, [settings.cloudflare_turnstile_secret_key]);

  async function loadSettings(activeToken: string) {
    setIsLoading(true);
    try {
      const response = await apiGet<AppSettingsRecord>("/api/admin/settings", activeToken);
      setSettings(response);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to load security settings");
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

    try {
      const response = await apiPatch<Partial<AppSettingsRecord>, AppSettingsRecord>("/api/admin/settings", { [settingName]: nextValue }, token);
      setSettings(response);
      await refreshPublicSettings();
      showSuccess("Security settings updated.");
    } catch (error) {
      setSettings(previousSettings);
      showError(error instanceof Error ? error.message : "Failed to update security setting");
    } finally {
      setIsSaving(null);
    }
  }

  const hasTurnstileKeys = Boolean(localSiteKey.trim()) && Boolean(localSecretKey.trim());
  const canEnableTurnstile = !hasTurnstileKeys;

  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <h2 className="font-display text-xl">Security</h2>

        <div className="mt-5 grid gap-3">
          <div className="rounded-2xl border border-black/10 bg-[#fffdf7] px-4 py-4">
            <div className="text-sm font-semibold text-black">CAPTCHA</div>
            <p className="mt-1 text-sm text-black/65">
              Enable Cloudflare Turnstile to protect login and registration from automated submissions.
            </p>

            <div className="mt-4 grid gap-3">
              <label className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-semibold text-black">Enable CAPTCHA</div>
                  <p className="mt-1 text-sm text-black/65">
                    {settings.cloudflare_turnstile_enabled
                      ? "CAPTCHA is enabled. Disable to remove the verification step."
                      : "Require CAPTCHA verification on login and registration."}
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settings.cloudflare_turnstile_enabled}
                  disabled={isLoading || isSaving === "cloudflare_turnstile_enabled" || canEnableTurnstile}
                  onChange={(event) => void updateSetting("cloudflare_turnstile_enabled", event.target.checked)}
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-black">Site Key</span>
                <input
                  type="text"
                  className="max-w-md rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-ink/20"
                  value={localSiteKey}
                  onChange={(e) => setLocalSiteKey(e.target.value)}
                  onBlur={() => {
                    if (localSiteKey.trim() !== (settings.cloudflare_turnstile_site_key || "")) {
                      void updateSetting("cloudflare_turnstile_site_key", localSiteKey.trim());
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (localSiteKey.trim() !== (settings.cloudflare_turnstile_site_key || "")) {
                        void updateSetting("cloudflare_turnstile_site_key", localSiteKey.trim());
                      }
                    }
                  }}
                  disabled={isLoading || isSaving === "cloudflare_turnstile_site_key"}
                  placeholder="1x00000000000000000000AA"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-black">Secret Key</span>
                <p className="text-sm text-black/65">
                  {settings.cloudflare_turnstile_secret_key
                    ? "A secret key is saved. Enter a new value to replace it."
                    : "Enter your Cloudflare Turnstile secret key."}
                </p>
                <input
                  type="password"
                  className="max-w-md rounded-xl border border-black/15 bg-white px-3 py-2 text-sm text-black focus:outline-none focus:ring-2 focus:ring-ink/20"
                  value={localSecretKey}
                  onChange={(e) => setLocalSecretKey(e.target.value)}
                  onBlur={() => {
                    if (localSecretKey.trim() !== (settings.cloudflare_turnstile_secret_key || "")) {
                      void updateSetting("cloudflare_turnstile_secret_key", localSecretKey.trim());
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      if (localSecretKey.trim() !== (settings.cloudflare_turnstile_secret_key || "")) {
                        void updateSetting("cloudflare_turnstile_secret_key", localSecretKey.trim());
                      }
                    }
                  }}
                  disabled={isLoading || isSaving === "cloudflare_turnstile_secret_key"}
                  autoComplete="off"
                  placeholder="Cloudflare Turnstile secret key"
                />
              </label>

              {canEnableTurnstile && settings.cloudflare_turnstile_enabled ? (
                <p className="text-sm text-amber-900/80">Enable CAPTCHA only after filling in both the Site Key and Secret Key.</p>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 bg-[#fffdf7] px-4 py-4">
            <div className="text-sm font-semibold text-black">2FA</div>
            <p className="mt-1 text-sm text-black/65">
              Two-factor authentication for user accounts.
            </p>
            <div className="mt-4 rounded-xl border border-black/10 bg-white px-4 py-3">
              <p className="text-sm text-black/65">Coming soon...</p>
            </div>
          </div>
        </div>
      </article>
    </section>
  );
}
