import { useState, useEffect } from "react";
import { Settings, Key, BarChart3, Plug, Mic, CreditCard, Info, X, Brain, Monitor } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import GeneralSettings from "./GeneralSettings";
import ApiKeySettings from "./ApiKeySettings";
import UsageSettings from "./UsageSettings";
import ConnectionsSettings from "./ConnectionsSettings";
import VoiceSettings from "./VoiceSettings";
import BillingSettings from "./BillingSettings";
import AboutSettings from "./AboutSettings";
import MemorySettings from "./MemorySettings";
import ScreenControlSettings from "./ScreenControlSettings";

type SettingsTab = "general" | "apikey" | "usage" | "connections" | "voice" | "memory" | "screencontrol" | "billing" | "about";

interface SettingsLayoutProps {
  onClose: () => void;
  initialTab?: string;
}

function SettingsLayout({ onClose, initialTab = "general" }: SettingsLayoutProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab as SettingsTab);
  const { theme } = useSettingsStore();
  const t = themes[theme];

  useEffect(() => {
    setActiveTab(initialTab as SettingsTab);
  }, [initialTab]);

  const tabs = [
    { id: "general", label: "General", icon: Settings },
    { id: "apikey", label: "API Key", icon: Key },
    { id: "usage", label: "Usage", icon: BarChart3 },
    { id: "connections", label: "Project Connections", icon: Plug },
    { id: "voice", label: "Voice", icon: Mic },
    { id: "memory", label: "Memory", icon: Brain },
    { id: "screencontrol", label: "Screen Control", icon: Monitor },
    { id: "billing", label: "Billing", icon: CreditCard },
    { id: "about", label: "About", icon: Info },
  ] as const;

  const renderContent = () => {
    switch (activeTab) {
      case "general": return <GeneralSettings />;
      case "apikey": return <ApiKeySettings />;
      case "usage": return <UsageSettings />;
      case "connections": return <ConnectionsSettings />;
      case "voice": return <VoiceSettings />;
      case "memory": return <MemorySettings />;
      case "screencontrol": return <ScreenControlSettings />;
      case "billing": return <BillingSettings />;
      case "about": return <AboutSettings />;
    }
  };

  return (
    <div className={`flex h-full ${t.colors.bg} flex-1`}>
      {/* Settings sidebar */}
      <div className={`w-56 ${t.colors.bgSecondary} ${t.colors.border} border-l border-r flex flex-col`}>
        <div className={`p-4 ${t.colors.border} border-b flex justify-between items-center`}>
          <h2 className={`font-semibold ${t.colors.text}`}>Settings</h2>
          <button
            onClick={onClose}
            className={`${t.colors.textMuted} hover:${t.colors.text}`}
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 p-2">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-full flex items-center gap-3 px-3 py-2 ${t.borderRadius} text-sm mb-1 ${
                activeTab === id
                  ? `${t.colors.bgTertiary} ${t.colors.text}`
                  : `${t.colors.textMuted} hover:${t.colors.bgTertiary}`
              }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Settings content */}
      <div className="flex-1 overflow-y-auto p-6">
        {renderContent()}
      </div>
    </div>
  );
}

export default SettingsLayout;