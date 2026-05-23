import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { apiGet } from "../lib/api";
import type { ActivityLogRecord, LogsResponse } from "../lib/records";

const CATEGORIES = [
  { value: "", label: "All" },
  { value: "auth", label: "Auth" },
  { value: "models", label: "Models" },
  { value: "devices", label: "Devices" },
  { value: "chat", label: "Chat" },
  { value: "admin", label: "Admin" },
];

function eventTypeBadgeClass(eventType: string): string {
  if (eventType === "auth.login_failed" || eventType === "model.activation_failed") {
    return "bg-red-100 text-red-700";
  }
  if (eventType.startsWith("auth.")) return "bg-blue-100 text-blue-700";
  if (eventType.startsWith("model.")) return "bg-purple-100 text-purple-700";
  if (eventType.startsWith("device.")) return "bg-yellow-100 text-yellow-700";
  if (eventType.startsWith("chat.")) return "bg-green-100 text-green-700";
  if (eventType.startsWith("admin.")) return "bg-gray-100 text-gray-700";
  return "bg-black/5 text-black/60";
}

export default function LogsPage() {
  const { token } = useAuth();
  const [items, setItems] = useState<ActivityLogRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;
  const [category, setCategory] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("page_size", String(PAGE_SIZE));
    if (category) params.set("event_category", category);
    if (search) params.set("search", search);

    apiGet<LogsResponse>(`/api/logs?${params.toString()}`, token)
      .then((data) => {
        setItems(data.items);
        setTotal(data.total);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [token, page, category, search]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function handleCategoryChange(cat: string) {
    setCategory(cat);
    setPage(1);
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  }

  function handleClearSearch() {
    setSearchInput("");
    setSearch("");
    setPage(1);
  }

  return (
    <div className="grid gap-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-black/10 bg-white/80 p-3 shadow-sm backdrop-blur">
        <div className="flex gap-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => handleCategoryChange(cat.value)}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition ${category === cat.value ? "bg-ink text-white" : "text-black/70 hover:bg-black/5"}`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSearchSubmit} className="ml-auto flex gap-2">
          <input
            type="text"
            placeholder="Search events, users…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-52 rounded-xl border border-black/15 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ink/30"
          />
          <button
            type="submit"
            className="rounded-xl bg-ink px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-ink/80"
          >
            Search
          </button>
          {search && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="rounded-xl border border-black/15 px-3 py-1.5 text-xs font-semibold text-black/70 transition hover:bg-black/5"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-black/10 bg-white/80 shadow-sm backdrop-blur">
        {error && <p className="p-4 text-sm text-red-600">{error}</p>}
        {loading ? (
          <p className="p-6 text-center text-sm text-black/50">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-center text-sm text-black/50">No log entries found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 bg-black/5 text-left text-xs font-semibold text-black/60">
                  <th className="px-4 py-3 whitespace-nowrap">Timestamp</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-black/5 last:border-0 hover:bg-black/[0.02]">
                    <td className="px-4 py-2.5 text-xs text-black/50 whitespace-nowrap font-mono">
                      {item.created_at ? new Date(item.created_at).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block rounded px-2 py-0.5 text-xs font-mono font-semibold ${eventTypeBadgeClass(item.event_type)}`}>
                        {item.event_type}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-black/70">{item.username ?? "—"}</td>
                    <td className="px-4 py-2.5 text-xs text-black/50 font-mono whitespace-nowrap">{item.ip_address ?? "—"}</td>
                    <td className="max-w-xs truncate px-4 py-2.5 text-xs text-black/60 font-mono" title={item.details ?? undefined}>
                      {item.details ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between rounded-2xl border border-black/10 bg-white/80 px-4 py-3 shadow-sm backdrop-blur text-sm">
          <span className="text-black/50">
            {total} {total === 1 ? "entry" : "entries"} · Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-xl border border-black/15 px-3 py-1.5 text-xs font-semibold text-black/70 transition hover:bg-black/5 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-xl border border-black/15 px-3 py-1.5 text-xs font-semibold text-black/70 transition hover:bg-black/5 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
