import { FormEvent, useEffect, useState } from "react";
import Modal from "../components/ui/Modal";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { ApiKeyCreateResponse, ApiKeyRecord } from "../lib/records";

function formatCreatedAt(value: string | null): string {
  if (!value) {
    return "Unknown creation date";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}


export default function ApiPage() {
  const { token, user } = useAuth();
  const [apiKeys, setApiKeys] = useState<ApiKeyRecord[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [latestApiKey, setLatestApiKey] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
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
      setCopyState("idle");
      setNewKeyName("");
      setIsCreateModalOpen(true);
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

  async function handleCopyLatestApiKey() {
    if (!latestApiKey) {
      return;
    }

    try {
      await navigator.clipboard.writeText(latestApiKey);
      setCopyState("copied");
    } catch {
      // Fallback for non-secure (HTTP) contexts
      const textarea = document.createElement("textarea");
      textarea.value = latestApiKey;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand("copy");
        setCopyState("copied");
      } catch {
        setCopyState("failed");
      } finally {
        document.body.removeChild(textarea);
      }
    }
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false);
    setLatestApiKey("");
    setCopyState("idle");
  }

  return (
    <section className="grid gap-4">
      {errorMessage ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p> : null}
      {successMessage ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p> : null}

      <article className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="font-display text-2xl">API keys</h2>
          </div>
          <button className="rounded-xl border border-black/15 bg-white px-4 py-3 text-sm font-semibold text-black" type="button" onClick={() => setIsCreateModalOpen(true)}>
            Add API key
          </button>
        </div>

        <div className="mt-5 space-y-4">
            {apiKeys.map((apiKey) => (
              <div key={apiKey.id} className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h3 className="font-display text-lg text-black">{apiKey.name}</h3>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-black/45">Created {formatCreatedAt(apiKey.created_at)}</p>
                  </div>
                  <button
                    className="rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                    type="button"
                    onClick={() => void handleRevokeApiKey(apiKey.id)}
                    disabled={revokingKeyId === apiKey.id}
                  >
                    {revokingKeyId === apiKey.id ? "Revoking..." : "Revoke"}
                  </button>
                </div>
              </div>
            ))}
            {isLoadingKeys ? <p className="rounded-2xl border border-black/10 bg-white px-4 py-6 text-sm text-black/60">Loading API keys...</p> : null}
            {!isLoadingKeys && apiKeys.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-5 py-8 text-center">
                <h3 className="font-display text-lg text-black">No API keys yet</h3>
                <p className="mt-2 text-sm text-black/60">Create your first key to connect scripts, local tools, or external clients to the API.</p>
              </div>
            ) : null}
        </div>
      </article>

      <Modal open={isCreateModalOpen} onClose={closeCreateModal} labelledBy="api-key-create-title" panelClassName="max-w-lg">
        <article className="p-5 sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <h2 id="api-key-create-title" className="font-display text-2xl">Add API key</h2>
            <button className="rounded-xl border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-black" type="button" onClick={closeCreateModal}>
              Close
            </button>
          </div>

          {!latestApiKey ? (
            <form className="mt-5 grid gap-4" onSubmit={handleCreateApiKey}>
              <label className="grid gap-2 text-sm text-black/70">
                <span className="font-semibold text-black">Key name</span>
                <input
                  className="rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm outline-none transition focus:border-black/25"
                  value={newKeyName}
                  onChange={(event) => setNewKeyName(event.target.value)}
                  placeholder="Desktop client"
                  maxLength={80}
                  autoFocus
                />
              </label>
              <div>
                <button
                  className="rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
                  type="submit"
                  disabled={isCreatingKey || !newKeyName.trim()}
                >
                  {isCreatingKey ? "Creating..." : "Create API key"}
                </button>
              </div>
            </form>
          ) : (
            <div className="mt-5 grid gap-4">
              <div className="break-all rounded-2xl bg-black px-4 py-3 font-mono text-sm text-white">
                {latestApiKey}
              </div>
              <div className="flex items-center gap-3">
                <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white" type="button" onClick={() => void handleCopyLatestApiKey()}>
                  Copy key
                </button>
                {copyState === "copied" ? <p className="text-sm text-emerald-700">Copied to clipboard.</p> : null}
                {copyState === "failed" ? <p className="text-sm text-rose-700">Copy failed — select and copy manually.</p> : null}
              </div>
            </div>
          )}
        </article>
      </Modal>
    </section>
  );
}