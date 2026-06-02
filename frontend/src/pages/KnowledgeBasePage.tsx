import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  createKbDocument,
  deleteKbDocument,
  fetchKbDocuments,
  updateKbDocument,
} from "../lib/api";
import type { KnowledgeBaseDocumentRecord } from "../lib/records";

const MAX_CONTENT_LENGTH = 10240; // 10 KB

type DraftMode = "idle" | "creating" | "editing";

export default function KnowledgeBasePage() {
  const { token } = useAuth();
  const { showError, showSuccess } = useToast();
  const [documents, setDocuments] = useState<KnowledgeBaseDocumentRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [draftMode, setDraftMode] = useState<DraftMode>("idle");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<number | null>(null);
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (!token || hasLoaded.current) return;
    hasLoaded.current = true;
    void loadDocuments(token);
  }, [token]);

  async function loadDocuments(activeToken: string) {
    setIsLoading(true);
    try {
      const docs = await fetchKbDocuments<KnowledgeBaseDocumentRecord[]>(activeToken);
      setDocuments(docs);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to load knowledge base documents");
    } finally {
      setIsLoading(false);
    }
  }

  function startCreate() {
    setDraftMode("creating");
    setDraftTitle("");
    setDraftContent("");
    setEditingId(null);
  }

  function startEdit(doc: KnowledgeBaseDocumentRecord) {
    setDraftMode("editing");
    setDraftTitle(doc.title);
    setDraftContent(doc.content);
    setEditingId(doc.id);
  }

  function cancelDraft() {
    setDraftMode("idle");
    setDraftTitle("");
    setDraftContent("");
    setEditingId(null);
  }

  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!token || !draftTitle.trim()) return;

    setIsSaving(true);
    try {
      const payload = { title: draftTitle.trim(), content: draftContent };
      if (draftMode === "creating") {
        await createKbDocument(payload, token);
        showSuccess("Document created.");
      } else if (editingId !== null) {
        await updateKbDocument(editingId, payload, token);
        showSuccess("Document updated.");
      }
      setDraftMode("idle");
      setDraftTitle("");
      setDraftContent("");
      setEditingId(null);
      if (token) await loadDocuments(token);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to save document");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(docId: number) {
    if (!token) return;
    if (!window.confirm("Delete this document? This cannot be undone.")) return;

    setIsDeleting(docId);
    try {
      await deleteKbDocument(docId, token);
      showSuccess("Document deleted.");
      if (editingId === docId) cancelDraft();
      await loadDocuments(token);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to delete document");
    } finally {
      setIsDeleting(null);
    }
  }

  const contentPreview = (content: string, maxLength: number = 150): string => {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + "...";
  };

  return (
    <div className="grid gap-4">
      {/* Draft form */}
      {(draftMode === "creating" || draftMode === "editing") && (
        <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
          <form onSubmit={saveDraft}>
            <h2 className="mb-3 font-display text-lg">{draftMode === "creating" ? "Add Document" : "Edit Document"}</h2>
            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-black/70">Title</label>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                  placeholder="Document title"
                  autoFocus
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-black/70">Content (Markdown)</label>
                <textarea
                  value={draftContent}
                  onChange={(e) => setDraftContent(e.target.value)}
                  className="h-48 w-full resize-y rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                  placeholder="Write your markdown content here..."
                  maxLength={MAX_CONTENT_LENGTH}
                />
                <p className="mt-1 text-xs text-black/45">{draftContent.length} / {MAX_CONTENT_LENGTH} characters</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={isSaving || !draftTitle.trim()}
                  className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/90 disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : draftMode === "creating" ? "Create" : "Update"}
                </button>
                <button
                  type="button"
                  onClick={cancelDraft}
                  className="rounded-xl border border-black/15 px-4 py-2 text-sm font-semibold text-black/70 transition hover:bg-black/5"
                >
                  Cancel
                </button>
              </div>
            </div>
          </form>
        </article>
      )}

      {/* Document list */}
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg">Documents</h2>
          {draftMode === "idle" && (
            <button
              type="button"
              onClick={startCreate}
              className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/90"
            >
              + Add Document
            </button>
          )}
        </div>

        {isLoading ? (
          <p className="py-8 text-center text-sm text-black/45">Loading...</p>
        ) : documents.length === 0 ? (
          <p className="py-8 text-center text-sm text-black/45">
            No documents yet. Click "Add Document" to create your first knowledge base entry.
          </p>
        ) : (
          <div className="grid gap-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="rounded-xl border border-black/10 bg-white/60 p-4 transition hover:bg-black/5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <h3 className="font-semibold text-black/80">{doc.title}</h3>
                    <p className="mt-1 text-sm text-black/60">
                      {contentPreview(doc.content)}
                    </p>
                    <p className="mt-1 text-xs text-black/40">
                      Updated: {doc.updated_at ? new Date(doc.updated_at).toLocaleDateString() : "N/A"}
                    </p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEdit(doc)}
                      className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium text-black/70 transition hover:bg-black/5"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(doc.id)}
                      disabled={isDeleting === doc.id}
                      className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                    >
                      {isDeleting === doc.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
}
