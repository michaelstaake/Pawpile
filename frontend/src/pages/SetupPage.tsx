import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import DevicesPage from "./DevicesPage";
import ModelsPage from "./ModelsPage";

export default function SetupPage() {
  const navigate = useNavigate();
  const { bootstrapAdmin, isAuthenticating, setupStatus } = useAuth();
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState("admin");
  const [email, setEmail] = useState("admin@localhost");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    if (setupStatus?.has_active_model) {
      navigate("/login", { replace: true });
      return;
    }
    if (setupStatus?.has_enabled_device) {
      setStep(3);
      return;
    }
    if (setupStatus?.has_admin_user) {
      setStep(2);
    }
  }, [navigate, setupStatus]);

  async function handleBootstrap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    try {
      await bootstrapAdmin(username, email, password);
      setPassword("");
      setStep(2);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Initial admin creation failed";
      if (message.includes("Request failed: 500")) {
        setErrorMessage("Initial admin creation failed with a server error. Check backend logs and ensure the ./data directory is writable before retrying.");
      } else {
        setErrorMessage(message);
      }
    }
  }

  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Initial Setup</p>
        <h2 className="mt-2 font-display text-xl">Finish your Pawpile install</h2>
        <p className="mt-2 max-w-3xl text-sm text-black/70">Setup is only available until you have an admin account, at least one enabled device, and at least one active model.</p>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {["Create admin", "Configure devices", "Activate models"].map((label, index) => {
            const stepNumber = index + 1;
            const isCurrent = step === stepNumber;
            const isDone = step > stepNumber;
            return (
              <div key={label} className={`rounded-2xl border px-4 py-3 text-sm ${isCurrent ? "border-ink bg-ink text-white" : isDone ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-black/10 bg-[#fffdf7] text-black/60"}`}>
                <p className="text-xs font-semibold uppercase tracking-[0.2em]">Step {stepNumber}</p>
                <p className="mt-1 font-semibold">{label}</p>
              </div>
            );
          })}
        </div>
      </article>

      {step === 1 ? (
        <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
          <h3 className="font-display text-lg">Create the first admin</h3>
          <p className="mt-2 text-sm text-black/70">This account controls the rest of setup and becomes your first administrator.</p>
          {errorMessage ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
          <form className="mt-5 grid gap-3 md:max-w-xl" onSubmit={handleBootstrap}>
            <label className="grid gap-1 text-sm text-black/70">
              Username
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="grid gap-1 text-sm text-black/70">
              Email
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
            </label>
            <label className="grid gap-1 text-sm text-black/70">
              Password
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <div>
              <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isAuthenticating}>
                {isAuthenticating ? "Creating..." : "Create Admin"}
              </button>
            </div>
          </form>
        </article>
      ) : null}

      {step === 2 ? <DevicesPage setupMode onContinue={() => setStep(3)} /> : null}
      {step === 3 ? <ModelsPage setupMode onComplete={() => navigate("/login", { replace: true })} /> : null}
    </section>
  );
}
