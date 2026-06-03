import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Modal from "../components/ui/Modal";
import { apiGet, apiPatch, apiPost } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { UserRecord, UserUpdateResponse } from "../lib/records";

type CreateUserPayload = {
  username: string;
  email: string;
  password: string;
  is_admin: boolean;
  is_active: boolean;
};

export default function UsersPage() {
  const { token, user: currentUser } = useAuth();
  const { showError, showSuccess } = useToast();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [newUser, setNewUser] = useState<CreateUserPayload>({ username: "", email: "", password: "", is_admin: false, is_active: true });
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [savingUserId, setSavingUserId] = useState<number | null>(null);
  const [isGeneratingPassword, setIsGeneratingPassword] = useState(false);

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
      showError(error instanceof Error ? error.message : "Failed to load users");
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

    try {
      const response = await apiPost<CreateUserPayload, UserUpdateResponse>("/api/admin/users", newUser, token);
      setUsers((current) => [...current, { ...response.user, password: "" }].sort((left, right) => left.username.localeCompare(right.username)));
      setNewUser({ username: "", email: "", password: "", is_admin: false, is_active: true });
      setIsCreateModalOpen(false);
      showSuccess(`Created user ${response.user.username}.`);
    } catch (error) {
      showError(error instanceof Error ? error.message : "User creation failed");
    } finally {
      setIsCreatingUser(false);
    }
  }

  async function handleSaveUser(user: UserRecord) {
    if (!token) {
      return;
    }

    setSavingUserId(user.id);

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
      showSuccess(`Saved ${response.user.username}.`);
    } catch (error) {
      showError(error instanceof Error ? error.message : "User update failed");
    } finally {
      setSavingUserId(null);
    }
  }

  function generateRandomPassword(length = 16) {
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const digits = "0123456789";
    const special = "!@#$%^&*";
    const all = upper + lower + digits + special;
    let password = "";
    for (let i = 0; i < length; i++) {
      password += all[Math.floor(Math.random() * all.length)];
    }
    return password;
  }

  async function handleGeneratePassword() {
    setIsGeneratingPassword(true);
    setNewUser((current) => ({ ...current, password: generateRandomPassword() }));
    setIsGeneratingPassword(false);
  }

  const visibleUsers = currentUser ? users.filter((user) => user.id !== currentUser.id) : users;

  return (
    <section className="grid gap-4">
      <article className="rounded-3xl border border-black/10 bg-white/85 p-5 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl">Users</h2>
          </div>
          <button className="rounded-xl border border-black/15 bg-white px-4 py-3 text-sm font-semibold text-black transition hover:bg-black/5" type="button" onClick={() => setIsCreateModalOpen(true)}>
            Add user
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {visibleUsers.map((user) => (
            <form
              key={user.id}
              className="rounded-2xl border border-black/10 bg-[#fffdf7] p-4"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault();
                void handleSaveUser(user);
              }}
            >
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <h3 className="font-display text-lg text-black">{user.username}</h3>
                {user.is_admin ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">Admin</span> : null}
                {!user.is_active ? <span className="rounded-full bg-black/10 px-2.5 py-1 text-xs font-semibold text-black/60">Inactive</span> : null}
              </div>
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
          {isLoading ? <p className="rounded-2xl border border-black/10 bg-white px-4 py-6 text-sm text-black/60">Loading users...</p> : null}
          {!isLoading && visibleUsers.length === 0 ? (
            currentUser?.is_admin ? (
              <div className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-5 py-6 text-sm text-black/65">
                <p className="font-semibold text-black">There are no other users yet.</p>
                <p className="mt-2">
                  If you want to update your own account, go to the <Link to="/profile" className="font-semibold text-black underline decoration-black/30 underline-offset-4">Profile page</Link>.
                </p>
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-black/15 bg-sand/60 px-4 py-6 text-sm text-black/60">No users created yet.</p>
            )
          ) : null}
        </div>
      </article>

      <Modal open={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} labelledBy="user-create-title" panelClassName="max-w-3xl">
        <article className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="user-create-title" className="font-display text-2xl">Add user</h2>
            </div>
            <button className="rounded-xl border border-black/15 bg-white px-4 py-2 text-sm font-semibold text-black" type="button" onClick={() => setIsCreateModalOpen(false)}>
              Close
            </button>
          </div>

          <form className="mt-5 grid gap-3" onSubmit={handleCreateUser}>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-sm text-black/70">
                Username
                <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" value={newUser.username} onChange={(event) => setNewUser((current) => ({ ...current, username: event.target.value }))} />
              </label>
              <label className="grid gap-1 text-sm text-black/70">
                Email
                <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="email" value={newUser.email} onChange={(event) => setNewUser((current) => ({ ...current, email: event.target.value }))} />
              </label>
              <div className="md:col-span-2">
                <label className="grid gap-1 text-sm text-black/70">
                  Password
                  <input className="rounded-xl border border-black/15 bg-white px-3 py-2 text-sm" type="password" value={newUser.password} onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))} />
                </label>
                <button className="mt-1 rounded-lg border border-black/15 bg-white px-2 py-1 text-sm text-black/70 transition hover:bg-black/5" type="button" onClick={handleGeneratePassword} disabled={isGeneratingPassword}>
                  {isGeneratingPassword ? (
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-black/30 border-t-black" />
                  ) : (
                    <span className="bi bi-shuffle inline-block text-sm" />
                  )}
                </button>
              </div>
              <div className="flex flex-wrap gap-3 rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-black/70 md:col-span-2">
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
        </article>
      </Modal>
    </section>
  );
}
