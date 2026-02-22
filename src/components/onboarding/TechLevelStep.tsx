import { ArrowLeft, Monitor, TerminalSquare } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

interface TechLevelStepProps {
  onNext: () => void;
  onBack: () => void;
}

function TechLevelStep({ onNext, onBack }: TechLevelStepProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-2">Simple and Technical modes</h2>
        <p className={`${t.colors.textMuted} text-sm`}>
          omnirun starts in Simple mode. You can switch anytime using the toggle in the top bar.
        </p>
      </div>

      {/* Mode cards */}
      <div className="space-y-3 mb-10">
        <div
          className={`${t.borderRadius} p-5 flex items-start gap-4`}
              style={{ background: "rgba(56, 60, 67, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(85, 91, 99, 0.5)" }}
        >
          <div
            className={`w-9 h-9 ${t.borderRadius} flex items-center justify-center shrink-0`}
            style={{ backgroundColor: '#2DB87A' }}
          >
            <Monitor
              size={18}
              className={theme === "highContrast" ? "text-black" : "text-white"}
            />
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-1">Simple Mode</h3>
            <p className={`text-sm ${t.colors.textMuted} leading-relaxed`}>
              The default. A clean interface focused on chatting with AI and building your project.
            </p>
          </div>
        </div>

        <div
          className={`${t.borderRadius} p-5 flex items-start gap-4`}
              style={{ background: "rgba(56, 60, 67, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(85, 91, 99, 0.5)" }}
        >
          <div
            className={`w-9 h-9 ${t.borderRadius} flex items-center justify-center shrink-0`}
                style={{ background: "rgba(255, 255, 255, 0.08)" }}
          >
            <TerminalSquare size={18} className={t.colors.textMuted} />
          </div>
          <div>
            <h3 className="font-semibold text-sm mb-1">Technical Mode</h3>
            <p className={`text-sm ${t.colors.textMuted} leading-relaxed`}>
              Adds a terminal panel and git info for developers who want more control.
            </p>
          </div>
        </div>
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

export default TechLevelStep;