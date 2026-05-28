import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

export default function ProfilePage() {
  const { logout, updateProfile, user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [email, setEmail] = useState(user?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);

  useEffect(() => {
    setEmail(user?.email ?? "");
  }, [user?.email]);

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedEmail = email.trim();

    if (!trimmedEmail) {
      showError("Email is required.");
      return;
    }

    if (trimmedEmail === (user?.email ?? "")) {
      showError("No email changes to save.");
      return;
    }

    setIsSavingEmail(true);
    try {
      await updateProfile({ email: trimmedEmail });
      showSuccess("Email updated.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to update email.");
    } finally {
      setIsSavingEmail(false);
    }
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextPassword = password.trim();
    const nextConfirmPassword = confirmPassword.trim();

    if (!nextPassword) {
      showError("New password is required.");
      return;
    }

    if (nextPassword.length < 8) {
      showError("Password must be at least 8 characters.");
      return;
    }

    if (nextPassword !== nextConfirmPassword) {
      showError("Password confirmation does not match.");
      return;
    }

    setIsSavingPassword(true);
    try {
      await updateProfile({ password: nextPassword });
      setPassword("");
      setConfirmPassword("");
      showSuccess("Password updated.");
    } catch (error) {
      showError(error instanceof Error ? error.message : "Unable to update password.");
    } finally {
      setIsSavingPassword(false);
    }
  }

  const roleLabel = user?.is_admin ? "Admin" : "Standard";

  return (
    <section className="grid gap-4">
      <article className="overflow-hidden rounded-3xl border border-black/10 bg-[linear-gradient(135deg,rgba(17,24,39,0.96),rgba(56,189,248,0.84))] p-6 text-white shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/65">{roleLabel}</p>
            <h1 className="mt-3 font-display text-3xl leading-tight">Welcome back, {user?.username ?? "there"}</h1>
          </div>
          <button
            type="button"
            onClick={logout}
            className="mt-1 shrink-0 rounded-xl border border-white/20 bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 transition"
          >
            Log out
          </button>
        </div>
      </article>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
          <h2 className="font-display text-xl">Update email</h2>

          <form className="mt-5 space-y-4" onSubmit={handleEmailSubmit}>
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
            <button
              className="rounded-xl bg-ink px-4 py-3 font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={isSavingEmail}
            >
              {isSavingEmail ? "Saving..." : "Update email"}
            </button>
          </form>
        </article>

        <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
          <h2 className="font-display text-xl">Update password</h2>

          <form className="mt-5 space-y-4" onSubmit={handlePasswordSubmit}>
            <label className="block text-sm text-black/70">
              <span className="mb-2 block font-semibold text-black">New password</span>
              <input
                className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 outline-none transition focus:border-black/25"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="Enter a new password"
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
            <button
              className="rounded-xl bg-ink px-4 py-3 font-semibold text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              type="submit"
              disabled={isSavingPassword}
            >
              {isSavingPassword ? "Saving..." : "Update password"}
            </button>
          </form>
        </article>
      </div>
    </section>
  );
}