import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AuthPage() {
  const { user, requiresSetup, isBootstrapping, isAuthenticating, login } = useAuth();
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await login(loginUsername, loginPassword);
      setLoginPassword("");
      setSuccessMessage("Signed in.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Login failed");
    }
  }

  if (!isBootstrapping && requiresSetup) {
    return <Navigate to="/setup" replace />;
  }

  if (user) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Auth</p>
        <h2 className="mt-2 font-display text-xl">Sign in</h2>
        <p className="mt-2 text-sm text-black/70">Use your web account here to start a browser session. Profile and API key management have dedicated pages once you're signed in.</p>

        {errorMessage ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
        {successMessage ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}
        <form className="mt-5 grid gap-3" onSubmit={handleLogin}>
          <label className="grid gap-1 text-sm text-black/70">
            Username
            <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} autoComplete="username" />
          </label>
          <label className="grid gap-1 text-sm text-black/70">
            Password
            <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" />
          </label>
          <div>
            <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isAuthenticating}>
              {isAuthenticating ? "Signing in..." : "Sign In"}
            </button>
          </div>
        </form>
    </section>
  );
}
