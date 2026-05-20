import { NavLink, Route, Routes } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import AdminPage from "./pages/AdminPage";

export default function App() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_0%_0%,#f8fbf1_0%,#f4f0e0_45%,#efe8d2_100%)] text-ink font-body">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-black/10 bg-white/80 p-4 shadow-sm backdrop-blur">
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-tight">Pawpile</h1>
            <p className="text-sm text-black/60">Pawcrafted by Pup Sierra</p>
          </div>
          <nav className="flex gap-2">
            <NavLink to="/" className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}>
              Chat
            </NavLink>
            <NavLink to="/admin" className={({ isActive }) => `rounded-lg px-3 py-2 text-sm ${isActive ? "bg-ink text-white" : "bg-black/5"}`}>
              Admin
            </NavLink>
          </nav>
        </header>

        <Routes>
          <Route path="/" element={<ChatPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </div>
    </div>
  );
}
