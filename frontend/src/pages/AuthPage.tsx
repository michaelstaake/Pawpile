import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AuthPage() {
  const { user, requiresSetup, isBootstrapping, isAuthenticating, login, register, usersCanRegister } = useAuth();
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
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

  async function handleRegister(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await register(registerUsername, registerEmail, registerPassword);
      setRegisterPassword("");
      setSuccessMessage("Account created.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Registration failed");
    }
  }

  if (!isBootstrapping && requiresSetup) {
    return <Navigate to="/setup" replace />;
  }

  if (user) {
    return <Navigate to="/profile" replace />;
  }

  return (
    <section className={`mx-auto grid max-w-5xl gap-4 ${usersCanRegister ? "lg:grid-cols-[minmax(280px,0.95fr)_minmax(0,1.05fr)_minmax(0,0.95fr)]" : "lg:grid-cols-[minmax(280px,1fr)_minmax(0,1.1fr)]"}`}>
      <article className="relative overflow-hidden rounded-[2rem] border border-black/10 bg-[linear-gradient(155deg,rgba(20,20,18,0.96),rgba(49,43,34,0.9)_54%,rgba(153,118,59,0.78))] p-6 text-white shadow-sm">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.18),transparent_35%),radial-gradient(circle_at_bottom_right,rgba(255,244,214,0.14),transparent_30%)]" />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-white/70">Welcome back</p>
          <h1 className="mt-3 font-display text-3xl leading-tight">Sign in to manage models, devices, and access.</h1>
          <p className="mt-4 max-w-sm text-sm leading-6 text-white/78">Use your Pawpile account to continue into the workspace. Admins can manage system settings, and every signed-in user can manage their own profile and API keys.</p>
          <div className="mt-8 grid gap-3 text-sm text-white/82">
            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">Profile updates stay under your personal account menu.</div>
            <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">API keys are created once and shown one time for secure copy.</div>
          </div>
        </div>
      </article>

      <article className="rounded-[2rem] border border-black/10 bg-white/90 p-6 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Account access</p>
        <h2 className="mt-2 font-display text-2xl">Sign in</h2>
        <p className="mt-2 text-sm text-black/68">Clean access to the workspace with a focused form and no extra noise.</p>

        {errorMessage ? <p className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p> : null}
        {successMessage ? <p className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p> : null}

        <form className="mt-6 grid gap-4" onSubmit={handleLogin}>
          <label className="grid gap-2 text-sm text-black/70">
            <span className="font-semibold text-black">Username</span>
            <input className="rounded-2xl border border-black/10 bg-[#fcfaf5] px-4 py-3 text-sm outline-none transition focus:border-black/25 focus:bg-white" value={loginUsername} onChange={(event) => setLoginUsername(event.target.value)} autoComplete="username" />
          </label>
          <label className="grid gap-2 text-sm text-black/70">
            <span className="font-semibold text-black">Password</span>
            <input className="rounded-2xl border border-black/10 bg-[#fcfaf5] px-4 py-3 text-sm outline-none transition focus:border-black/25 focus:bg-white" type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} autoComplete="current-password" />
          </label>
          <div className="rounded-2xl border border-dashed border-black/10 bg-sand/40 px-4 py-3 text-sm text-black/60">
            {usersCanRegister ? "New here? Create an account in the panel to the right." : "Registration is currently disabled. Ask an administrator if you need an account."}
          </div>
          <div>
            <button className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isAuthenticating}>
              {isAuthenticating ? "Signing in..." : "Sign In"}
            </button>
          </div>
        </form>
      </article>

      {usersCanRegister ? (
        <article className="rounded-[2rem] border border-black/10 bg-white/82 p-6 shadow-sm backdrop-blur">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Registration</p>
          <h2 className="mt-2 font-display text-2xl">Create an account</h2>
          <p className="mt-2 text-sm text-black/68">Join the workspace with a username, email, and password.</p>

          <form className="mt-6 grid gap-4" onSubmit={handleRegister}>
            <label className="grid gap-2 text-sm text-black/70">
              <span className="font-semibold text-black">Username</span>
              <input className="rounded-2xl border border-black/10 bg-[#fcfaf5] px-4 py-3 text-sm outline-none transition focus:border-black/25 focus:bg-white" value={registerUsername} onChange={(event) => setRegisterUsername(event.target.value)} autoComplete="username" />
            </label>
            <label className="grid gap-2 text-sm text-black/70">
              <span className="font-semibold text-black">Email</span>
              <input className="rounded-2xl border border-black/10 bg-[#fcfaf5] px-4 py-3 text-sm outline-none transition focus:border-black/25 focus:bg-white" type="email" value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} autoComplete="email" />
            </label>
            <label className="grid gap-2 text-sm text-black/70">
              <span className="font-semibold text-black">Password</span>
              <input className="rounded-2xl border border-black/10 bg-[#fcfaf5] px-4 py-3 text-sm outline-none transition focus:border-black/25 focus:bg-white" type="password" value={registerPassword} onChange={(event) => setRegisterPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <div>
              <button className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isAuthenticating}>
                {isAuthenticating ? "Creating..." : "Register"}
              </button>
            </div>
          </form>
        </article>
      ) : null}
    </section>
  );
}
