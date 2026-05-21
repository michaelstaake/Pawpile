import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";

export default function ProfilePage() {
  const { logout, updateProfile, user } = useAuth();
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEmail(user?.email ?? "");
  }, [user?.email]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const trimmedEmail = email.trim();
    const nextPassword = password.trim();

    if (!trimmedEmail) {
      setErrorMessage("Email is required.");
      return;
    }

    if (nextPassword && nextPassword.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }

    if (nextPassword !== confirmPassword.trim()) {
      setErrorMessage("Password confirmation does not match.");
      return;
    }

    if (trimmedEmail === (user?.email ?? "") && !nextPassword) {
      setErrorMessage("No profile changes to save.");
      return;
    }

    setIsSaving(true);
    try {
      await updateProfile({
        email: trimmedEmail === (user?.email ?? "") ? undefined : trimmedEmail,
        password: nextPassword || undefined,
      });
      setPassword("");
      setConfirmPassword("");
      setSuccessMessage("Profile updated.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to update profile.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Profile</p>
        <h2 className="mt-2 font-display text-xl">Account details</h2>
        <p className="mt-2 text-sm text-black/70">Review the signed-in account and end the current browser session from here.</p>

        {user ? (
          <div className="mt-5 rounded-2xl border border-black/10 bg-[#fffdf7] p-4 text-sm text-black/70">
            <p className="font-semibold text-black">{user.username}</p>
            <p>{user.email}</p>
            <p className="mt-1 text-xs uppercase tracking-[0.2em] text-black/45">{user.is_admin ? "Admin" : "User"}</p>
            <button className="mt-4 rounded-xl border border-black/15 px-4 py-2 font-semibold text-black" type="button" onClick={logout}>
              Sign Out
            </button>
          </div>
        ) : null}
      </article>

      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Access</p>
        <h2 className="mt-2 font-display text-xl">Web account</h2>
        <p className="mt-2 text-sm text-black/70">Update your email address or set a new password for this browser account.</p>

        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <label className="block text-sm text-black/70">
            <span className="mb-2 block font-semibold text-black">Username</span>
            <input
              className="w-full rounded-xl border border-black/10 bg-black/5 px-4 py-3 text-black/55 outline-none"
              type="text"
              value={user?.username ?? ""}
              disabled
              readOnly
            />
          </label>
          <label className="block text-sm text-black/70">
            <span className="mb-2 block font-semibold text-black">Email</span>
            <input
              className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none transition focus:border-black/25"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label className="block text-sm text-black/70">
            <span className="mb-2 block font-semibold text-black">New password</span>
            <input
              className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none transition focus:border-black/25"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="Leave blank to keep the current password"
            />
          </label>
          <label className="block text-sm text-black/70">
            <span className="mb-2 block font-semibold text-black">Confirm new password</span>
            <input
              className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none transition focus:border-black/25"
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="Repeat the new password"
            />
          </label>
          {errorMessage ? <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</p> : null}
          {successMessage ? <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{successMessage}</p> : null}
          <button className="rounded-xl bg-ink px-4 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60" type="submit" disabled={isSaving}>
            {isSaving ? "Saving..." : "Save profile"}
          </button>
        </form>
      </article>
    </section>
  );
}