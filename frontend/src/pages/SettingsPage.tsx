import { useState } from "react";
import ConfigurationPage from "./ConfigurationPage";
import LogsPage from "./LogsPage";
import UsersPage from "./UsersPage";

type SettingsTab = "general" | "users" | "logs";

const tabs: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "users", label: "Users" },
  { id: "logs", label: "Logs" },
];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return (
    <div className="grid gap-4">
      <div className="flex gap-1 rounded-2xl border border-black/10 bg-white/80 p-2 shadow-sm backdrop-blur">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeTab === tab.id ? "bg-ink text-white" : "text-black/70 hover:bg-black/5"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "general" && <ConfigurationPage />}
      {activeTab === "users" && <UsersPage />}
      {activeTab === "logs" && <LogsPage />}
    </div>
  );
}
