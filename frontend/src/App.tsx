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
  const { bootstrapError, isBootstrapping, requiresSetup, user } = useAuth();
  const location = useLocation();
  const showMainNav = !isBootstrapping && !requiresSetup;
  const adminMenuActive = adminNavItems.some((item) => location.pathname === item.to);

  if (!isBootstrapping && bootstrapError) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,#f8fbf1_0%,#f4f0e0_45%,#efe8d2_100%)] text-ink font-body">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-8">
          <header className="mb-6 rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur">
            <h1 className="font-display text-2xl font-semibold tracking-tight">Pawpile</h1>
            <p className="text-sm text-black/60">Pawcrafted by Pup Sierra</p>
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
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Pawpile</h1>
            <p className="text-sm text-black/60">Pawcrafted by Pup Sierra</p>
          </div>
          {showMainNav ? (
            <nav className="flex flex-wrap gap-2">
              <NavLink to="/" className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}>Chat</NavLink>
              {user?.is_admin ? (
                <details className="group relative">
                  <summary className={`list-none rounded-lg px-3 py-2 text-sm cursor-pointer ${adminMenuActive ? "bg-ink text-white" : "bg-black/5"}`}>
                    <span className="flex items-center gap-2">
                      Settings
                      <span className="text-xs transition group-open:rotate-180">▾</span>
                    </span>
                  </summary>
                  <div className="absolute right-0 top-full z-10 mt-2 min-w-40 rounded-xl border border-black/10 bg-white/95 p-2 shadow-lg backdrop-blur">
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
              ) : (
                <NavLink to="/auth" className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}>API Keys</NavLink>
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
