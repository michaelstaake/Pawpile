import { FormEvent, useEffect, useRef, useState } from "react";
import { apiDelete, apiGet, apiPost, apiPostForm, handleBackendUnavailableError, isBackendUnavailableResponse } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { getStoredToken } from "../lib/session";
import MessageContent from "../components/ui/MessageContent";

type ChatRole = "system" | "user" | "assistant";

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type ChatMessageContent = string | ChatContentPart[];

type ChatMessage = {
  role: ChatRole;
  content: string;
  apiContent?: ChatMessageContent;
  thinking?: string;
  phase?: "uploading" | "thinking" | "streaming" | "complete";
  modelName?: string;
  stats?: ChatCompletionStats | null;
};

type ChatCompletionStats = {
  model: string;
  elapsedSeconds: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  tokensPerSecond: number | null;
};

type ModelListResponse = {
  object: string;
  data: { id: string; object: string; created: number; owned_by: string; vision_enabled?: boolean }[];
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
    modelName?: string | null;
    stats?: ChatCompletionStats | null;
    created_at: string | null;
  }[];
};

type ChatCreateResponse = {
  status: string;
  chat: ChatSummary;
};

type AttachmentKind = "text" | "image" | "document" | "binary";

type AttachmentExtractionResponse = {
  attachments: {
    name: string;
    contentType?: string | null;
    size: number;
    status: "ok" | "unsupported" | "error";
    content?: string | null;
    detail?: string | null;
    truncated: boolean;
    extractor?: string | null;
  }[];
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

type Attachment = {
  name: string;
  size: number;
  type: string;
  kind: AttachmentKind;
  sourceFile: File;
  content?: string;
  dataUrl?: string;
  extractionStatus?: "pending" | "ready" | "unsupported" | "error";
  extractionDetail?: string;
  truncated?: boolean;
};

const TEXT_ATTACHMENT_SUFFIXES = new Set([
  ".conf",
  ".css",
  ".csv",
  ".html",
  ".ini",
  ".js",
  ".json",
  ".log",
  ".md",
  ".py",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const DOCUMENT_ATTACHMENT_SUFFIXES = new Set([".docx", ".ods", ".odt", ".pdf", ".xlsx"]);

const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 48;
const MODEL_STATUS_GRADIENT = "linear-gradient(135deg,#770088 0%,#004CFF 20%,#028121 40%,#FFEE00 60%,#FF8D00 80%,#E50000 100%)";

function hasKnownSuffix(name: string, suffixes: Set<string>): boolean {
  const lowerName = name.toLowerCase();
  for (const suffix of suffixes) {
    if (lowerName.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

function isTextAttachment(file: File): boolean {
  if (file.type.startsWith("text/")) {
    return true;
  }

  return hasKnownSuffix(file.name, TEXT_ATTACHMENT_SUFFIXES);
}

function isBackendExtractableAttachment(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.type === "application/vnd.oasis.opendocument.spreadsheet" ||
    file.type === "application/vnd.oasis.opendocument.text" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    hasKnownSuffix(file.name, DOCUMENT_ATTACHMENT_SUFFIXES)
  );
}

function classifyAttachment(file: File): AttachmentKind {
  if (isTextAttachment(file)) {
    return "text";
  }

  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (isBackendExtractableAttachment(file)) {
    return "document";
  }

  return "binary";
}

async function resolveDocumentAttachments(attachments: Attachment[], token?: string): Promise<Attachment[]> {
  const pendingDocuments = attachments.filter((attachment) => attachment.kind === "document" && !attachment.content);
  if (pendingDocuments.length === 0) {
    return attachments;
  }

  const formData = new FormData();
  pendingDocuments.forEach((attachment) => {
    formData.append("files", attachment.sourceFile);
  });

  const response = await apiPostForm<AttachmentExtractionResponse>("/api/chat/attachments/extract", formData, token);
  if (response.attachments.length !== pendingDocuments.length) {
    throw new Error("Attachment extraction returned an unexpected number of results.");
  }

  let responseIndex = 0;
  return attachments.map((attachment) => {
    if (attachment.kind !== "document" || attachment.content) {
      return attachment;
    }

    const result = response.attachments[responseIndex++];
    const extractionDetail = result.detail ?? undefined;

    if (result.status === "ok" && result.content) {
      return {
        ...attachment,
        type: result.contentType ?? attachment.type,
        content: result.content,
        extractionStatus: "ready",
        extractionDetail,
        truncated: result.truncated,
      };
    }

    return {
      ...attachment,
      extractionStatus: result.status === "unsupported" ? "unsupported" : "error",
      extractionDetail,
      truncated: false,
    };
  });
}

function formatAttachmentFallbackText(file: Attachment): string {
  const sizeLabel = formatAttachmentSize(file.size);

  if (file.extractionStatus === "unsupported") {
    return `[Attached File: ${file.name} (${file.extractionDetail ?? "Unsupported for text extraction"}, ${sizeLabel})]`;
  }

  if (file.extractionStatus === "error") {
    return `[Attached File: ${file.name} (${file.extractionDetail ?? "Text extraction failed"}, ${sizeLabel})]`;
  }

  return `[Attached File: ${file.name} (Binary File, ${sizeLabel})]`;
}

function formatAttachmentLabel(file: Attachment): string {
  const sizeLabel = formatAttachmentSize(file.size);
  return `[Attached File: ${file.name} (${sizeLabel})]`;
}

function formatAttachmentSize(size: number): string {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(size / 1024).toFixed(1)} KB`;
}

function describeAttachment(file: Attachment): string {
  if (file.kind === "image") {
    return "Image attachment";
  }

  if (file.kind === "text") {
    return "Text ready";
  }

  if (file.kind === "document") {
    if (file.extractionStatus === "ready") {
      return file.truncated ? "Text extracted, truncated" : "Text extracted";
    }
    if (file.extractionStatus === "error") {
      return "Extraction failed";
    }
    return "Text will be extracted on send";
  }

  return "Metadata only";
}

export default function ChatPage() {
  const { token, user } = useAuth();
  const [models, setModels] = useState<string[]>([]);
  const [modelVisionDefaults, setModelVisionDefaults] = useState<Record<string, boolean>>({});
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [thinkingExpandedByIndex, setThinkingExpandedByIndex] = useState<Record<number, boolean>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [savedChats, setSavedChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<number | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const selectedModelSupportsVision = selectedModel ? (modelVisionDefaults[selectedModel] ?? false) : false;
  const shouldShowTranscript = activeChatId !== null || messages.length > 0;
  const isNewChatEmptyState = activeChatId === null && messages.length === 0;
  const shouldShowNoModelsEmptyState = isNewChatEmptyState && !isLoadingModels && models.length === 0;

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
    if (shouldAutoScrollRef.current && transcriptRef.current) {
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
      const visionDefaults: Record<string, boolean> = {};
      for (const entry of response.data) {
        visionDefaults[entry.id] = entry.vision_enabled ?? false;
      }
      setModelVisionDefaults(visionDefaults);
      setModels(aliases);
      setSelectedModel((current: string) => current || aliases[0] || "");
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

  function isNearTranscriptBottom(element: HTMLDivElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  }

  function enableTranscriptAutoScroll() {
    shouldAutoScrollRef.current = true;
  }

  function handleTranscriptScroll() {
    const element = transcriptRef.current;
    if (!element) {
      return;
    }

    shouldAutoScrollRef.current = isNearTranscriptBottom(element);
  }

  function startNewChat() {
    enableTranscriptAutoScroll();
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
      enableTranscriptAutoScroll();
      setActiveChatId(detail.chat.id);
      setMessages(
        detail.messages.map((message) => ({
          role: message.role,
          content: message.content,
          modelName: message.modelName ?? undefined,
          stats: message.stats ?? null,
          phase: "complete",
        }))
      );
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

  async function persistMessage(
    chatId: number,
    role: ChatRole,
    content: string,
    options?: { modelName?: string; stats?: ChatCompletionStats | null }
  ): Promise<void> {
    if (!token || !content) {
      return;
    }
    try {
      await apiPost(
        `/api/chat/${chatId}/messages`,
        {
          role,
          content,
          ...(options?.modelName ? { modelName: options.modelName } : {}),
          ...(options?.stats ? { stats: options.stats } : {}),
        },
        token
      );
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
      const attachmentKind = classifyAttachment(file);

      if (attachmentKind === "text") {
        const reader = new FileReader();
        reader.onload = (event) => {
          setAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              size: file.size,
              type: file.type,
              kind: attachmentKind,
              sourceFile: file,
              content: event.target?.result as string,
              extractionStatus: "ready",
            },
          ]);
        };
        reader.readAsText(file);
      } else if (attachmentKind === "image") {
        const reader = new FileReader();
        reader.onload = (event) => {
          setAttachments((prev) => [
            ...prev,
            {
              name: file.name,
              size: file.size,
              type: file.type,
              kind: attachmentKind,
              sourceFile: file,
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
            kind: attachmentKind,
            sourceFile: file,
            extractionStatus: attachmentKind === "document" ? "pending" : "unsupported",
            extractionDetail:
              attachmentKind === "document"
                ? "Text will be extracted when you send this message."
                : "This file will be sent as metadata only.",
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

    if (attachments.some((file) => file.type.startsWith("image/") && file.dataUrl) && !selectedModelSupportsVision) {
      setErrorMessage("Vision is disabled for the selected model. Enable vision in the model settings or switch to a vision-enabled model before sending images.");
      return;
    }

    setIsSending(true);
    setErrorMessage("");

    let preparedAttachments: Attachment[];
    try {
      preparedAttachments = await resolveDocumentAttachments(attachments, token ?? undefined);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to extract attachment text");
      setIsSending(false);
      return;
    }

    const { displayContent, apiContent } = buildUserMessageContent(trimmed, preparedAttachments);

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: "user", content: displayContent, apiContent, phase: "complete" },
    ];
    const hasUploadStage = preparedAttachments.length > 0;
    enableTranscriptAutoScroll();
    setMessages([
      ...nextMessages,
      { role: "assistant", content: "", phase: hasUploadStage ? "uploading" : "thinking", modelName: selectedModel, stats: null },
    ]);
    setInput("");
    setAttachments([]);

    const chatId = await ensureChat(trimmed ? trimmed : "Sent attachments");
    if (chatId !== null) {
      void persistMessage(chatId, "user", displayContent);
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let assistantBuffer = "";
    let thinkingBuffer = "";
    try {
      const stats = await streamCompletion(
        selectedModel,
        nextMessages.map((message) => ({ role: message.role, content: message.apiContent ?? message.content })),
        abortController.signal,
        (phase) => {
          setMessages((current) => {
            if (current.length === 0) {
              return current;
            }
            const updated = [...current];
            const last = updated[updated.length - 1];
            if (last.role !== "assistant" || last.phase === "streaming" || last.phase === "complete") {
              return current;
            }
            updated[updated.length - 1] = { ...last, phase };
            return updated;
          });
        },
        (delta, type) => {
        if (type === "thinking") {
          thinkingBuffer += delta;
          setMessages((current) => {
            if (current.length === 0) return current;
            const updated = [...current];
            const last = updated[updated.length - 1];
            updated[updated.length - 1] = { ...last, thinking: (last.thinking ?? "") + delta, phase: "streaming" };
            return updated;
          });
          setThinkingExpandedByIndex((current) => ({ ...current, [nextMessages.length]: true }));
        } else {
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
          thinking: thinkingBuffer || last.thinking,
          content: assistantBuffer,
          modelName: last.modelName || stats.model,
          phase: "complete",
          stats,
        };
        return updated;
      });
      setThinkingExpandedByIndex((current) => ({ ...current, [nextMessages.length]: false }));
      if (chatId !== null && assistantBuffer) {
        void persistMessage(chatId, "assistant", assistantBuffer, {
          modelName: stats.model,
          stats,
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        setMessages((current) => {
          if (current.length === 0) return current;
          const last = current[current.length - 1];
          if (last.role === "assistant") {
            if (!last.content && !last.thinking) return current.slice(0, -1);
            const updated = [...current];
            updated[updated.length - 1] = { ...last, phase: "complete" };
            return updated;
          }
          return current;
        });
        if (chatId !== null && assistantBuffer) {
          void persistMessage(chatId, "assistant", assistantBuffer, {
            modelName: selectedModel,
          });
        }
      } else {
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
      }
    } finally {
      abortControllerRef.current = null;
      setIsSending(false);
    }
  }

  return (
    <section className={`grid gap-4 ${isSidebarOpen ? "md:grid-cols-[280px_1fr]" : "grid-cols-[72px_1fr]"}`}>
      <aside
        className={`rounded-2xl border border-black/10 bg-white/80 shadow-sm transition-all ${
          isSidebarOpen ? "p-4" : "p-3"
        }`}
      >
        {isSidebarOpen ? (
          <>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={startNewChat}
                className="flex-1 rounded-xl bg-ink px-4 py-2 text-left text-sm font-semibold text-white transition hover:bg-black"
              >
                <span className="inline-flex items-center gap-2">
                  <i className="bi bi-pencil-square text-[16px] leading-none" aria-hidden="true" />
                  <span>New Chat</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setIsSidebarOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-black/10 bg-white text-black/60 transition hover:border-black/20 hover:bg-black/5 hover:text-black"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
              >
                <i className="bi bi-layout-sidebar-inset-reverse text-[16px] leading-none" aria-hidden="true" />
              </button>
            </div>
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
          </>
        ) : (
          <div className="flex h-full flex-col items-center gap-2">
            <button
              type="button"
              onClick={startNewChat}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink text-white transition hover:bg-black"
              aria-label="Start a new chat"
              title="New chat"
            >
              <i className="bi bi-pencil-square text-[18px] leading-none" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setIsSidebarOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-xl border border-black/10 bg-white text-black/60 transition hover:border-black/20 hover:bg-black/5 hover:text-black"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <i className="bi bi-layout-sidebar-inset text-[18px] leading-none" aria-hidden="true" />
            </button>
          </div>
        )}
      </aside>
      <main className={`rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm ${isNewChatEmptyState ? "flex min-h-[68vh] flex-col justify-center" : ""}`}>
        {!isNewChatEmptyState ? (
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-lg">Chat</h2>
            </div>
            <div className="flex items-center gap-2">
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
          </div>
        ) : null}

        {errorMessage && (
          <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {errorMessage}
          </div>
        )}

        {!shouldShowNoModelsEmptyState && !isLoadingModels && models.length === 0 && (
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

        {shouldShowNoModelsEmptyState ? (
          <div className="mx-auto w-full max-w-2xl rounded-[28px] bg-white/40 px-8 py-10 text-center">
            <i
              className="bi bi-emoji-frown bg-clip-text text-[72px] leading-none text-transparent"
              style={{ backgroundImage: MODEL_STATUS_GRADIENT }}
              aria-hidden="true"
            />
            <div className="mt-6 text-xl font-semibold text-ink md:text-2xl">No active models</div>
            <div className="mt-3 text-sm leading-7 text-black/68 md:text-[15px]">
              {user?.is_admin ? (
                <>
                  No models are active yet. Open the <a className="font-semibold underline" href="/models">Models</a> page to get started.
                </>
              ) : (
                "No models are active. Contact your system administrator for assistance."
              )}
            </div>
          </div>
        ) : isNewChatEmptyState ? (
          <div className="mx-auto mb-6 w-full max-w-xl">
            <select
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
              disabled={isLoadingModels || models.length === 0}
              className="h-12 w-full rounded-xl border border-black/15 bg-white px-4 text-sm shadow-sm"
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
        ) : shouldShowTranscript ? (
          <div
            ref={transcriptRef}
            onScroll={handleTranscriptScroll}
            className="min-h-[360px] max-h-[55vh] overflow-y-auto rounded-xl border border-dashed border-black/20 bg-sand p-4 text-sm text-black/80"
          >
            {messages.length === 0 ? (
              <div className="text-black/50">Nothing to see here yet.</div>
            ) : (
              <div className="space-y-3">
                {messages.map((message, index) => (
                message.role === "assistant" && (message.phase === "uploading" || message.phase === "thinking") && !message.content && !message.thinking ? (
                  <div key={index} className="px-1 py-1 text-sm font-medium text-black/45">
                    <span className="inline-flex items-center gap-2">
                      <span className="animate-pulse">{message.phase === "uploading" ? "Uploading..." : "Processing..."}</span>
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
                      {formatSpeakerLabel(message, user?.username ?? null)}
                    </div>
                    {message.role === "assistant" && message.thinking ? (
                      <div className="mb-3">
                        <button
                          type="button"
                          onClick={() => setThinkingExpandedByIndex((current) => ({ ...current, [index]: !current[index] }))}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-medium text-black/40 hover:bg-black/5"
                        >
                          <span className="flex-1">
                            {message.phase === "streaming" || message.phase === "thinking" ? (
                              <span className="animate-pulse">Thinking...</span>
                            ) : (
                              "Thought"
                            )}
                          </span>
                          <i
                            className={`bi bi-chevron-down shrink-0 text-[14px] leading-none transition-transform ${thinkingExpandedByIndex[index] ? "rotate-180" : ""}`}
                            aria-hidden="true"
                          />
                        </button>
                        {thinkingExpandedByIndex[index] ? (
                          <div className="ml-2 mt-1 border-l-2 border-dashed border-amber-300/60 pl-3">
                            <div className="whitespace-pre-wrap text-[13px] leading-6 text-black/40 italic">
                              {message.thinking}
                              {(message.phase === "streaming" || message.phase === "thinking") && !message.content ? (
                                <span className="ml-1 inline-block h-4 w-1.5 animate-pulse rounded-full bg-amber/50 align-middle" />
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="leading-7 text-[15px] text-black/85">
                      {message.role === "assistant" ? (
                        <MessageContent
                          content={message.content}
                          showStreamingCursor={message.phase === "streaming" && Boolean(message.content)}
                        />
                      ) : (
                        <span className="whitespace-pre-wrap">{message.content}</span>
                      )}
                    </div>
                    {message.role === "assistant" && message.phase === "complete" && message.stats ? (
                      <div className="mt-3 border-t border-black/8 pt-2 text-[11px] text-black/45">
                        <span
                          title={
                            message.stats.completionTokens !== null && message.stats.totalTokens !== null
                              ? `${formatInteger(message.stats.totalTokens)} total tokens`
                              : undefined
                          }
                        >
                          {formatInteger(message.stats.completionTokens ?? message.stats.totalTokens)}t
                        </span>
                        <span className="mx-2 text-black/20">/</span>
                        <span>{formatDuration(message.stats.elapsedSeconds)}</span>
                        <span className="mx-2 text-black/20">/</span>
                        <span className="font-medium text-black/55">{formatRate(message.stats.tokensPerSecond)}t/s</span>
                      </div>
                    ) : null}
                  </div>
                )
                ))}
              </div>
            )}
          </div>
        ) : null}

        {!shouldShowNoModelsEmptyState ? (
          <form className={`${isNewChatEmptyState ? "mx-auto w-full max-w-xl" : "mt-4"} flex flex-col gap-2`} onSubmit={handleSubmit}>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 rounded-xl border border-black/10 bg-black/5 p-2">
              {attachments.map((file, idx) => (
                <div key={idx} className="relative flex items-center gap-2 rounded-lg bg-white p-2 shadow-sm pr-8 text-xs font-semibold text-black/70">
                  {file.kind === "image" && file.dataUrl ? (
                    <img src={file.dataUrl} alt={file.name} className="h-8 w-8 rounded object-cover" />
                  ) : (
                    <span className="text-xl">📄</span>
                  )}
                  <div className="truncate max-w-[150px]">
                    <div className="truncate">{file.name}</div>
                    <div className="text-[10px] text-black/40" title={file.extractionDetail || undefined}>
                      {(file.size / 1024).toFixed(1)} KB • {describeAttachment(file)}
                    </div>
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
              <i className="bi bi-paperclip text-[20px] leading-none" aria-hidden="true" />
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
            {isSending ? (
              <button
                type="button"
                onClick={() => abortControllerRef.current?.abort()}
                className="rounded-xl bg-red-500 px-4 h-12 text-sm font-semibold text-white hover:bg-red-600"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!selectedModel || (!input.trim() && attachments.length === 0)}
                className="rounded-xl bg-amber px-4 h-12 text-sm font-semibold text-black disabled:opacity-50"
              >
                Send
              </button>
            )}
          </div>
          </form>
        ) : null}
      </main>
    </section>
  );
}

async function streamCompletion(
  model: string,
  messages: { role: ChatRole; content: ChatMessageContent }[],
  signal: AbortSignal,
  onStageChange: (phase: "thinking") => void,
  onDelta: (delta: string, type: "thinking" | "content") => void
): Promise<ChatCompletionStats> {
  const token = getStoredToken() || undefined;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const startedAt = performance.now();

  let response: Response;

  try {
    response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify({ model, messages, stream: true })
    });
  } catch (error) {
    handleBackendUnavailableError(error);
  }

  if (isBackendUnavailableResponse(response.status)) {
    handleBackendUnavailableError(new TypeError("Backend unavailable"));
  }

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

  onStageChange("thinking");

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
  while (true) {
    if (signal.aborted) {
      await reader.cancel();
      throw new DOMException("Aborted", "AbortError");
    }
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
          if (parsed.usage) {
            usage = parsed.usage;
          }
          const deltaContent = (parsed.choices?.[0]?.delta as any)?.content;
          const deltaThinking =
            (parsed.choices?.[0]?.delta as any)?.reasoning_content ||
            (parsed.choices?.[0]?.delta as any)?.reasoning ||
            (parsed.choices?.[0]?.delta as any)?.thought;
          if (deltaThinking) {
            onDelta(deltaThinking, "thinking");
          } else if (deltaContent) {
            onDelta(deltaContent, "content");
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
        if (parsed.usage) {
          usage = parsed.usage;
        }
        const deltaContent = (parsed.choices?.[0]?.delta as any)?.content;
        const deltaThinking =
          (parsed.choices?.[0]?.delta as any)?.reasoning_content ||
          (parsed.choices?.[0]?.delta as any)?.reasoning ||
          (parsed.choices?.[0]?.delta as any)?.thought;
        if (deltaThinking) {
          onDelta(deltaThinking, "thinking");
        } else if (deltaContent) {
          onDelta(deltaContent, "content");
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
    model,
    elapsedSeconds,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens,
    totalTokens: usage?.total_tokens ?? null,
    tokensPerSecond: completionTokens !== null ? completionTokens / elapsedSeconds : null,
  };
}

function buildUserMessageContent(inputText: string, attachments: Attachment[]): { displayContent: string; apiContent: ChatMessageContent } {
  if (attachments.length === 0) {
    return { displayContent: inputText, apiContent: inputText };
  }

  const displaySegments: string[] = [];
  const contentParts: ChatContentPart[] = [];
  const introText = inputText || "Analyze the attached file(s).";

  displaySegments.push(introText);
  contentParts.push({ type: "text", text: introText });

  for (const file of attachments) {
    if (file.content) {
      const displayAttachmentText = formatAttachmentLabel(file);
      const attachmentText = `${displayAttachmentText}\n\`\`\`\n${file.content}\n\`\`\``;
      displaySegments.push(displayAttachmentText);
      contentParts.push({ type: "text", text: attachmentText });
      continue;
    }

    if (file.type.startsWith("image/") && file.dataUrl) {
      displaySegments.push(`[Attached Image: ${file.name} (${formatAttachmentSize(file.size)})]`);
      contentParts.push({ type: "image_url", image_url: { url: file.dataUrl } });
      continue;
    }

    const fallbackText = formatAttachmentFallbackText(file);
    displaySegments.push(fallbackText);
    contentParts.push({ type: "text", text: fallbackText });
  }

  const containsImage = attachments.some((file) => file.kind === "image" && file.dataUrl);
  const containsHiddenAttachmentContent = attachments.some((file) => Boolean(file.content));
  return {
    displayContent: displaySegments.join("\n\n"),
    apiContent: containsImage || containsHiddenAttachmentContent ? contentParts : displaySegments.join("\n\n"),
  };
}

function formatSpeakerLabel(message: ChatMessage, username: string | null): string {
  if (message.role === "user") {
    return username || "User";
  }

  if (message.role === "assistant") {
    return message.modelName || message.stats?.model || "Assistant";
  }

  return message.role;
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

function formatDuration(value: number): string {
  if (Number.isNaN(value) || value < 0) {
    return "n/a";
  }

  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}s`;
}
