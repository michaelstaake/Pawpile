import { useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import Modal from "../components/ui/Modal";
import MarkdownRenderer from "../components/ui/MarkdownRenderer";
import {
  createKbDocument,
  deleteKbDocument,
  fetchKbDocuments,
  updateKbDocument,
  fetchKbCategories,
  createKbCategory,
  updateKbCategory,
  deleteKbCategory,
} from "../lib/api";
import type { KnowledgeBaseDocumentRecord, KnowledgeBaseCategoryRecord } from "../lib/records";

const MAX_CONTENT_LENGTH = 10240;

type DraftMode = "idle" | "creating" | "editing";

export default function KnowledgeBasePage() {
  const { token } = useAuth();
  const { showError, showSuccess } = useToast();
  const [documents, setDocuments] = useState<KnowledgeBaseDocumentRecord[]>([]);
  const [categories, setCategories] = useState<KnowledgeBaseCategoryRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [draftMode, setDraftMode] = useState<DraftMode>("idle");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [draftCategoryId, setDraftCategoryId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isCategoryCreateModalOpen, setIsCategoryCreateModalOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [isDeletingCategory, setIsDeletingCategory] = useState<number | null>(null);
  const hasLoaded = useRef(false);

  useEffect(() => {
    if (!token || hasLoaded.current) return;
    hasLoaded.current = true;
    void loadAll(token);
  }, [token]);

  async function loadAll(activeToken: string) {
    setIsLoading(true);
    try {
      const [docs, cats] = await Promise.all([
        fetchKbDocuments<KnowledgeBaseDocumentRecord[]>(activeToken, selectedCategoryId ?? undefined),
        fetchKbCategories<KnowledgeBaseCategoryRecord[]>(activeToken),
      ]);
      setDocuments(docs);
      setCategories(cats);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to load knowledge base data");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadDocuments(activeToken: string) {
    try {
      const docs = await fetchKbDocuments<KnowledgeBaseDocumentRecord[]>(activeToken, selectedCategoryId ?? undefined);
      setDocuments(docs);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to load documents");
    }
  }

  async function loadCategories(activeToken: string) {
    try {
      const cats = await fetchKbCategories<KnowledgeBaseCategoryRecord[]>(activeToken);
      setCategories(cats);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to load categories");
    }
  }

  function startCreate() {
    const defaultCat = categories.find((c) => c.is_default);
    setDraftMode("creating");
    setDraftTitle("");
    setDraftContent("");
    setDraftCategoryId(defaultCat ? defaultCat.id : null);
    setEditingId(null);
  }

  function startEdit(doc: KnowledgeBaseDocumentRecord) {
    setDraftMode("editing");
    setDraftTitle(doc.title);
    setDraftContent(doc.content);
    setDraftCategoryId(doc.category_id);
    setEditingId(doc.id);
  }

  function cancelDraft() {
    setDraftMode("idle");
    setDraftTitle("");
    setDraftContent("");
    setDraftCategoryId(null);
    setEditingId(null);
    setShowPreview(false);
  }

  async function saveDraft(e: FormEvent) {
    e.preventDefault();
    if (!token || !draftTitle.trim()) return;

    setIsSaving(true);
    try {
      const payload: Record<string, unknown> = { title: draftTitle.trim(), content: draftContent };
      if (draftCategoryId !== null) {
        payload.category_id = draftCategoryId;
      }
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
      setDraftCategoryId(null);
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

  const openEditCategory = (cat: KnowledgeBaseCategoryRecord) => {
    setEditingCategoryId(cat.id);
    setCategoryName(cat.name);
    setIsCategoryModalOpen(true);
  };

  const openCreateCategory = () => {
    setEditingCategoryId(null);
    setCategoryName("");
    setIsCategoryCreateModalOpen(true);
  };

  async function handleSaveCategory(e: FormEvent) {
    e.preventDefault();
    if (!token || !categoryName.trim()) return;

    try {
      if (editingCategoryId !== null) {
        await updateKbCategory(editingCategoryId, { name: categoryName.trim() }, token);
        showSuccess("Category updated.");
      } else {
        await createKbCategory({ name: categoryName.trim() }, token);
        showSuccess("Category created.");
      }
      setIsCategoryModalOpen(false);
      setIsCategoryCreateModalOpen(false);
      setCategoryName("");
      setEditingCategoryId(null);
      if (token) await loadCategories(token);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to save category");
    }
  }

  async function handleDeleteCategory(catId: number) {
    if (!token) return;
    if (!window.confirm("Delete this category? Documents in this category will become uncategorized.")) return;

    setIsDeletingCategory(catId);
    try {
      await deleteKbCategory(catId, token);
      showSuccess("Category deleted.");
      if (selectedCategoryId === catId) {
        setSelectedCategoryId(null);
      }
      if (token) await loadAll(token);
    } catch (error) {
      showError(error instanceof Error ? error.message : "Failed to delete category");
    } finally {
      setIsDeletingCategory(null);
    }
  }

  const contentPreview = (content: string, maxLength: number = 150): string => {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + "...";
  };

  const getCategoryName = (catId: number | null): string | null => {
    if (catId === null) return null;
    return categories.find((c) => c.id === catId)?.name ?? null;
  };

  return (
    <div className="grid gap-4">
      {/* Category management section */}
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg">Categories</h2>
          <button
            type="button"
            onClick={openCreateCategory}
            className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-ink/90"
          >
            + Add Category
          </button>
        </div>

        {categories.length === 0 ? (
          <p className="py-6 text-center text-sm text-black/45">
            No categories yet. Create one to organize your documents.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((cat) => (
              <div
                key={cat.id}
                className={`rounded-xl border p-3 transition ${
                  selectedCategoryId === cat.id
                    ? "border-ink bg-ink/5"
                    : "border-black/10 bg-white/60 hover:bg-black/5"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedCategoryId(selectedCategoryId === cat.id ? null : cat.id)}
                    className="flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-black/80">{cat.name}</span>
                      {cat.is_default && (
                        <span className="rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-medium text-black/50">Default</span>
                      )}
                    </div>
                    {selectedCategoryId === cat.id && (
                      <p className="mt-0.5 text-xs text-black/50">Click to show all documents</p>
                    )}
                  </button>
                  {!cat.is_default && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditCategory(cat)}
                        className="rounded-lg border border-black/15 px-2 py-1 text-[11px] font-medium text-black/60 transition hover:bg-black/5"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategory(cat.id)}
                        disabled={isDeletingCategory === cat.id}
                        className="rounded-lg border border-red-200 px-2 py-1 text-[11px] font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                      >
                        {isDeletingCategory === cat.id ? "..." : "Delete"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </article>

      {/* Draft form */}
      {(draftMode === "creating" || draftMode === "editing") && (
        <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
          <form onSubmit={saveDraft}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg">{draftMode === "creating" ? "Add Document" : "Edit Document"}</h2>
              {draftContent && (
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium text-black/70 transition hover:bg-black/5"
                >
                  <i className={`bi bi-${showPreview ? "code-slash" : "eye"} text-[14px] leading-none`}></i>
                  {showPreview ? "Edit" : "Preview"}
                </button>
              )}
            </div>
            <div className="grid gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-black/70">Category</label>
                <select
                  value={draftCategoryId ?? ""}
                  onChange={(e) => setDraftCategoryId(e.target.value ? Number(e.target.value) : null)}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                >
                  <option value="">No category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}{cat.is_default ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
              </div>
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
              {showPreview ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-black/70">Preview</label>
                  <div className="markdown-content min-h-[200px] max-h-[400px] overflow-y-auto rounded-xl border border-black/15 bg-white p-4 text-sm">
                    <MarkdownRenderer content={draftContent} />
                  </div>
                </div>
              ) : (
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
              )}
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
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-black/80">{doc.title}</h3>
                      {getCategoryName(doc.category_id) && (
                        <span className="rounded-full bg-black/10 px-2 py-0.5 text-[11px] font-medium text-black/60">
                          {getCategoryName(doc.category_id)}
                        </span>
                      )}
                    </div>
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

      {/* Edit category modal */}
      <Modal open={isCategoryModalOpen} onClose={() => setIsCategoryModalOpen(false)} labelledBy="category-edit-title" panelClassName="max-w-md">
        <article className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="category-edit-title" className="font-display text-2xl">Edit Category</h2>
            </div>
            <button className="rounded-xl border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-black" type="button" onClick={() => setIsCategoryModalOpen(false)}>
              Close
            </button>
          </div>
          <form className="mt-5 grid gap-3" onSubmit={handleSaveCategory}>
            <label className="grid gap-1 text-sm text-black/70">
              Category Name
              <input
                className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                autoFocus
                required
              />
            </label>
            <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={!categoryName.trim()}>
              Update Category
            </button>
          </form>
        </article>
      </Modal>

      {/* Create category modal */}
      <Modal open={isCategoryCreateModalOpen} onClose={() => setIsCategoryCreateModalOpen(false)} labelledBy="category-create-title" panelClassName="max-w-md">
        <article className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="category-create-title" className="font-display text-2xl">Add Category</h2>
            </div>
            <button className="rounded-xl border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-black" type="button" onClick={() => setIsCategoryCreateModalOpen(false)}>
              Close
            </button>
          </div>
          <form className="mt-5 grid gap-3" onSubmit={handleSaveCategory}>
            <label className="grid gap-1 text-sm text-black/70">
              Category Name
              <input
                className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm"
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                autoFocus
                required
              />
            </label>
            <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={!categoryName.trim()}>
              Create Category
            </button>
          </form>
        </article>
      </Modal>
    </div>
  );
}
