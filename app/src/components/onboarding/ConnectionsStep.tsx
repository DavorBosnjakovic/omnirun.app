import {
  ArrowLeft,
  Globe,
  Database,
  CreditCard,
  Mail,
  GitBranch,
  Cloud,
  Link,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

interface ConnectionsStepProps {
  onNext: () => void;
  onBack: () => void;
}

const connections = [
  {
    icon: Cloud,
    category: "Hosting",
    services: "Vercel, Netlify",
  },
  {
    icon: GitBranch,
    category: "Version Control",
    services: "GitHub",
  },
  {
    icon: Globe,
    category: "Domains",
    services: "Namecheap, Cloudflare",
  },
  {
    icon: Database,
    category: "Database",
    services: "Supabase",
  },
  {
    icon: CreditCard,
    category: "Payments",
    services: "Stripe",
  },
  {
    icon: Mail,
    category: "Email",
    services: "SendGrid",
  },
];

function ConnectionsStep({ onNext, onBack }: ConnectionsStepProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold mb-2">Connect your services</h2>
        <p className={`${t.colors.textMuted} text-sm`}>
          omnirun can deploy, manage domains, handle payments, and more — all from chat.
          Connect your accounts in Settings when you're ready.
        </p>
      </div>

      {/* Connections grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {connections.map((conn) => {
          const Icon = conn.icon;
          return (
            <div
              key={conn.category}
              className={`${t.borderRadius} p-4`}
              style={{ background: "rgba(56, 60, 67, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(85, 91, 99, 0.5)" }}
            >
              <div className="flex items-center gap-2.5 mb-1.5">
                <Icon size={16} className={t.colors.textMuted} />
                <span className="text-sm font-medium">{conn.category}</span>
              </div>
              <p className={`text-xs ${t.colors.textMuted}`}>{conn.services}</p>
            </div>
          );
        })}
      </div>

      {/* Where to find it */}
      <div
        className={`${t.borderRadius} p-4 mb-10 flex items-start gap-3`}
              style={{ background: "rgba(56, 60, 67, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(85, 91, 99, 0.5)" }}
      >
        <Link size={16} className={`${t.colors.textMuted} shrink-0 mt-0.5`} />
        <p className={`text-sm ${t.colors.textMuted} leading-relaxed`}>
          Go to Settings and open the Connections tab to link your accounts.
          You just need an API key or token from each service. Not sure how to get one? Just ask in the chat and omnirun will walk you through it.
        </p>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className={`flex items-center gap-2 text-sm ${t.colors.textMuted} hover:${t.colors.text} transition-colors duration-150`}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <button
          onClick={onNext}
          className={`text-white px-8 py-3 ${t.borderRadius} font-medium text-sm transition-all duration-150 hover:scale-[1.02] hover:brightness-110`}
          style={{ backgroundColor: '#2DB87A' }}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

export default ConnectionsStep;