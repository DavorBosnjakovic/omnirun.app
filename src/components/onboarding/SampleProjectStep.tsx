import { FolderOpen, ArrowLeft, Rocket, Plus } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";

interface SampleProjectStepProps {
  onNext: () => void;
  onBack: () => void;
}

function SampleProjectStep({ onNext, onBack }: SampleProjectStepProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const handleSampleProject = () => {
    // TODO: create sample project in a temp directory
    onNext();
  };

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-2">Want to try a sample project?</h2>
        <p className={`${t.colors.textMuted} text-sm`}>
          We can set up a small demo project so you can see how omnirun works before starting your own.
        </p>
      </div>

      {/* Options */}
      <div className="space-y-3 mb-10">
        <button
          onClick={handleSampleProject}
          className={`${t.borderRadius} p-5 flex items-center gap-4 w-full text-left hover:scale-[1.01] transition-all duration-150`}
              style={{ background: "rgba(56, 60, 67, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(85, 91, 99, 0.5)" }}
        >
          <div
            className={`w-10 h-10 ${t.borderRadius} flex items-center justify-center shrink-0`}
            style={{ backgroundColor: '#2DB87A' }}
          >
            <Rocket
              size={20}
              className={theme === "highContrast" ? "text-black" : "text-white"}
            />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Yes, create a sample project</h3>
            <p className={`text-xs ${t.colors.textMuted} mt-0.5`}>
              A simple website you can explore and modify with AI
            </p>
          </div>
        </button>

        <button
          onClick={onNext}
          className={`${t.borderRadius} p-5 flex items-center gap-4 w-full text-left hover:scale-[1.01] transition-all duration-150`}
              style={{ background: "rgba(56, 60, 67, 0.55)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: "1px solid rgba(85, 91, 99, 0.5)" }}
        >
          <div
            className={`w-10 h-10 ${t.borderRadius} flex items-center justify-center shrink-0`}
                style={{ background: "rgba(255, 255, 255, 0.08)" }}
          >
            <Plus size={20} className={t.colors.textMuted} />
          </div>
          <div>
            <h3 className="font-semibold text-sm">No, I'll start fresh</h3>
            <p className={`text-xs ${t.colors.textMuted} mt-0.5`}>
              Jump straight into the app and create your own project
            </p>
          </div>
        </button>
      </div>

      {/* Back */}
      <div className="flex items-center">
        <button
          onClick={onBack}
          className={`flex items-center gap-2 text-sm ${t.colors.textMuted} hover:${t.colors.text} transition-colors duration-150`}
        >
          <ArrowLeft size={16} />
          Back
        </button>
      </div>
    </div>
  );
}

export default SampleProjectStep;