import type { ITheme } from "@xterm/xterm";

// Each entry maps to a omnirun theme from config/themes.ts
// When adding a new app theme, add a matching entry here.
// If no match is found, "dark" is used as fallback.

export const terminalThemes: Record<string, ITheme> = {
  dark: {
    background: "#111827",     // gray-900
    foreground: "#e5e7eb",     // gray-200
    cursor: "#3b82f6",         // blue-500
    cursorAccent: "#111827",
    selectionBackground: "#374151", // gray-700
    black: "#1f2937",
    red: "#ef4444",
    green: "#22c55e",
    yellow: "#eab308",
    blue: "#3b82f6",
    magenta: "#a855f7",
    cyan: "#06b6d4",
    white: "#e5e7eb",
    brightBlack: "#6b7280",
    brightRed: "#f87171",
    brightGreen: "#4ade80",
    brightYellow: "#facc15",
    brightBlue: "#60a5fa",
    brightMagenta: "#c084fc",
    brightCyan: "#22d3ee",
    brightWhite: "#ffffff",
  },

  light: {
    background: "#ffffff",     // white
    foreground: "#111827",     // gray-900
    cursor: "#3b82f6",         // blue-500
    cursorAccent: "#ffffff",
    selectionBackground: "#dbeafe", // blue-100
    black: "#111827",
    red: "#dc2626",
    green: "#16a34a",
    yellow: "#ca8a04",
    blue: "#2563eb",
    magenta: "#9333ea",
    cyan: "#0891b2",
    white: "#f9fafb",
    brightBlack: "#6b7280",
    brightRed: "#ef4444",
    brightGreen: "#22c55e",
    brightYellow: "#eab308",
    brightBlue: "#3b82f6",
    brightMagenta: "#a855f7",
    brightCyan: "#06b6d4",
    brightWhite: "#ffffff",
  },

  sepia: {
    background: "#1c1917",     // stone-900
    foreground: "#ffedd5",     // orange-100
    cursor: "#c2410c",         // orange-700
    cursorAccent: "#1c1917",
    selectionBackground: "#44403c", // stone-700
    black: "#292524",
    red: "#ef4444",
    green: "#22c55e",
    yellow: "#f59e0b",
    blue: "#f97316",
    magenta: "#e879a8",
    cyan: "#fb923c",
    white: "#ffedd5",
    brightBlack: "#78716c",
    brightRed: "#f87171",
    brightGreen: "#4ade80",
    brightYellow: "#fbbf24",
    brightBlue: "#fb923c",
    brightMagenta: "#f9a8d4",
    brightCyan: "#fdba74",
    brightWhite: "#fffbeb",
  },

  retro: {
    background: "#000000",     // black
    foreground: "#4ade80",     // green-400
    cursor: "#4ade80",         // green-400
    cursorAccent: "#000000",
    selectionBackground: "#14532d", // green-900
    black: "#000000",
    red: "#ff5555",
    green: "#4ade80",
    yellow: "#f0e68c",
    blue: "#4ade80",
    magenta: "#86efac",
    cyan: "#22c55e",
    white: "#4ade80",
    brightBlack: "#166534",
    brightRed: "#ff6e6e",
    brightGreen: "#86efac",
    brightYellow: "#fef08a",
    brightBlue: "#86efac",
    brightMagenta: "#bbf7d0",
    brightCyan: "#4ade80",
    brightWhite: "#dcfce7",
  },

  midnight: {
    background: "#020617",     // slate-950
    foreground: "#e2e8f0",     // slate-200
    cursor: "#818cf8",         // indigo-400
    cursorAccent: "#020617",
    selectionBackground: "#312e81", // indigo-900
    black: "#0f172a",
    red: "#f87171",
    green: "#34d399",
    yellow: "#fbbf24",
    blue: "#818cf8",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#e2e8f0",
    brightBlack: "#64748b",
    brightRed: "#fca5a5",
    brightGreen: "#6ee7b7",
    brightYellow: "#fde68a",
    brightBlue: "#a5b4fc",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#f8fafc",
  },

  highContrast: {
    background: "#000000",     // black
    foreground: "#ffffff",     // white
    cursor: "#ffffff",         // white
    cursorAccent: "#000000",
    selectionBackground: "#444444",
    black: "#000000",
    red: "#ff0000",
    green: "#00ff00",
    yellow: "#ffff00",
    blue: "#5c5cff",
    magenta: "#ff00ff",
    cyan: "#00ffff",
    white: "#ffffff",
    brightBlack: "#808080",
    brightRed: "#ff5555",
    brightGreen: "#55ff55",
    brightYellow: "#ffff55",
    brightBlue: "#7777ff",
    brightMagenta: "#ff55ff",
    brightCyan: "#55ffff",
    brightWhite: "#ffffff",
  },
};