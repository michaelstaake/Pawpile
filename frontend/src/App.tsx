import { MouseEvent, useEffect, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import UsersPage from "./pages/UsersPage";
import AuthPage from "./pages/AuthPage";
import RegisterPage from "./pages/RegisterPage";
import ApiPage from "./pages/ApiPage";
import ProfilePage from "./pages/ProfilePage";
import SettingsPage from "./pages/SettingsPage";
import SetupPage from "./pages/SetupPage";
import StatusPage from "./pages/StatusPage";
import { useAuth } from "./context/AuthContext";

const appVersionLabel = `v${__APP_VERSION__}`;
type HeaderMenu = "user";

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { isBootstrapping, requiresSetup, user } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Loading your workspace...</section>;
  }
  if (requiresSetup) {
    return <Navigate to="/setup" replace />;
  }
  if (!user?.is_admin) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function RequireUser({ children }: { children: JSX.Element }) {
  const { isBootstrapping, requiresSetup, user } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Loading your workspace...</section>;
  }
  if (requiresSetup) {
    return <Navigate to="/setup" replace />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function HomeRoute() {
  const { isBootstrapping, requiresSetup, user } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Loading your workspace...</section>;
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
  const { bootstrapError, isBootstrapping, requiresSetup } = useAuth();

  if (isBootstrapping) {
    return <section className="rounded-2xl border border-black/10 bg-white/80 p-5 text-sm text-black/60 shadow-sm">Checking installation state...</section>;
  }
  if (bootstrapError) {
    return <section className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-700 shadow-sm">Unable to check installation state. Confirm the backend is running and reload after resolving the API error.</section>;
  }
  if (!requiresSetup) {
    return <Navigate to="/login" replace />;
  }
  return <SetupPage />;
}

export default function App() {
  const { bootstrapError, isBootstrapping, logout, requiresSetup, user, sitename } = useAuth();
  const location = useLocation();
  const [openMenu, setOpenMenu] = useState<HeaderMenu | null>(null);
  const showMainNav = !isBootstrapping && !requiresSetup;
  const authRouteActive = location.pathname === "/login" || location.pathname === "/register";
  const userMenuActive = !!user && location.pathname === "/profile";

  useEffect(() => {
    document.title = sitename || "Pawpile";
  }, [sitename]);

  useEffect(() => {
    setOpenMenu(null);
  }, [location.pathname]);

  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    function handleClickOutside(event: Event) {
      if (navRef.current && !navRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
              <h1 className="font-display text-2xl font-semibold tracking-tight">{sitename}</h1>
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
            <h1 className="font-display text-2xl font-semibold tracking-tight">{sitename}</h1>
          </NavLink>
          {showMainNav ? (
            <nav ref={navRef} className="relative z-50 flex flex-wrap items-center gap-2 overflow-visible">
              <NavLink to="/" end className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}>Chat</NavLink>
              <NavLink to="/status" className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}>Status</NavLink>
              {user ? (
                <NavLink to="/apikeys" className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}>API</NavLink>
              ) : null}
              {user?.is_admin ? (
                <>
                  <NavLink to="/settings" className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}>Settings</NavLink>
                  <NavLink to="/users" className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}>Users</NavLink>
                </>
              ) : null}
              {!user ? (
                <NavLink to="/login" className={() => `rounded-lg px-3 py-2 text-sm ${authRouteActive ? "bg-ink text-white" : "bg-black/5"}`}>Login</NavLink>
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
                      to="/profile"
                      className={({ isActive }) => `block rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "text-black/70 hover:bg-black/5"}`}
                    >
                      Profile
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
          <Route path="/" element={<HomeRoute />} />
          <Route path="/settings" element={<RequireAdmin><SettingsPage /></RequireAdmin>} />
          <Route path="/configuration" element={<RequireAdmin><Navigate to="/settings" replace /></RequireAdmin>} />
          <Route path="/devices" element={<RequireAdmin><Navigate to="/settings" replace /></RequireAdmin>} />
          <Route path="/models" element={<RequireAdmin><Navigate to="/settings" replace /></RequireAdmin>} />
          <Route path="/users" element={<RequireAdmin><UsersPage /></RequireAdmin>} />
          <Route path="/login" element={<AuthPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/auth" element={<Navigate to="/login" replace />} />
          <Route path="/status" element={<RequireUser><StatusPage /></RequireUser>} />
          <Route path="/profile" element={<RequireUser><ProfilePage /></RequireUser>} />
          <Route path="/api" element={<Navigate to="/apikeys" replace />} />
          <Route path="/apikeys" element={<RequireUser><ApiPage /></RequireUser>} />
          <Route path="/setup" element={<SetupRoute />} />
          <Route path="*" element={<Navigate to={requiresSetup ? "/setup" : "/"} replace />} />
        </Routes>
      </div>
    </div>
  );
}
