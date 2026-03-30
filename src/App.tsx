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
  // Single atomic flag — nothing renders until the entire init sequence
  // is complete. Splitting into dbReady + authChecked allowed React to
  // re-render between steps, causing "DB not initialized" errors when
  // auth listeners tried to persist tokens mid-init.
  const [appReady, setAppReady] = useState(false);
  const [dbError, setDbError] = useState(false);

  useEffect(() => {
    async function initApp() {
      try {
        // 1. Initialize database (creates tables, runs migrations)
        await dbService.init();

        // 2. Load all stores from SQLite
        await Promise.all([
          useProjectStore.getState().loadFromDB(),
          useSettingsStore.getState().loadFromDB(),
          useUsageStore.getState().loadFromDB(),
          useConnectionsStore.getState().loadFromDB(),
        ]);

        // 3. Restore auth session from stored tokens.
        //    Must run AFTER DB is fully initialized because the auth
        //    state-change listener will immediately try to persist tokens.
        await useAuthStore.getState().initialize();

        // 4. Mark fully ready — ONE render, at the very end.
        setAppReady(true);

        // 5. Re-test saved connections in the background (non-blocking)
        retestAllConnections();
      } catch (error) {
        console.error("Failed to initialize app:", error);
        setDbError(true);
      }
    }

    initApp();

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

  if (dbError) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-black text-white text-sm opacity-60">
        Failed to initialize database. Please restart the app.
      </div>
    );
  }

  // Nothing renders until the full init sequence is done
  if (!appReady) {
    return null;
  }

  // Flow: Onboarding (first launch) → Auth (login/signup) → MainLayout
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