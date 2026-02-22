import { create } from "zustand";
import { ThemeKey } from "../config/themes";
import { dbService } from "../services/dbService";

interface SettingsState {
  theme: ThemeKey;
  mode: "simple" | "technical";
  timeFormat: "12h" | "24h";
  fontSize: "small" | "medium" | "large";
  confirmBeforeDelete: boolean;
  autoSaveFiles: boolean;
  webSearchEnabled: boolean;
  searchApiKey: string;
  onboardingCompleted: boolean;
  setTheme: (theme: ThemeKey) => void;
  setMode: (mode: "simple" | "technical") => void;
  setTimeFormat: (format: "12h" | "24h") => void;
  setFontSize: (size: "small" | "medium" | "large") => void;
  setConfirmBeforeDelete: (value: boolean) => void;
  setAutoSaveFiles: (value: boolean) => void;
  setWebSearchEnabled: (value: boolean) => void;
  setSearchApiKey: (key: string) => void;
  setOnboardingCompleted: (value: boolean) => void;
  cycleTheme: () => void;
  toggleMode: () => void;
  resetToDefaults: () => void;
  // New: load from SQLite on startup
  loadFromDB: () => Promise<void>;
}

const themeOrder: ThemeKey[] = ["omnirun", "dark", "light", "sepia", "retro", "midnight", "highContrast"];

const defaults = {
  theme: "omnirun" as ThemeKey,
  mode: "simple" as const,
  timeFormat: "12h" as const,
  fontSize: "medium" as const,
  confirmBeforeDelete: true,
  autoSaveFiles: true,
  webSearchEnabled: false,
  searchApiKey: "",
  onboardingCompleted: false,
};

// Persist a single setting to SQLite (fire-and-forget)
function persistSetting(key: string, value: any) {
  dbService.setSetting(key, JSON.stringify(value)).catch((e) => {
    console.error(`Failed to save setting "${key}" to DB:`, e);
  });
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...defaults,

  setTheme: (theme) => {
    set({ theme });
    persistSetting("theme", theme);
  },

  setMode: (mode) => {
    set({ mode });
    persistSetting("mode", mode);
  },

  setTimeFormat: (timeFormat) => {
    set({ timeFormat });
    persistSetting("timeFormat", timeFormat);
  },

  setFontSize: (fontSize) => {
    set({ fontSize });
    persistSetting("fontSize", fontSize);
  },

  setConfirmBeforeDelete: (confirmBeforeDelete) => {
    set({ confirmBeforeDelete });
    persistSetting("confirmBeforeDelete", confirmBeforeDelete);
  },

  setAutoSaveFiles: (autoSaveFiles) => {
    set({ autoSaveFiles });
    persistSetting("autoSaveFiles", autoSaveFiles);
  },

  setWebSearchEnabled: (webSearchEnabled) => {
    set({ webSearchEnabled });
    persistSetting("webSearchEnabled", webSearchEnabled);
  },

  setSearchApiKey: (searchApiKey) => {
    set({ searchApiKey });
    persistSetting("searchApiKey", searchApiKey);
  },

  setOnboardingCompleted: (onboardingCompleted) => {
    set({ onboardingCompleted });
    persistSetting("onboardingCompleted", onboardingCompleted);
  },

  cycleTheme: () =>
    set((state) => {
      const currentIndex = themeOrder.indexOf(state.theme);
      const nextIndex = (currentIndex + 1) % themeOrder.length;
      const theme = themeOrder[nextIndex];
      persistSetting("theme", theme);
      return { theme };
    }),

  toggleMode: () =>
    set((state) => {
      const mode = state.mode === "simple" ? "technical" : "simple";
      persistSetting("mode", mode);
      return { mode };
    }),

  resetToDefaults: () => {
    set({ ...defaults });
    // Persist all defaults
    for (const [key, value] of Object.entries(defaults)) {
      persistSetting(key, value);
    }
  },

  // Load settings from SQLite on app startup
  loadFromDB: async () => {
    try {
      const all = await dbService.getAllSettings();
      const updates: Partial<SettingsState> = {};

      // Parse each setting, falling back to defaults if missing
      if (all.theme) {
        try { updates.theme = JSON.parse(all.theme); } catch { /* keep default */ }
      }
      if (all.mode) {
        try { updates.mode = JSON.parse(all.mode); } catch { /* keep default */ }
      }
      if (all.timeFormat) {
        try { updates.timeFormat = JSON.parse(all.timeFormat); } catch { /* keep default */ }
      }
      if (all.fontSize) {
        try { updates.fontSize = JSON.parse(all.fontSize); } catch { /* keep default */ }
      }
      if (all.confirmBeforeDelete !== undefined) {
        try { updates.confirmBeforeDelete = JSON.parse(all.confirmBeforeDelete); } catch { /* keep default */ }
      }
      if (all.autoSaveFiles !== undefined) {
        try { updates.autoSaveFiles = JSON.parse(all.autoSaveFiles); } catch { /* keep default */ }
      }
      if (all.webSearchEnabled !== undefined) {
        try { updates.webSearchEnabled = JSON.parse(all.webSearchEnabled); } catch { /* keep default */ }
      }
      if (all.searchApiKey) {
        try { updates.searchApiKey = JSON.parse(all.searchApiKey); } catch { /* keep default */ }
      }
      if (all.onboardingCompleted !== undefined) {
        try { updates.onboardingCompleted = JSON.parse(all.onboardingCompleted); } catch { /* keep default */ }
      }

      if (Object.keys(updates).length > 0) {
        useSettingsStore.setState(updates);
      }
    } catch (e) {
      console.error("Failed to load settings from DB:", e);
    }
  },
}));