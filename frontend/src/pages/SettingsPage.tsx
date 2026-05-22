import { useState } from "react";
import ConfigurationPage from "./ConfigurationPage";
import DevicesPage from "./DevicesPage";
import ModelsPage from "./ModelsPage";
import UsersPage from "./UsersPage";

type SettingsTab = "general" | "devices" | "models" | "users";

const tabs: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "devices", label: "Devices" },
  { id: "models", label: "Models" },
  { id: "users", label: "Users" },
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
      {activeTab === "devices" && <DevicesPage />}
      {activeTab === "models" && <ModelsPage />}
      {activeTab === "users" && <UsersPage />}
    </div>
  );
}
