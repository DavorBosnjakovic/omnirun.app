import { useState, useCallback, useEffect } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "lucide-react";
import WelcomeStep from "./WelcomeStep";
import TechLevelStep from "./TechLevelStep";
import ApiKeyStep from "./ApiKeyStep";
import ConnectionsStep from "./ConnectionsStep";
import SampleProjectStep from "./SampleProjectStep";
import CompletionStep from "./CompletionStep";

import texture from "../../assets/texture.jpg";

const TOTAL_STEPS = 6;
const appWindow = getCurrentWindow();

function OnboardingWrapper() {
  const { theme, setOnboardingCompleted } = useSettingsStore();
  const t = themes[theme];

  const [currentStep, setCurrentStep] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [isAnimating, setIsAnimating] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const check = async () => setIsMaximized(await appWindow.isMaximized());
    check();
    const unlisten = appWindow.onResized(async () => {
      setIsMaximized(await appWindow.isMaximized());
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };
  const handleClose = () => appWindow.close();

  const goToStep = useCallback(
    (step: number) => {
      if (isAnimating || step < 1 || step > TOTAL_STEPS) return;
      setDirection(step > currentStep ? "forward" : "back");
      setIsAnimating(true);
      // Small delay to trigger CSS exit, then switch
      setTimeout(() => {
        setCurrentStep(step);
        setIsAnimating(false);
      }, 200);
    },
    [currentStep, isAnimating]
  );

  const next = useCallback(() => goToStep(currentStep + 1), [currentStep, goToStep]);
  const back = useCallback(() => goToStep(currentStep - 1), [currentStep, goToStep]);

  const completeOnboarding = useCallback(() => {
    setOnboardingCompleted(true);
  }, [setOnboardingCompleted]);

  const renderStep = () => {
    switch (currentStep) {
      case 1:
        return <WelcomeStep onNext={next} onSkip={completeOnboarding} />;
      case 2:
        return <TechLevelStep onNext={next} onBack={back} />;
      case 3:
        return <ApiKeyStep onNext={next} onBack={back} />;
      case 4:
        return <ConnectionsStep onNext={next} onBack={back} />;
      case 5:
        return <SampleProjectStep onNext={next} onBack={back} />;
      case 6:
        return <CompletionStep onFinish={completeOnboarding} onBack={back} />;
      default:
        return null;
    }
  };

  return (
    <div
      className={`fixed inset-0 ${t.colors.text} flex flex-col`}
      style={{ fontFamily: "'Sora', sans-serif", backgroundColor: "#2F3238" }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: `url(${texture})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          opacity: 0.05,
        }}
      />
      {/* Window controls */}
      <div data-tauri-drag-region className="flex items-center h-10 relative z-10 select-none">
        <div style={{ flex: 1 }} data-tauri-drag-region />
        <div className="flex items-center">
          <button
            onClick={handleMinimize}
            className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/10 transition-colors rounded"
            title="Minimize"
          >
            <Minus size={16} />
          </button>
          <button
            onClick={handleMaximize}
            className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-gray-300 hover:bg-white/10 transition-colors rounded"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3.5" y="5" width="8" height="8" rx="1" />
                <path d="M5.5 5V3.5a1 1 0 011-1H12a1 1 0 011 1V9a1 1 0 01-1 1h-1.5" />
              </svg>
            ) : (
              <Square size={14} />
            )}
          </button>
          <button
            onClick={handleClose}
            className="w-10 h-10 flex items-center justify-center text-gray-500 hover:text-white hover:bg-red-600 transition-colors rounded"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
      {/* Progress bar */}
      {currentStep > 1 && (
        <div className="w-full px-8 pt-6 relative z-10">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2">
              {Array.from({ length: TOTAL_STEPS }, (_, i) => {
                const step = i + 1;
                const isComplete = step < currentStep;
                const isCurrent = step === currentStep;
                return (
                  <div key={step} className="flex-1 flex items-center gap-2">
                    <div
                      className={`flex-1 h-1 rounded-full transition-all duration-300 ${
                        isComplete || isCurrent
                          ? t.colors.accent
                          : t.colors.bgTertiary
                      }`}
                    />
                  </div>
                );
              })}
            </div>
            <p
              className={`text-xs mt-2 ${t.colors.textMuted}`}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              Step {currentStep} of {TOTAL_STEPS}
            </p>
          </div>
        </div>
      )}

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center overflow-hidden relative z-10">
        <div
          className="w-full max-w-2xl px-8 transition-all duration-200 ease-out"
          style={{
            opacity: isAnimating ? 0 : 1,
            transform: isAnimating
              ? direction === "forward"
                ? "translateX(40px)"
                : "translateX(-40px)"
              : "translateX(0)",
          }}
        >
          {renderStep()}
        </div>
      </div>
    </div>
  );
}

export default OnboardingWrapper;