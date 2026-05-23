import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function SetupPage() {
  const navigate = useNavigate();
  const { bootstrapAdmin, isAuthenticating } = useAuth();
  const [username, setUsername] = useState("admin");
  const [email, setEmail] = useState("admin@localhost");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleBootstrap(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage("");

    try {
      await bootstrapAdmin(username, email, password);
      setPassword("");
      navigate("/configuration", { replace: true });
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
      {errorMessage ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p>
      ) : null}

      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <h3 className="font-display text-lg">Create admin account</h3>
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
          <div className="mt-2">
            <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isAuthenticating}>
              {isAuthenticating ? "Creating..." : "Create Account"}
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}