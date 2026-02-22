import { useEffect, useState } from "react";
import MainLayout from "./components/layout/MainLayout";
import OnboardingWrapper from "./components/onboarding/OnboardingWrapper";
import LoginPage from "./components/auth/LoginPage";
import { retestAllConnections } from "./services/connections";
import { dbService } from "./services/dbService";
import { useProjectStore } from "./stores/projectStore";
import { useSettingsStore } from "./stores/settingsStore";
import { useUsageStore } from "./stores/usageStore";
import { useConnectionsStore } from "./stores/connectionsStore";
import { useAuthStore } from "./stores/authStore";

function App() {
  const [dbReady, setDbReady] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // Initialize SQLite and load all stores on startup
  useEffect(() => {
    async function initApp() {
      try {
        // 1. Initialize database (creates tables, runs migration from localStorage)
        await dbService.init();

        // 2. Load all stores from SQLite
        await Promise.all([
          useProjectStore.getState().loadFromDB(),
          useSettingsStore.getState().loadFromDB(),
          useUsageStore.getState().loadFromDB(),
          useConnectionsStore.getState().loadFromDB(),
        ]);

        // 3. Mark DB ready
        setDbReady(true);

        // 4. Try restoring auth session from stored tokens
        await useAuthStore.getState().initialize();
        setAuthChecked(true);

        // 5. Re-test all saved connections (after DB is loaded)
        retestAllConnections();
      } catch (error) {
        console.error("Failed to initialize app:", error);
        // Still show the UI even if DB fails
        setDbReady(true);
        setAuthChecked(true);
      }
    }

    initApp();

    // Cleanup auth listener on unmount
    return () => {
      useAuthStore.getState().cleanup();
    };
  }, []);

  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const theme = useSettingsStore((s) => s.theme);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);

  const fontMap: Record<string, string> = {
    omnirun: "'Sora', sans-serif",
    dark: "'Inter', sans-serif",
    light: "'Plus Jakarta Sans', sans-serif",
    sepia: "'Lora', serif",
    retro: "'JetBrains Mono', monospace",
    midnight: "'Space Grotesk', sans-serif",
    highContrast: "'Atkinson Hyperlegible', sans-serif",
  };

  const appFont = fontMap[theme] || "'Inter', sans-serif";

  // Don't render until DB and stores are loaded
  if (!dbReady || !authChecked) {
    return null;
  }

  // Flow: Onboarding (first launch) → Auth (login/signup) → MainLayout (app)
  if (!onboardingCompleted) {
    return (
      <div style={{ fontFamily: appFont }} className="h-screen w-screen">
        <OnboardingWrapper />
      </div>
    );
  }

  if (!isAuthenticated && !isLoading) {
    return (
      <div style={{ fontFamily: appFont }} className="h-screen w-screen">
        <LoginPage />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: appFont }} className="h-screen w-screen">
      <MainLayout />
    </div>
  );
}

export default App;