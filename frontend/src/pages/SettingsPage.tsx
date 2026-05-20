import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const adminSections = [
  {
    title: "Devices",
    href: "/devices",
    body: "Enable hardware, tune scheduling capacity, and decide what Pawpile can run on.",
  },
  {
    title: "Models",
    href: "/models",
    body: "Upload GGUF files, assign them to devices, and activate the models users can chat with.",
  },
  {
    title: "Users",
    href: "/users",
    body: "Create accounts, promote admins, and deactivate users without mixing those controls into model setup.",
  },
  {
    title: "API Keys",
    href: "/auth",
    body: "Jump to the shared Auth page to create or revoke your own API keys the same way normal users do.",
  },
];

export default function SettingsPage() {
  const { user, logout } = useAuth();

  return (
    <section className="grid gap-4">
      <article className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm backdrop-blur">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Settings</p>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-xl">Instance controls</h2>
            <p className="mt-2 max-w-3xl text-sm text-black/70">
              Settings is now a hub instead of one overloaded page. Use the dedicated sections below for devices, models, users, and API keys.
            </p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-[#fffdf7] px-4 py-3 text-sm text-black/70">
            <p className="font-semibold text-black">Signed in as {user?.username}</p>
            <p>{user?.email}</p>
            <button className="mt-3 rounded-xl border border-black/15 px-3 py-2 text-sm font-semibold text-black" type="button" onClick={logout}>
              Sign Out
            </button>
          </div>
        </div>
      </article>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {adminSections.map((section) => (
          <Link key={section.href} to={section.href} className="rounded-2xl border border-black/10 bg-white/80 p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-black/45">Open</p>
            <h3 className="mt-2 font-display text-lg">{section.title}</h3>
            <p className="mt-2 text-sm text-black/70">{section.body}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}