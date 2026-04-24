import {
  ExternalLink,
  ArrowLeft,
  Key,
  Settings,
  Shield,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import { openUrl } from "@tauri-apps/plugin-opener";

interface ApiKeyStepProps {
  onNext: () => void;
  onBack: () => void;
}

function ApiKeyStep({ onNext, onBack }: ApiKeyStepProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const handleOpenConsole = async () => {
    try {
      await openUrl("https://console.anthropic.com/");
    } catch {
      window.open("https://console.anthropic.com/", "_blank");
    }
  };

  const steps = [
    {
      icon: ExternalLink,
      title: "Get an API key",
      description:
        "Create a free account at Anthropic and generate an API key. We recommend Claude for the best experience, but you can also use OpenAI, Google, Groq, or others.",
      action: (
        <button
          onClick={handleOpenConsole}
          className={`mt-2 text-sm font-medium flex items-center gap-1.5 hover:opacity-80 transition-opacity`}
        >
          Open Anthropic Console
          <ExternalLink size={14} />
        </button>
      ),
    },
    {
      icon: Settings,
      title: "Enter it in Settings",
      description:
        'Once you have a key, go to Settings (gear icon in the top bar) and paste it under "API Providers". You can add multiple providers if you want.',
    },
    {
      icon: Shield,
      title: "Your key stays private",
      description:
        "Your API key is stored locally on your device. It never leaves your computer or gets sent to our servers.",
    },
  ];

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-2">You'll need an AI API key</h2>
        <p className={`${t.colors.textMuted} text-sm`}>
          omnirun connects to AI providers like Claude, GPT, or Gemini to power its features. Here's how to set that up.
        </p>
      </div>

      {/* Steps */}
      <div className="space-y-4 mb-10">
        {steps.map((step, index) => {
          const Icon = step.icon;
          return (
            <div
              key={step.title}
              className={`${t.borderRadius} p-5 flex items-start gap-4`}
              style={{ background: "rgba(56, 60, 67, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(85, 91, 99, 0.5)" }}
            >
              <div
                className={`w-9 h-9 ${t.borderRadius} flex items-center justify-center shrink-0`}
                style={{ background: "rgba(255, 255, 255, 0.08)" }}
              >
                <span className={`text-xs font-bold ${t.colors.textMuted}`}>{index + 1}</span>
              </div>
              <div>
                <h3 className="font-semibold text-sm mb-1 flex items-center gap-2">
                  <Icon size={15} className={t.colors.textMuted} />
                  {step.title}
                </h3>
                <p className={`text-sm ${t.colors.textMuted} leading-relaxed`}>
                  {step.description}
                </p>
                {step.action && step.action}
              </div>
            </div>
          );
        })}
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

export default ApiKeyStep;