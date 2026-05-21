import { FormEvent, useEffect, useState } from "react";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { UserRecord, UserUpdateResponse } from "../lib/records";

type CreateUserPayload = {
  username: string;
  email: string;
  password: string;
  is_admin: boolean;
  is_active: boolean;
};

export default function UsersPage() {
  const { token } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [newUser, setNewUser] = useState<CreateUserPayload>({ username: "", email: "", password: "", is_admin: false, is_active: true });
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    if (!token) {
      return;
    }
    void refreshUsers(token);
  }, [token]);

  async function refreshUsers(activeToken: string) {
    setIsLoading(true);
    try {
      const response = await apiGet<UserRecord[]>("/api/admin/users", activeToken);
      setUsers(response.map((user) => ({ ...user, password: "" })));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load users");
    } finally {
      setIsLoading(false);
    }
  }

  function updateUserDraft(userId: number, updates: Partial<UserRecord>) {
    setUsers((current) => current.map((user) => (user.id === userId ? { ...user, ...updates } : user)));
  }

  async function handleCreateUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) {
      return;
    }

    setIsCreatingUser(true);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const response = await apiPost<CreateUserPayload, UserUpdateResponse>("/api/admin/users", newUser, token);
      setUsers((current) => [...current, { ...response.user, password: "" }].sort((left, right) => left.username.localeCompare(right.username)));
      setNewUser({ username: "", email: "", password: "", is_admin: false, is_active: true });
      setSuccessMessage(`Created user ${response.user.username}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "User creation failed");
    } finally {
      setIsCreatingUser(false);
    }
  }

  async function handleSaveUser(user: UserRecord) {
    if (!token) {
      return;
    }

    setSavingUserId(user.id);
    setErrorMessage("");
    setSuccessMessage("");

    try {
      const payload: Record<string, string | boolean> = {
        username: user.username,
        email: user.email,
        is_admin: user.is_admin,
        is_active: user.is_active,
      };
      if (user.password && user.password.trim()) {
        payload.password = user.password;
      }

      const response = await apiPatch<Record<string, string | boolean>, UserUpdateResponse>(`/api/admin/users/${user.id}`, payload, token);
      setUsers((current) => current.map((item) => (item.id === user.id ? { ...response.user, password: "" } : item)));
      setSuccessMessage(`Saved ${response.user.username}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "User update failed");
    } finally {
      setSavingUserId(null);
    }
  }

  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl">Users</h2>
          </div>
        </div>

        {errorMessage ? <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p> : null}
        {successMessage ? <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{successMessage}</p> : null}

        <form className="mt-5 grid gap-3 rounded-2xl border border-dashed border-black/15 bg-sand/70 p-4" onSubmit={handleCreateUser}>
          <h3 className="font-display text-base">Create User</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm text-black/70">
              Username
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={newUser.username} onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm text-black/70">
              Email
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label className="grid gap-1 text-sm text-black/70">
              Password
              <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} />
            </label>
            <div className="flex flex-wrap gap-3 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-black/70 md:self-end">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={newUser.is_admin} onChange={(event) => setNewUser((current) => ({ ...current, is_admin: event.target.checked }))} />
                Admin
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={newUser.is_active} onChange={(event) => setNewUser((current) => ({ ...current, is_active: event.target.checked }))} />
                Active
              </label>
            </div>
          </div>
          <div>
            <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isCreatingUser}>
              {isCreatingUser ? "Creating..." : "Create User"}
            </button>
          </div>
        </form>

        <div className="mt-5 space-y-4">
          {users.map((user) => (
            <form
              key={user.id}
              className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                void handleSaveUser(user);
              }}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-sm text-black/70">
                  Username
                  <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={user.username} onChange={(event) => updateUserDraft(user.id, { username: event.target.value })} />
                </label>
                <label className="grid gap-1 text-sm text-black/70">
                  Email
                  <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="email" value={user.email} onChange={(event) => updateUserDraft(user.id, { email: event.target.value })} />
                </label>
                <label className="grid gap-1 text-sm text-black/70">
                  Reset Password
                  <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="password" value={user.password ?? ""} onChange={(event) => updateUserDraft(user.id, { password: event.target.value })} placeholder="Leave blank to keep current password" />
                </label>
                <div className="flex flex-wrap gap-3 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-black/70 md:self-end">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={user.is_admin} onChange={(event) => updateUserDraft(user.id, { is_admin: event.target.checked })} />
                    Admin
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={user.is_active} onChange={(event) => updateUserDraft(user.id, { is_active: event.target.checked })} />
                    Active
                  </label>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={savingUserId === user.id}>
                  {savingUserId === user.id ? "Saving..." : "Save User"}
                </button>
              </div>
            </form>
          ))}
          {users.length === 0 ? <p className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">No users created yet.</p> : null}
        </div>
      </article>
    </section>
  );
}
