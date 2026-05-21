import { useAuth } from "../context/AuthContext";

export default function ProfilePage() {
  const { logout, user } = useAuth();

  return (
    <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Profile</p>
        <h2 className="mt-2 font-display text-xl">Your session</h2>
        <p className="mt-2 text-sm text-black/70">Review the account currently signed into Pawpile and end the session from here.</p>

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
        <p className="mt-2 text-sm text-black/70">Use this page for browser session details. API key management now lives on the dedicated API page.</p>
      </article>
    </section>
  );
}