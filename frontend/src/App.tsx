import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import AuthPage from "./pages/AuthPage";
import RegisterPage from "./pages/RegisterPage";
import ApiPage from "./pages/ApiPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import SetupPage from "./pages/SetupPage";
import StatusPage from "./pages/StatusPage";
import DevicesPage from "./pages/DevicesPage";
import ModelsPage from "./pages/ModelsPage";
import NotFoundPage from "./pages/NotFoundPage";
import ForbiddenPage from "./pages/ForbiddenPage";
import { useAuth } from "./context/AuthContext";
import Modal from "./components/ui/Modal";
import { BACKEND_UNAVAILABLE_EVENT } from "./lib/api";

const appVersionLabel = `v${__APP_VERSION__}`;

function MainNavLink({
  iconClassName,
  label,
  to,
  end = false,
}: {
  iconClassName: string;
  label: string;
  to: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}
    >
      <i className={`${iconClassName} text-[14px] leading-none`} aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isBootstrapping, requiresSetup, user } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Loading...</section>;
  }
  if (requiresSetup) {
    return <Navigate to="/setup" replace />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!user.is_admin) {
    return <ForbiddenPage />;
  }
  return children;
}

function RequireUser({ children }: { children: ReactNode }) {
  const { isBootstrapping, requiresSetup, user } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Loading...</section>;
  }
  if (requiresSetup) {
    return <Navigate to="/setup" replace />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function RequireSetup({ children }: { children: ReactNode }) {
  const { isBootstrapping, requiresSetup } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Loading...</section>;
  }
  if (requiresSetup) {
    return <Navigate to="/setup" replace />;
  }
  return children;
}

function HomeRoute() {
  const { isBootstrapping, requiresSetup, user } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Loading...</section>;
  }
  if (requiresSetup) {
    return <Navigate to="/setup" replace />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <ChatPage />;
}

function SetupRoute() {
  const { bootstrapError, isBootstrapping, requiresSetup, user } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Checking installation state...</section>;
  }
  if (bootstrapError) {
    return <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">Unable to check installation state. Confirm the backend is running and reload after resolving the API error.</section>;
  }
  if (!requiresSetup) {
    return <Navigate to={user ? "/configuration" : "/login"} replace />;
  }
  return <SetupPage />;
}

export default function App() {
  const { bootstrapError, isBootstrapping, logout, requiresSetup, user, sitename } = useAuth();
  const location = useLocation();
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const showMainNav = !isBootstrapping && !requiresSetup;
  const showBackendUnavailableModal = backendUnavailable || (!isBootstrapping && Boolean(bootstrapError));
  const authRouteActive = location.pathname === "/login" || location.pathname === "/register";

  const pageTitle = ((): string => {
    const path = location.pathname;
    if (path === "/" || path === "/chat") return "Chat";
    if (path === "/status") return "Status";
    if (path === "/apikeys" || path === "/api") return "API";
    if (path === "/settings") return "Settings";
    if (path === "/devices") return "Devices";
    if (path === "/models") return "Models";
    if (path === "/profile") return "Profile";
    if (path === "/login" || path === "/auth") return "Login";
    if (path === "/register") return "Register";
    if (path === "/setup") return "Setup";
    if (path === "/403") return "Forbidden";
    if (path === "/404") return "Not Found";
    return "";
  })();

  useEffect(() => {
    const base = sitename || "Pawpile";
     document.title = pageTitle ? `${pageTitle} ~ ${base}` : base;
  }, [sitename, pageTitle]);

  useEffect(() => {
    function handleBackendUnavailable() {
      setBackendUnavailable(true);
    }

    window.addEventListener(BACKEND_UNAVAILABLE_EVENT, handleBackendUnavailable);
    return () => window.removeEventListener(BACKEND_UNAVAILABLE_EVENT, handleBackendUnavailable);
  }, []);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,#f8fbf1_0%,#f4f0e0_45%,#efe8d2_100%)] text-ink font-body">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <header className="relative z-50 mb-6 flex flex-wrap items-center justify-between gap-4 overflow-visible rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur isolate">
          <NavLink to="/" className="inline-flex items-baseline gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30">
            <h1 className="font-display text-2xl font-semibold tracking-tight">{sitename}</h1>
          </NavLink>
          {showMainNav ? (
            <nav className="flex flex-wrap items-center gap-2">
              {user ? (
                <MainNavLink to="/" end iconClassName="bi bi-house" label="Chat" />
              ) : null}
              {user ? (
                <MainNavLink to="/apikeys" iconClassName="bi bi-key" label="API" />
              ) : null}
              {user ? (
                <MainNavLink to="/status" iconClassName="bi bi-activity" label="Status" />
              ) : null}
              {user?.is_admin ? (
                <MainNavLink to="/devices" iconClassName="bi bi-gpu-card" label="Devices" />
              ) : null}
              {user?.is_admin ? (
                <MainNavLink to="/models" iconClassName="bi bi-folder" label="Models" />
              ) : null}
              {user?.is_admin ? (
                <MainNavLink to="/settings" iconClassName="bi bi-gear" label="Settings" />
              ) : null}
              <MainNavLink to={user ? "/profile" : "/login"} iconClassName="bi bi-person" label={user ? user.username : "Login"} />
            </nav>
          ) : null}
        </header>

        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
          <Route path="/configuration" element={<RequireAdmin><Navigate to="/settings" replace /></RequireAdmin>} />
          <Route path="/devices" element={<RequireAdmin><DevicesPage /></RequireAdmin>} />
          <Route path="/models" element={<RequireAdmin><ModelsPage /></RequireAdmin>} />
          <Route path="/users" element={<RequireAdmin><Navigate to="/settings" replace /></RequireAdmin>} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/auth" element={<Navigate to="/login" replace />} />
          <Route path="/status" element={<RequireSetup><StatusPage /></RequireSetup>} />
          <Route path="/profile" element={<RequireUser><ProfilePage /></RequireUser>} />
          <Route path="/api" element={<Navigate to="/apikeys" replace />} />
          <Route path="/apikeys" element={<RequireUser><ApiPage /></RequireUser>} />
          <Route path="/setup" element={<SetupRoute />} />
          <Route path="/403" element={<ForbiddenPage />} />
          <Route path="/404" element={<NotFoundPage />} />
          <Route path="*" element={requiresSetup ? <Navigate to="/setup" replace /> : <NotFoundPage />} />
        </Routes>
      </div>

      <Modal open={showBackendUnavailableModal} onClose={() => {}} labelledBy="backend-unavailable-title" describedBy="backend-unavailable-description" panelClassName="max-w-md">
        <div className="p-6 sm:p-7">
          <h2 id="backend-unavailable-title" className="font-display text-2xl font-semibold tracking-tight text-ink">Error</h2>
          <p id="backend-unavailable-description" className="mt-3 text-sm leading-6 text-black/70">
            Unable to communicate with backend. Ensure Pawpile containers are running.
          </p>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-ink px-4 py-2 text-sm font-semibold text-white hover:bg-black"
            >
              Refresh
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
