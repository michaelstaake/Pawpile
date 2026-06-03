import { FormEvent, useEffect, useRef, useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

declare global {
  interface Window {
    turnstile: {
      render: (container: string | HTMLElement, config: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      execute: (widgetId?: string) => void;
      getResponse: (widgetId?: string) => string;
      remove: (widgetId: string) => void;
    };
  }
}

export default function AuthPage() {
  const { user, requiresSetup, isBootstrapping, isAuthenticating, login, usersCanRegister, cloudflareTurnstileEnabled, cloudflareTurnstileSiteKey } = useAuth();
  const { showError, showSuccess } = useToast();
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [turnstileWidgetId, setTurnstileWidgetId] = useState<string | null>(null);
  const turnstileRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!cloudflareTurnstileEnabled || !cloudflareTurnstileSiteKey) {
      return;
    }

    if (window.turnstile) {
      const widgetId = window.turnstile.render(turnstileRef.current!, {
        sitekey: cloudflareTurnstileSiteKey,
        theme: "light",
      });
      setTurnstileWidgetId(widgetId);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = () => {
      const widgetId = window.turnstile!.render(turnstileRef.current!, {
        sitekey: cloudflareTurnstileSiteKey,
        theme: "light",
      });
      setTurnstileWidgetId(widgetId);
    };
    document.head.appendChild(script);

    return () => {
      if (turnstileWidgetId) {
        window.turnstile?.remove(turnstileWidgetId);
      }
    };
  }, [cloudflareTurnstileEnabled, cloudflareTurnstileSiteKey, turnstileWidgetId]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    let turnstileResponse: string | undefined;
    if (cloudflareTurnstileEnabled && turnstileWidgetId) {
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error("Turnstile verification timed out")), 10000);
          window.turnstile!.execute(turnstileWidgetId);
          const checkInterval = setInterval(() => {
            const token = window.turnstile!.getResponse(turnstileWidgetId);
            if (token) {
              clearInterval(checkInterval);
              clearTimeout(timeout);
              resolve();
            }
          }, 200);
        });
        turnstileResponse = window.turnstile!.getResponse(turnstileWidgetId);
      } catch {
        showError("Turnstile verification failed. Please try again.");
        return;
      }
    }

    try {
      await login(loginUsername, loginPassword, turnstileResponse);
      setLoginPassword("");
      showSuccess("Signed in.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Login failed");
    }
  }

  if (!isBootstrapping && requiresSetup) {
    return <Navigate to="/setup" replace />;
  }

  if (user) {
    return <Navigate to="/" replace />;
  }

  return (
    <section className="mx-auto max-w-xl">
      <article className="rounded-[2rem] border border-black/10 bg-white/90 p-6 shadow-sm backdrop-blur">
        <h2 className="font-display text-2xl">Sign in</h2>

        <form className="mt-6 grid gap-4" onSubmit={handleLogin}>
          <label className="grid gap-2 text-sm text-black/70">
            <span className="font-semibold text-black">Username</span>
            <input className="rounded-2xl border border-black/10 bg-[#fcfaf5] px-4 py-3 text-sm outline-none transition focus:border-black/25 focus:bg-white" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} autoComplete="username" />
          </label>
          <label className="grid gap-2 text-sm text-black/70">
            <span className="font-semibold text-black">Password</span>
            <input className="rounded-2xl border border-black/10 bg-[#fcfaf5] px-4 py-3 text-sm outline-none transition focus:border-black/25 focus:bg-white" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" />
          </label>
          {cloudflareTurnstileEnabled && cloudflareTurnstileSiteKey ? (
            <div ref={turnstileRef} className="mt-2" />
          ) : null}
          <div className="flex items-center justify-between gap-4 mt-2">
            <button className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isAuthenticating}>
              {isAuthenticating ? "Signing in..." : "Sign In"}
            </button>
            {usersCanRegister ? (
              <Link to="/register" className="text-sm text-black/60 hover:text-black hover:underline transition">
                Create an account
              </Link>
            ) : null}
          </div>
        </form>
      </article>
    </section>
  );
}
