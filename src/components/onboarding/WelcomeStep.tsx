import { Sparkles, Globe, Terminal, Cpu } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import logoDark from "../../assets/logo_transparent_dark.svg";

interface WelcomeStepProps {
  onNext: () => void;
  onSkip: () => void;
}

const features = [
  {
    icon: Sparkles,
    title: "Build with AI",
    description: "Describe what you want and watch it come to life",
  },
  {
    icon: Globe,
    title: "Websites & Apps",
    description: "Create, edit, and deploy full projects from chat",
  },
  {
    icon: Terminal,
    title: "Automate Tasks",
    description: "Let AI handle repetitive work on your computer",
  },
  {
    icon: Cpu,
    title: "Multiple AI Providers",
    description: "Use Claude, GPT, Gemini, Groq, or local models",
  },
];

function WelcomeStep({ onNext, onSkip }: WelcomeStepProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  return (
    <div className="flex flex-col items-center text-center">
      {/* Logo / App name */}
      <div className="mb-8">
        <img src={logoDark} alt="omnirun" className="mx-auto mb-4" style={{ height: 160 }} />
        <p className={`text-lg ${t.colors.textMuted}`}>
          Run everything. Describe it. Done.
        </p>
      </div>

      {/* Feature grid */}
      <div className="grid grid-cols-2 gap-4 w-full mb-10">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <div
              key={feature.title}
              className={`${t.borderRadius} p-5 text-left transition-all duration-150 hover:scale-[1.02]`}
              style={{ background: "rgba(56, 60, 67, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(85, 91, 99, 0.5)" }}
            >
              <div
                className={`w-9 h-9 ${t.borderRadius} flex items-center justify-center mb-3`}
                style={{ background: "rgba(255, 255, 255, 0.08)" }}
              >
                <Icon size={18} className={t.colors.textMuted} />
              </div>
              <h3 className="font-semibold text-sm mb-1">{feature.title}</h3>
              <p className={`text-xs ${t.colors.textMuted} leading-relaxed`}>
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* CTA */}
      <button
        onClick={onNext}
        className={`text-white px-8 py-3 ${t.borderRadius} font-medium text-sm transition-all duration-150 hover:scale-[1.02] hover:brightness-110`}
        style={{ backgroundColor: '#2DB87A' }}
      >
        Get Started
      </button>
      <button
        onClick={onSkip}
        className={`mt-3 text-sm ${t.colors.textMuted} hover:${t.colors.text} transition-colors duration-150`}
      >
        Skip, I'll explore on my own
      </button>
    </div>
  );
}

export default WelcomeStep;