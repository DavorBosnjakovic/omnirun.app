import { MessageSquare, Settings, BookOpen, ArrowLeft } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

interface CompletionStepProps {
  onFinish: () => void;
  onBack: () => void;
}

const tips = [
  {
    icon: MessageSquare,
    text: "Just describe what you want to build in the chat. Be as specific or vague as you like.",
  },
  {
    icon: Settings,
    text: "You can change your mode, theme, and AI provider anytime from Settings.",
  },
  {
    icon: BookOpen,
    text: "Start simple. Try something like \"make me a landing page\" and go from there.",
  },
];

function CompletionStep({ onFinish, onBack }: CompletionStepProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  return (
    <div className="flex flex-col items-center text-center">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-3xl font-bold mb-3">You're all set</h2>
        <p className={`${t.colors.textMuted} text-sm`}>
          Here are a few tips to get the most out of omnirun.
        </p>
      </div>

      {/* Tips */}
      <div className="w-full space-y-3 mb-10">
        {tips.map((tip) => {
          const Icon = tip.icon;
          return (
            <div
              key={tip.text}
              className={`${t.borderRadius} p-4 flex items-start gap-3 text-left`}
              style={{ background: "rgba(56, 60, 67, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(85, 91, 99, 0.5)" }}
            >
              <div
                className={`w-8 h-8 ${t.borderRadius} flex items-center justify-center shrink-0`}
                style={{ background: "rgba(255, 255, 255, 0.08)" }}
              >
                <Icon size={16} className={t.colors.textMuted} />
              </div>
              <p className={`text-sm ${t.colors.textMuted} leading-relaxed pt-1`}>
                {tip.text}
              </p>
            </div>
          );
        })}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between w-full">
        <button
          onClick={onBack}
          className={`flex items-center gap-2 text-sm ${t.colors.textMuted} hover:${t.colors.text} transition-colors duration-150`}
        >
          <ArrowLeft size={16} />
          Back
        </button>
        <button
          onClick={onFinish}
          className={`text-white px-8 py-3 ${t.borderRadius} font-medium text-sm transition-all duration-150 hover:scale-[1.02] hover:brightness-110`}
          style={{ backgroundColor: '#2DB87A' }}
        >
          Start Building
        </button>
      </div>
    </div>
  );
}

export default CompletionStep;