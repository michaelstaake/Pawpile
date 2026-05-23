import { FormEvent, useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { getStoredToken } from "../lib/session";

type ChatRole = "system" | "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
  phase?: "thinking" | "streaming" | "complete";
  stats?: ChatCompletionStats | null;
};

type ChatCompletionStats = {
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  tokensPerSecond: number | null;
};

type ModelListResponse = {
  object: string;
  data: { id: string; object: string; created: number; owned_by: string }[];
};

type ChatSummary = {
  id: number;
  title: string;
  user_id: number;
  created_at: string | null;
};

type ChatDetailResponse = {
  chat: ChatSummary;
  messages: {
    id: number;
    chat_id: number;
    role: ChatRole;
    content: string;
    created_at: string | null;
  }[];
};

type ChatCreateResponse = {
  status: string;
  chat: ChatSummary;
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

type Attachment = {
  name: string;
  size: number;
  type: string;
  content?: string;
  dataUrl?: string;
};

export default function ChatPage() {
  const { token, user } = useAuth();
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [savedChats, setSavedChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  useEffect(() => {
    void loadModels();
    if (token) {
      void refreshChats(token);
    } else {
      setSavedChats([]);
      setActiveChatId(null);
    }
  }, [token]);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!isLoadingModels && models.length > 0 && !isSending) {
      inputRef.current?.focus();
    }
  }, [isLoadingModels, models, isSending]);

  async function loadModels() {
    setIsLoadingModels(true);
    setErrorMessage("");
    try {
      const response = await apiGet<ModelListResponse>("/v1/models", token || undefined);
      const aliases = response.data.map((entry) => entry.id);
      setModels(aliases);
      setSelectedModel((current) => current || aliases[0] || "");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load models");
    } finally {
      setIsLoadingModels(false);
    }
  }

  async function refreshChats(activeToken: string) {
    setIsLoadingChats(true);
    try {
      const rows = await apiGet<ChatSummary[]>("/api/chat", activeToken);
      setSavedChats(rows);
    } catch {
      setSavedChats([]);
    } finally {
      setIsLoadingChats(false);
    }
  }

  function startNewChat() {
    setMessages([]);
    setInput("");
    setErrorMessage("");
    setActiveChatId(null);
    setAttachments([]);
  }

  async function openChat(chatId: number) {
    if (!token) {
      return;
    }
    setErrorMessage("");
    try {
      const detail = await apiGet<ChatDetailResponse>(`/api/chat/${chatId}`, token);
      setActiveChatId(detail.chat.id);
      setMessages(detail.messages.map((m) => ({ role: m.role, content: m.content, phase: "complete" })));
      setInput("");
      setAttachments([]);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load chat");
    }
  }

  async function deleteChat(chatId: number) {
    if (!token) {
      return;
    }
    try {
      await apiDelete<{ status: string }>(`/api/chat/${chatId}`, token);
      setSavedChats((current) => current.filter((c) => c.id !== chatId));
      if (activeChatId === chatId) {
        startNewChat();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to delete chat");
    }
  }

  async function persistMessage(chatId: number, role: ChatRole, content: string): Promise<void> {
    if (!token || !content) {
      return;
    }
    try {
      await apiPost(`/api/chat/${chatId}/messages`, { role, content }, token);
    } catch {
      // Best-effort persistence.
    }
  }

  async function ensureChat(firstMessage: string): Promise<number | null> {
    if (!token) {
      return null;
    }
    if (activeChatId !== null) {
      return activeChatId;
    }
    try {
      const title = firstMessage.slice(0, 60);
      const response = await apiPost<{ title: string }, ChatCreateResponse>(
        "/api/chat",
        { title },
        token
      );
      setActiveChatId(response.chat.id);
      setSavedChats((current) => [response.chat, ...current]);
      return response.chat.id;
    } catch {
      return null;
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const filesArray = Array.from(e.target.files);

    filesArray.forEach((file) => {
      const isText =
        file.type.startsWith("text/") ||
        file.name.endsWith(".json") ||
        file.name.endsWith(".js") ||
        file.name.endsWith(".ts") ||
        file.name.endsWith(".tsx") ||
        file.name.endsWith(".py") ||
        file.name.endsWith(".md") ||
        file.name.endsWith(".csv") ||
        file.name.endsWith(".yaml") ||
        file.name.endsWith(".yml") ||
        file.name.endsWith(".html") ||
        file.name.endsWith(".css") ||
        file.name.endsWith(".ini") ||
        file.name.endsWith(".conf") ||
        file.name.endsWith(".sh");

      if (isText) {
        const reader = new FileReader();
        reader.onload = (event) => {
          setAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              size: file.size,
              type: file.type,
              content: event.target?.result as string,
            },
          ]);
        };
        reader.readAsText(file);
      } else if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (event) => {
          setAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              size: file.size,
              type: file.type,
              dataUrl: event.target?.result as string,
            },
          ]);
        };
        reader.readAsDataURL(file);
      } else {
        setAttachments((prev) => [
          ...prev,
          {
            name: file.name,
            size: file.size,
            type: file.type,
          },
        ]);
      }
    });

    e.target.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed && attachments.length === 0) {
      return;
    }
    if (!selectedModel) {
      setErrorMessage("Activate a model on the Models page before chatting.");
      return;
    }

    let combinedContent = trimmed;
    if (attachments.length > 0) {
      const attachmentsText = attachments
        .map((file) => {
          if (file.content) {
            return `\n\n[Attached File: ${file.name}]\n\`\`\`\n${file.content}\n\`\`\``;
          } else {
            return `\n\n[Attached File: ${file.name} (Binary/Image File, ${(file.size / 1024).toFixed(1)} KB)]`;
          }
        })
        .join("");
      combinedContent = (trimmed ? trimmed : "Analyze the attached file(s).") + attachmentsText;
    }

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: combinedContent, phase: "complete" },
    ];
    setMessages([
      ...nextMessages,
      { role: "assistant", content: "", phase: "thinking", stats: null },
    ]);
    setInput("");
    setAttachments([]);
    setErrorMessage("");
    setIsSending(true);

    const chatId = await ensureChat(trimmed ? trimmed : "Sent attachments");
    if (chatId !== null) {
      void persistMessage(chatId, "user", combinedContent);
    }

    let assistantBuffer = "";
    try {
      const stats = await streamCompletion(
        selectedModel,
        nextMessages.map((message) => ({ role: message.role, content: message.content })),
        (delta) => {
        assistantBuffer += delta;
        setMessages((current) => {
          if (current.length === 0) {
            return current;
          }
          const updated = [...current];
          const last = updated[updated.length - 1];
          updated[updated.length - 1] = {
            ...last,
            content: last.content + delta,
            phase: "streaming",
          };
          return updated;
        });
        }
      );
      setMessages((current) => {
        if (current.length === 0) {
          return current;
        }
        const updated = [...current];
        const last = updated[updated.length - 1];
        updated[updated.length - 1] = {
          ...last,
          content: assistantBuffer,
          phase: "complete",
          stats,
        };
        return updated;
      });
      if (chatId !== null && assistantBuffer) {
        void persistMessage(chatId, "assistant", assistantBuffer);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Chat request failed";
      setErrorMessage(detail);
      setMessages((current) => {
        if (current.length === 0) {
          return current;
        }
        const last = current[current.length - 1];
        if (last.role === "assistant" && last.content === "") {
          return current.slice(0, -1);
        }
        if (last.role === "assistant") {
          const updated = [...current];
          updated[updated.length - 1] = { ...last, phase: "complete" };
          return updated;
        }
        return current;
      });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="grid gap-4 md:grid-cols-[280px_1fr]">
      <aside className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm">
        <button
          type="button"
          onClick={startNewChat}
          className="w-full rounded-xl bg-ink px-4 py-2 text-left text-sm font-semibold text-white"
        >
          + New Chat
        </button>
        <div className="mt-4 space-y-2 text-sm text-black/70">
          {token ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-black/40">
                Chats {isLoadingChats ? "(loading...)" : `(${savedChats.length})`}
              </div>
              {savedChats.length === 0 && !isLoadingChats && (
                <div className="rounded-lg bg-black/5 p-2 text-xs text-black/50">
                  No chats to display.
                </div>
              )}
              <ul className="max-h-[40vh] space-y-1 overflow-y-auto">
                {savedChats.map((chat) => (
                  <li key={chat.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => void openChat(chat.id)}
                      className={`flex-1 truncate rounded-lg px-2 py-1 text-left text-xs hover:bg-black/5 ${
                        activeChatId === chat.id ? "bg-amber/30" : ""
                      }`}
                      title={chat.title}
                    >
                      {chat.title || `Chat ${chat.id}`}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteChat(chat.id)}
                      className="rounded-lg px-2 py-1 text-xs text-black/40 hover:bg-red-50 hover:text-red-700"
                      aria-label="Delete chat"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg bg-black/5 p-2 text-xs text-black/60">
              Sign in via the <a className="font-semibold underline" href="/login">Login</a>{" "}
              page to save your chat history.
            </div>
          )}
        </div>
      </aside>
      <main className="rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg">Chat</h2>
          </div>
          <select
            value={selectedModel}
            onChange={(event) => setSelectedModel(event.target.value)}
            disabled={isLoadingModels || models.length === 0}
            className="rounded-lg border border-black/20 bg-white px-3 py-2 text-sm"
          >
            {models.length === 0 ? (
              <option value="">{isLoadingModels ? "Loading models..." : "No active models"}</option>
            ) : (
              models.map((alias) => (
                <option key={alias} value={alias}>
                  {alias}
                </option>
              ))
            )}
          </select>
        </div>

        {errorMessage && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage}
          </div>
        )}

        {!isLoadingModels && models.length === 0 && (
          <div className="mb-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2 text-sm text-black/70">
            {user?.is_admin ? (
              <>
                No models are active yet. Open the{" "}
                <a className="font-semibold underline" href="/models">
                  Models
                </a>{" "}
                page to get started.
              </>
            ) : (
              "No models are active. Contact your system administrator for assistance."
            )}
          </div>
        )}

        <div
          ref={transcriptRef}
          className="min-h-[360px] max-h-[55vh] overflow-y-auto rounded-xl border border-dashed border-black/20 bg-sand p-4 text-sm text-black/80"
        >
          {messages.length === 0 ? (
            <div className="text-black/50">Nothing to see here yet - send a message to start the conversation!</div>
          ) : (
            <div className="space-y-3">
              {messages.map((message, index) => (
                message.role === "assistant" && message.phase === "thinking" && !message.content ? (
                  <div key={index} className="px-1 py-1 text-sm font-medium text-black/45">
                    <span className="inline-flex items-center gap-2">
                      <span className="animate-pulse">Processing...</span>
                    </span>
                  </div>
                ) : (
                  <div
                    key={index}
                    className={
                      message.role === "user"
                        ? "rounded-2xl border border-black/5 bg-white/90 p-4 shadow-sm"
                        : "rounded-2xl border border-black/5 bg-white/55 p-4 shadow-sm shadow-black/5"
                    }
                  >
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-black/45">
                      {message.role}
                    </div>
                    <div className="whitespace-pre-wrap leading-7 text-[15px] text-black/85">
                      {message.content}
                      {message.role === "assistant" && message.phase === "streaming" ? (
                        <span className="ml-1 inline-block h-5 w-2 animate-pulse rounded-full bg-amber align-middle" />
                      ) : null}
                    </div>
                    {message.role === "assistant" && message.phase === "complete" && message.stats ? (
                      <div className="mt-3 border-t border-black/8 pt-2 text-[11px] text-black/45">
                        <span className="font-medium text-black/55">{message.stats.model}</span>
                        <span className="mx-2 text-black/20">/</span>
                        <span>{formatInteger(message.stats.totalTokens)} tokens</span>
                        <span className="mx-2 text-black/20">/</span>
                        <span>{formatRate(message.stats.tokensPerSecond)} tok/s</span>
                      </div>
                    ) : null}
                  </div>
                )
              ))}
            </div>
          )}
        </div>

        <form className="mt-4 flex flex-col gap-2" onSubmit={handleSubmit}>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 rounded-xl border border-black/10 bg-black/5 p-2">
              {attachments.map((file, idx) => (
                <div key={idx} className="relative flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm pr-8 text-xs font-semibold text-black/70">
                  {file.type.startsWith("image/") && file.dataUrl ? (
                    <img src={file.dataUrl} alt={file.name} className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <span className="text-xl">📄</span>
                  )}
                  <div className="truncate max-w-[150px]">
                    <div className="truncate">{file.name}</div>
                    <div className="text-[10px] text-black/40">{(file.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    className="absolute right-1 top-1 rounded-full p-1 text-black/40 hover:bg-black/5 hover:text-black/80"
                    aria-label="Remove attachment"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isSending || models.length === 0}
              className="flex h-12 w-12 items-center justify-center rounded-xl border border-black/20 bg-white hover:bg-black/5 text-black disabled:opacity-50"
              title="Attach files"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
                className="h-5 w-5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
                />
              </svg>
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileChange}
              multiple
              className="hidden"
            />
            <input
              ref={inputRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={isSending || models.length === 0}
              className="flex-1 rounded-xl border border-black/20 bg-white px-4 py-3 text-sm h-12 disabled:opacity-50"
              placeholder={models.length === 0 ? "No active models available" : "Ask AI..."}
            />
            <button
              type="submit"
              disabled={isSending || !selectedModel || (!input.trim() && attachments.length === 0)}
              className="rounded-xl bg-amber px-4 h-12 text-sm font-semibold text-black disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </form>
      </main>
    </section>
  );
}

async function streamCompletion(
  model: string,
  messages: ChatMessage[],
  onDelta: (delta: string) => void
): Promise<ChatCompletionStats> {
  const token = getStoredToken() || undefined;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const startedAt = performance.now();

  const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages, stream: true })
  });

  if (!response.ok) {
    let detail = `Request failed: ${response.status}`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) {
        detail = payload.detail;
      }
    } catch {
      // ignore
    }
    throw new Error(detail);
  }

  if (!response.body) {
    throw new Error("Streaming response has no body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null = null;
  let resolvedModel = model;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    buffer = buffer.replace(/\r\n/g, "\n");

    let separatorIndex = buffer.indexOf("\n\n");
    while (separatorIndex !== -1) {
      const event = buffer.slice(0, separatorIndex);
      buffer = buffer.slice(separatorIndex + 2);
      separatorIndex = buffer.indexOf("\n\n");

      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) {
          continue;
        }
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") {
          continue;
        }
        try {
          const parsed = JSON.parse(data) as {
            error?: { message?: string };
            model?: string;
            choices?: { delta?: { content?: string } }[];
            usage?: {
              prompt_tokens?: number;
              completion_tokens?: number;
              total_tokens?: number;
            };
          };
          if (parsed.error?.message) {
            throw new Error(parsed.error.message);
          }
          if (parsed.model) {
            resolvedModel = parsed.model;
          }
          if (parsed.usage) {
            usage = parsed.usage;
          }
          const delta =
            (parsed.choices?.[0]?.delta as any)?.content ||
            (parsed.choices?.[0]?.delta as any)?.reasoning_content ||
            (parsed.choices?.[0]?.delta as any)?.reasoning ||
            (parsed.choices?.[0]?.delta as any)?.thought;
          if (delta) {
            onDelta(delta);
          }
        } catch (error) {
          if (error instanceof Error) {
            throw error;
          }
          // ignore malformed chunks
        }
      }
    }

    if (done) {
      break;
    }
  }

  // Process any remaining buffer content that lacked a trailing double-newline
  // (can happen when the TCP connection closes before the final \n\n is received).
  if (buffer.trim()) {
    for (const line of buffer.split("\n")) {
      if (!line.startsWith("data:")) {
        continue;
      }
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      try {
        const parsed = JSON.parse(data) as {
          error?: { message?: string };
          model?: string;
          choices?: { delta?: { content?: string } }[];
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
        if (parsed.error?.message) {
          throw new Error(parsed.error.message);
        }
        if (parsed.model) {
          resolvedModel = parsed.model;
        }
        if (parsed.usage) {
          usage = parsed.usage;
        }
        const delta =
          (parsed.choices?.[0]?.delta as any)?.content ||
          (parsed.choices?.[0]?.delta as any)?.reasoning_content ||
          (parsed.choices?.[0]?.delta as any)?.reasoning ||
          (parsed.choices?.[0]?.delta as any)?.thought;
        if (delta) {
          onDelta(delta);
        }
      } catch (error) {
        if (error instanceof Error) {
          throw error;
        }
        // ignore malformed chunks
      }
    }
  }

  const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
  const completionTokens = usage?.completion_tokens ?? null;

  return {
    model: resolvedModel,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens,
    totalTokens: usage?.total_tokens ?? null,
    tokensPerSecond: completionTokens !== null ? completionTokens / elapsedSeconds : null,
  };
}

function formatInteger(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }

  return new Intl.NumberFormat().format(value);
}

function formatRate(value: number | null): string {
  if (value === null || Number.isNaN(value)) {
    return "n/a";
  }

  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}
