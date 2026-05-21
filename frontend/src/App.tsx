import { MouseEvent, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import DevicesPage from "./pages/DevicesPage";
import ModelsPage from "./pages/ModelsPage";
import UsersPage from "./pages/UsersPage";
import AuthPage from "./pages/AuthPage";
import SetupPage from "./pages/SetupPage";
import { useAuth } from "./context/AuthContext";

const adminNavItems = [
  { to: "/auth", label: "API" },
  { to: "/devices", label: "Devices" },
  { to: "/models", label: "Models" },
  { to: "/users", label: "Users" },
] as const;

const appVersionLabel = `v${__APP_VERSION__}`;
type HeaderMenu = "admin" | "user";

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { isBootstrapping, requiresSetup, user } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Loading your workspace...</section>;
  }
  if (requiresSetup) {
    return <Navigate to="/setup" replace />;
  }
  if (!user?.is_admin) {
    return <Navigate to="/auth" replace />;
  }
  return children;
}

function SetupRoute() {
  const { bootstrapError, isBootstrapping, requiresSetup } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Checking installation state...</section>;
  }
  if (bootstrapError) {
    return <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">Unable to check installation state. Confirm the backend is running and reload after resolving the API error.</section>;
  }
  if (!requiresSetup) {
    return <Navigate to="/auth" replace />;
  }
  return <SetupPage />;
}

export default function App() {
  const { bootstrapError, isBootstrapping, logout, requiresSetup, user } = useAuth();
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState<HeaderMenu | null>(null);
  const showMainNav = !isBootstrapping && !requiresSetup;
  const authRouteActive = location.pathname === "/auth";
  const adminMenuActive = !!user?.is_admin && adminNavItems.some((item) => location.pathname === item.to);
  const userMenuActive = !!user && authRouteActive && !user.is_admin;

  useEffect(() => {
    setOpenMenu(null);
  }, [location.pathname]);

  function handleMenuToggle(menu: HeaderMenu) {
    return (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      setOpenMenu((currentMenu) => (currentMenu === menu ? null : menu));
    };
  }

  if (!isBootstrapping && bootstrapError) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,#f8fbf1_0%,#f4f0e0_45%,#efe8d2_100%)] text-ink font-body">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
          <header className="mb-6 rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur">
            <NavLink to="/" className="inline-flex items-baseline gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30">
              <h1 className="font-display text-2xl font-semibold tracking-tight">Pawpile</h1>
              <span className="text-sm text-black/60">{appVersionLabel}</span>
            </NavLink>
          </header>
          <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">
            Unable to check installation state. Confirm the backend is running and that <code>/api/auth/bootstrap-status</code> returns successfully, then reload the page.
          </section>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,#f8fbf1_0%,#f4f0e0_45%,#efe8d2_100%)] text-ink font-body">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <header className="relative z-50 mb-6 flex flex-wrap items-center justify-between gap-4 overflow-visible rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur isolate">
          <NavLink to="/" className="inline-flex items-baseline gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30">
            <h1 className="font-display text-2xl font-semibold tracking-tight">Pawpile</h1>
            <span className="text-sm text-black/60">{appVersionLabel}</span>
          </NavLink>
          {showMainNav ? (
            <nav className="relative z-50 flex flex-wrap items-center gap-2 overflow-visible">
              <NavLink to="/" end className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}>Chat</NavLink>
              {user?.is_admin ? (
                <details open={openMenu === "admin"} className="group relative z-50">
                  <summary onClick={handleMenuToggle("admin")} className={`list-none rounded-lg px-3 py-2 text-sm cursor-pointer ${adminMenuActive ? "bg-ink text-white" : "bg-black/5"}`}>
                    <span className="flex items-center gap-2">
                      Settings
                      <span className="text-xs transition group-open:rotate-180">▾</span>
                    </span>
                  </summary>
                  <div className="absolute right-0 top-full z-50 mt-2 min-w-40 rounded-xl border border-black/10 bg-white/95 p-2 shadow-lg backdrop-blur">
                    {adminNavItems.map((item) => (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "text-black/70 hover:bg-black/5"}`}
                      >
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </details>
              ) : null}
              {!user ? (
                <NavLink to="/auth" className={() => `rounded-lg px-3 py-2 text-sm ${authRouteActive ? "bg-ink text-white" : "bg-black/5"}`}>Login</NavLink>
              ) : (
                <details open={openMenu === "user"} className="group relative z-50">
                  <summary onClick={handleMenuToggle("user")} className={`list-none cursor-pointer rounded-lg px-3 py-2 text-sm ${userMenuActive ? "bg-ink text-white" : "bg-black/5"}`}>
                    <span className="flex items-center gap-2">
                      {user.username}
                      <span className="text-xs transition group-open:rotate-180">▾</span>
                    </span>
                  </summary>
                  <div className="absolute right-0 top-full z-50 mt-2 min-w-40 rounded-xl border border-black/10 bg-white/95 p-2 shadow-lg backdrop-blur">
                    <NavLink
                      to="/auth"
                      className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "text-black/70 hover:bg-black/5"}`}
                    >
                      Manage
                    </NavLink>
                    <button
                      type="button"
                      onClick={logout}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm text-black/70 hover:bg-black/5"
                    >
                      Logout
                    </button>
                  </div>
                </details>
              )}
            </nav>
          ) : null}
        </header>

        <Routes>
          <Route path="/" element={requiresSetup ? <Navigate to="/setup" replace /> : <ChatPage />} />
          <Route path="/settings" element={<RequireAdmin><Navigate to="/devices" replace /></RequireAdmin>} />
          <Route path="/devices" element={<RequireAdmin><DevicesPage /></RequireAdmin>} />
          <Route path="/models" element={<RequireAdmin><ModelsPage /></RequireAdmin>} />
          <Route path="/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/setup" element={<SetupRoute />} />
          <Route path="*" element={<Navigate to={requiresSetup ? "/setup" : "/"} replace />} />
        </Routes>
      </div>
    </div>
  );
}
