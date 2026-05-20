import { FormEvent, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { ApiKeyCreateResponse, ApiKeyRecord } from "../lib/records";

export default function AuthPage() {
  const { user, token, requiresSetup, isBootstrapping, isAuthenticating, login, logout } = useAuth();
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [latestApiKey, setLatestApiKey] = useState("");
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [isCreatingKey, setIsCreatingKey] = useState(false);
  const [revokingKeyId, setRevokingKeyId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!token || !user) {
      setApiKeys([]);
      return;
    }
    void refreshApiKeys(token);
  }, [token, user]);

  async function refreshApiKeys(activeToken: string) {
    setIsLoadingKeys(true);
    try {
      const response = await apiGet<ApiKeyRecord[]>("/api/auth/api-keys", activeToken);
      setApiKeys(response);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load API keys");
    } finally {
      setIsLoadingKeys(false);
    }
  }

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

  async function handleCreateApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setIsCreatingKey(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await apiPost<{ name: string }, ApiKeyCreateResponse>("/api/auth/api-keys", { name: newKeyName }, token);
      setApiKeys((current) => [response.api_key, ...current]);
      setLatestApiKey(response.plain_text_key);
      setNewKeyName("");
      setSuccessMessage(`Created API key ${response.api_key.name}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "API key creation failed");
    } finally {
      setIsCreatingKey(false);
    }
  }

  async function handleRevokeApiKey(keyId: number) {
    if (!token) {
      return;
    }

    setRevokingKeyId(keyId);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      await apiDelete<{ status: string }>(`/api/auth/api-keys/${keyId}`, token);
      setApiKeys((current) => current.filter((key) => key.id !== keyId));
      setSuccessMessage("API key revoked.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "API key revoke failed");
    } finally {
      setRevokingKeyId(null);
    }
  }

  if (!isBootstrapping && requiresSetup) {
    return <Navigate to="/setup" replace />;
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Auth</p>
        <h2 className="mt-2 font-display text-xl">{user ? "Your session" : "Sign in"}</h2>
        <p className="mt-2 text-sm text-black/70">Use your web account here, then create API keys for the OpenAI-compatible API. Regular users only see and manage their own keys.</p>

        {errorMessage ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
        {successMessage ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}
        {latestApiKey ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">New API key: <span className="font-mono">{latestApiKey}</span></p> : null}

        {!user ? (
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
        ) : (
          <div className="mt-5 rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-sm text-black/70">
            <p className="font-semibold text-black">{user.username}</p>
            <p>{user.email}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-black/45">{user.is_admin ? "Admin" : "User"}</p>
            <button className="mt-4 rounded-xl border border-black/15 px-4 py-2 font-semibold text-black" type="button" onClick={logout}>
              Sign Out
            </button>
          </div>
        )}
      </article>

      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">API Keys</p>
            <h2 className="mt-2 font-display text-xl">Client access</h2>
          </div>
          {user ? <button className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold text-black disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => token && void refreshApiKeys(token)} disabled={!token || isLoadingKeys}>{isLoadingKeys ? "Refreshing..." : "Refresh Keys"}</button> : null}
        </div>

        {!user ? (
          <p className="mt-5 rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">Sign in first to create or revoke your API keys.</p>
        ) : (
          <>
            <form className="mt-5 grid gap-3 rounded-2xl border border-dashed border-black/15 bg-sand/70 p-4" onSubmit={handleCreateApiKey}>
              <h3 className="font-display text-base">Create API Key</h3>
              <label className="grid gap-1 text-sm text-black/70">
                Key Name
                <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={newKeyName} onChange={(event) => setNewKeyName(event.target.value)} placeholder="Desktop client" />
              </label>
              <div>
                <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isCreatingKey || !newKeyName.trim()}>
                  {isCreatingKey ? "Creating..." : "Create API Key"}
                </button>
              </div>
            </form>

            <div className="mt-5 space-y-3">
              {apiKeys.map((apiKey) => (
                <div key={apiKey.id} className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-display text-base">{apiKey.name}</h3>
                      <p className="mt-1 text-sm text-black/70">{apiKey.user_username}</p>
                      <p className="mt-1 text-xs text-black/45">{apiKey.created_at ? new Date(apiKey.created_at).toLocaleString() : "Unknown date"}</p>
                    </div>
                    <button className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60" type="button" onClick={() => void handleRevokeApiKey(apiKey.id)} disabled={revokingKeyId === apiKey.id}>
                      {revokingKeyId === apiKey.id ? "Revoking..." : "Revoke"}
                    </button>
                  </div>
                </div>
              ))}
              {apiKeys.length === 0 ? <p className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">No API keys created yet.</p> : null}
            </div>
          </>
        )}
      </article>
    </section>
  );
}
