// ============================================================
// screenControlService.ts
// ============================================================
// Frontend service layer for desktop app control.
// Wraps Tauri invoke() calls to the Rust screen_control module.
//
// Used by:
// - toolService.ts (AI tool execution)
// - AssistantChatArea.tsx (screenshot→AI→action loop)
// - ScreenControlSettings.tsx (settings)

import { invoke } from "@tauri-apps/api/core";

// ── Types ─────────────────────────────────────────────────────

export interface ScreenshotResult {
  base64: string;
  width: number;
  height: number;
  mime_type: string;
}

export interface ActiveWindow {
  app_name: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenSize {
  width: number;
  height: number;
}

export interface MonitorInfo {
  index: number;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  is_primary: boolean;
}

export interface ShortcutEntry {
  name: string;       // "Photoshop" (filename without extension)
  path: string;       // full path to the .lnk / .exe file
  extension: string;  // "lnk", "exe", "url"
}

/** Parsed action from AI response */
export interface ScreenAction {
  type: "CLICK" | "DOUBLE_CLICK" | "RIGHT_CLICK" | "TYPE" | "KEY" | "SCROLL" | "DRAG" | "WAIT" | "DONE" | "FAIL" | "MOVE";
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  text?: string;
  combo?: string;
  direction?: string;
  amount?: number;
  seconds?: number;
  reason?: string;
}

// ── Settings ──────────────────────────────────────────────────

export interface ScreenControlSettings {
  enabled: boolean;
  screenshotQuality: "low" | "medium" | "high";
  actionDelay: number;
  cropToWindow: boolean;
  modelPreference: "haiku" | "auto" | "sonnet" | "opus";
  blockedApps: string[];
  killSwitchKey: string;
  confirmSensitive: boolean;
  // Monitor setup
  omnirunMonitor: number;     // which monitor Omnirun lives on (user picks visually)
  // User preferences
  userContext: string;
  appNotes: string;
  folders: { label: string; path: string }[];
  // App shortcuts folder — user drops .lnk / .exe shortcuts here
  shortcutsFolder: string;
}

const DEFAULT_SETTINGS: ScreenControlSettings = {
  enabled: false,
  screenshotQuality: "low",
  actionDelay: 500,
  cropToWindow: true,
  modelPreference: "sonnet",
  blockedApps: [],
  killSwitchKey: "F10",
  confirmSensitive: true,
  omnirunMonitor: 0,
  userContext: "",
  appNotes: "",
  folders: [],
  shortcutsFolder: "",
};

export function loadScreenControlSettings(): ScreenControlSettings {
  try {
    const saved = localStorage.getItem("screen-control-settings");
    if (saved) {
      const parsed = JSON.parse(saved);
      // Migrate old formats
      if (typeof parsed.folders === "string") parsed.folders = [];
      if (!Array.isArray(parsed.folders)) parsed.folders = [];
      if (typeof parsed.shortcutsFolder !== "string") parsed.shortcutsFolder = "";
      if (typeof parsed.omnirunMonitor !== "number") parsed.omnirunMonitor = parsed.selectedMonitor ?? 0;
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveScreenControlSettings(settings: ScreenControlSettings): void {
  localStorage.setItem("screen-control-settings", JSON.stringify(settings));
}

// ── Monitor Helpers ───────────────────────────────────────────
// On dual monitors: Omnirun stays on omnirunMonitor, apps open on the other.
// On single monitor: everything happens on monitor 0, no minimize needed.

export function getAppsMonitorIndex(monitors: MonitorInfo[], omnirunMonitor: number): number {
  if (monitors.length <= 1) return 0;
  // Return the first monitor that isn't the Omnirun monitor
  const other = monitors.find((m) => m.index !== omnirunMonitor);
  return other ? other.index : 0;
}

export function isSingleMonitor(monitors: MonitorInfo[]): boolean {
  return monitors.length <= 1;
}

// ── Screenshot ────────────────────────────────────────────────

export async function takeScreenshot(
  cropToWindow: boolean = true,
  quality: string = "low",
  monitorIndex?: number,
): Promise<ScreenshotResult> {
  const settings = loadScreenControlSettings();
  return invoke<ScreenshotResult>("take_screenshot", {
    monitorIndex: monitorIndex ?? settings.omnirunMonitor,
    cropToWindow,
    quality,
  });
}

// ── Monitor Enumeration ───────────────────────────────────────

export async function listMonitors(): Promise<MonitorInfo[]> {
  return invoke<MonitorInfo[]>("list_monitors");
}

// ── Mouse Actions ─────────────────────────────────────────────

export async function screenClick(x: number, y: number): Promise<void> {
  return invoke("screen_click", { x, y });
}

export async function screenDoubleClick(x: number, y: number): Promise<void> {
  return invoke("screen_double_click", { x, y });
}

export async function screenRightClick(x: number, y: number): Promise<void> {
  return invoke("screen_right_click", { x, y });
}

export async function screenMouseMove(x: number, y: number): Promise<void> {
  return invoke("screen_mouse_move", { x, y });
}

export async function screenDrag(x1: number, y1: number, x2: number, y2: number): Promise<void> {
  return invoke("screen_drag", { x1, y1, x2, y2 });
}

// ── Scroll ────────────────────────────────────────────────────

export async function screenScroll(direction: string, amount: number = 3): Promise<void> {
  return invoke("screen_scroll", { direction, amount });
}

// ── Keyboard ──────────────────────────────────────────────────

export async function screenType(text: string): Promise<void> {
  return invoke("screen_type", { text });
}

export async function screenKey(combo: string): Promise<void> {
  return invoke("screen_key", { combo });
}

// ── Window & Screen Info ──────────────────────────────────────

export async function getActiveWindow(): Promise<ActiveWindow> {
  return invoke<ActiveWindow>("get_active_window");
}

export async function getScreenSize(monitorIndex?: number): Promise<ScreenSize> {
  const settings = loadScreenControlSettings();
  return invoke<ScreenSize>("get_screen_size", { monitorIndex: monitorIndex ?? settings.omnirunMonitor });
}

// ── Action Parser ─────────────────────────────────────────────

export function parseScreenAction(aiResponse: string): ScreenAction | null {
  const actions = parseAllScreenActions(aiResponse);
  return actions.length > 0 ? actions[0] : null;
}

export function parseAllScreenActions(aiResponse: string): ScreenAction[] {
  const lines = aiResponse.trim().split("\n");
  const actions: ScreenAction[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const clean = line.replace(/\*\*/g, "").replace(/`/g, "").trim();
    const actionLine = clean.replace(/^Action:\s*/i, "").trim();
    const subActions = splitCompoundAction(actionLine);

    for (const sub of subActions) {
      const clickMatch = sub.match(/^CLICK\s+(\d+)[,\s]+(\d+)$/i);
      if (clickMatch) { actions.push({ type: "CLICK", x: parseInt(clickMatch[1]), y: parseInt(clickMatch[2]) }); continue; }

      const dblClickMatch = sub.match(/^DOUBLE_CLICK\s+(\d+)[,\s]+(\d+)$/i);
      if (dblClickMatch) { actions.push({ type: "DOUBLE_CLICK", x: parseInt(dblClickMatch[1]), y: parseInt(dblClickMatch[2]) }); continue; }

      const rightClickMatch = sub.match(/^RIGHT_CLICK\s+(\d+)[,\s]+(\d+)$/i);
      if (rightClickMatch) { actions.push({ type: "RIGHT_CLICK", x: parseInt(rightClickMatch[1]), y: parseInt(rightClickMatch[2]) }); continue; }

      const typeMatch = sub.match(/^TYPE\s+(.+)$/i);
      if (typeMatch) { actions.push({ type: "TYPE", text: typeMatch[1] }); continue; }

      const keyMatch = sub.match(/^KEY\s+(.+)$/i);
      if (keyMatch) { actions.push({ type: "KEY", combo: keyMatch[1].trim() }); continue; }

      const scrollMatch = sub.match(/^SCROLL\s+(up|down|left|right)\s*(\d*)$/i);
      if (scrollMatch) { actions.push({ type: "SCROLL", direction: scrollMatch[1].toLowerCase(), amount: scrollMatch[2] ? parseInt(scrollMatch[2]) : 3 }); continue; }

      const dragMatch = sub.match(/^DRAG\s+(\d+)[,\s]+(\d+)[,\s]+(\d+)[,\s]+(\d+)$/i);
      if (dragMatch) { actions.push({ type: "DRAG", x: parseInt(dragMatch[1]), y: parseInt(dragMatch[2]), x2: parseInt(dragMatch[3]), y2: parseInt(dragMatch[4]) }); continue; }

      const waitMatch = sub.match(/^WAIT\s+(\d+)$/i);
      if (waitMatch) { actions.push({ type: "WAIT", seconds: parseInt(waitMatch[1]) }); continue; }

      if (/^DONE$/i.test(sub)) { actions.push({ type: "DONE" }); continue; }

      const failMatch = sub.match(/^FAIL\s+(.+)$/i);
      if (failMatch) { actions.push({ type: "FAIL", reason: failMatch[1] }); continue; }
    }
  }

  return actions;
}

function splitCompoundAction(line: string): string[] {
  const parts = line.split(/\s+(?=(?:CLICK|DOUBLE_CLICK|RIGHT_CLICK|TYPE|KEY|SCROLL|DRAG|WAIT|DONE|FAIL)\s)/i);
  return parts.map(p => p.trim()).filter(Boolean);
}

// ── Action Executor ───────────────────────────────────────────

export async function executeScreenAction(action: ScreenAction): Promise<string> {
  switch (action.type) {
    case "CLICK":
      await screenClick(action.x!, action.y!);
      return `Clicked at (${action.x}, ${action.y})`;
    case "DOUBLE_CLICK":
      await screenDoubleClick(action.x!, action.y!);
      return `Double-clicked at (${action.x}, ${action.y})`;
    case "RIGHT_CLICK":
      await screenRightClick(action.x!, action.y!);
      return `Right-clicked at (${action.x}, ${action.y})`;
    case "TYPE":
      await screenType(action.text!);
      return `Typed: "${action.text!.slice(0, 50)}${action.text!.length > 50 ? "..." : ""}"`;
    case "KEY":
      await screenKey(action.combo!);
      return `Pressed: ${action.combo}`;
    case "SCROLL":
      await screenScroll(action.direction!, action.amount ?? 3);
      return `Scrolled ${action.direction} ${action.amount ?? 3} ticks`;
    case "DRAG":
      await screenDrag(action.x!, action.y!, action.x2!, action.y2!);
      return `Dragged from (${action.x}, ${action.y}) to (${action.x2}, ${action.y2})`;
    case "WAIT":
      await new Promise((resolve) => setTimeout(resolve, (action.seconds ?? 1) * 1000));
      return `Waited ${action.seconds} seconds`;
    case "DONE":
      return "Task complete";
    case "FAIL":
      return `Failed: ${action.reason}`;
    default:
      return `Unknown action: ${action.type}`;
  }
}

// ── Shortcuts Folder Scanning ─────────────────────────────────
// User creates a folder, drops .lnk / .exe shortcuts into it.
// We scan that folder to know what apps are launchable.

export async function scanShortcutsFolder(): Promise<ShortcutEntry[]> {
  const settings = loadScreenControlSettings();
  if (!settings.shortcutsFolder) return [];
  try {
    return await invoke<ShortcutEntry[]>("scan_shortcuts_folder", { folder: settings.shortcutsFolder });
  } catch {
    return [];
  }
}

// ── App Launch Matcher ────────────────────────────────────────
// Given "open photoshop and resize image", scans the shortcuts folder
// for a matching .lnk, returns the path to launch.
// Returns null if no match — AI handles it visually instead.

export async function matchAppFromShortcuts(
  instruction: string
): Promise<{ name: string; path: string; fileArg?: string } | null> {
  // Only match if instruction has an "open" intent
  const openMatch = instruction.match(/(?:open|launch|start|run|play)\s+(.+)/i);
  if (!openMatch) return null;

  const rest = openMatch[1].toLowerCase();

  // Scan shortcuts folder
  const shortcuts = await scanShortcutsFolder();
  if (shortcuts.length === 0) return null;

  // Try to match: check if any shortcut name appears in the instruction
  // "open photoshop" matches "Adobe Photoshop.lnk" because "photoshop" is in the name
  let bestMatch: ShortcutEntry | null = null;
  let bestScore = 0;

  for (const shortcut of shortcuts) {
    const shortcutLower = shortcut.name.toLowerCase();
    const shortcutWords = shortcutLower.split(/[\s\-_]+/);

    // Exact full name match (highest priority)
    if (rest.includes(shortcutLower)) {
      bestMatch = shortcut;
      bestScore = 100;
      break;
    }

    // Word match: count how many words from the shortcut name appear in the instruction
    let wordHits = 0;
    for (const word of shortcutWords) {
      if (word.length >= 3 && rest.includes(word)) {
        wordHits++;
      }
    }

    // At least one significant word must match
    if (wordHits > 0) {
      const score = wordHits * 10 + (shortcutLower.length > 5 ? 5 : 0);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = shortcut;
      }
    }
  }

  if (!bestMatch) return null;

  // Check if instruction also mentions a folder
  const settings = loadScreenControlSettings();
  const fileArg = matchFolderArg(instruction, settings);

  return { name: bestMatch.name, path: bestMatch.path, fileArg };
}

// Try to match a folder reference in the instruction
function matchFolderArg(instruction: string, settings: ScreenControlSettings): string | undefined {
  const lower = instruction.toLowerCase();

  // Direct folder label match
  for (const folder of settings.folders) {
    if (lower.includes(folder.label.toLowerCase())) {
      return folder.path;
    }
  }

  // Common keywords → folder labels
  const keywordMap: Record<string, string> = {
    "music": "Music", "song": "Music", "songs": "Music",
    "video": "Videos", "videos": "Videos", "movie": "Videos",
    "document": "Documents", "documents": "Documents",
    "download": "Downloads", "downloads": "Downloads",
    "picture": "Pictures", "pictures": "Pictures", "photo": "Pictures", "photos": "Pictures",
    "project": "Projects", "projects": "Projects",
  };

  for (const [keyword, folderLabel] of Object.entries(keywordMap)) {
    if (lower.includes(keyword)) {
      const folder = settings.folders.find((f) => f.label === folderLabel);
      if (folder) return folder.path;
    }
  }

  return undefined;
}

// ── User Context Builder ──────────────────────────────────────

export function buildUserContextPrompt(): string {
  const settings = loadScreenControlSettings();
  const parts: string[] = [];

  if (settings.userContext.trim()) {
    parts.push(`User setup: ${settings.userContext.trim()}`);
  }
  if (settings.appNotes.trim()) {
    parts.push(`App notes: ${settings.appNotes.trim()}`);
  }
  if (settings.folders.length > 0) {
    const folderLines = settings.folders.map((f) => `${f.label}: ${f.path}`).join(", ");
    parts.push(`Key folders: ${folderLines}`);
  }

  if (parts.length === 0) return "";
  return "\nUser preferences:\n" + parts.join("\n") + "\n";
}

// ── Blocked App Check ─────────────────────────────────────────

export async function isBlockedApp(): Promise<{ blocked: boolean; appName: string }> {
  const settings = loadScreenControlSettings();
  if (settings.blockedApps.length === 0) {
    return { blocked: false, appName: "" };
  }

  try {
    const win = await getActiveWindow();
    const appLower = win.app_name.toLowerCase();
    const blocked = settings.blockedApps.some(
      (b) => appLower.includes(b.toLowerCase())
    );
    return { blocked, appName: win.app_name };
  } catch {
    return { blocked: false, appName: "" };
  }
}

// ── App Launch ────────────────────────────────────────────────

export async function launchApp(app: string, file?: string): Promise<string> {
  return invoke<string>("launch_app", { app, file: file ?? null });
}

// ── Playlist Creator ──────────────────────────────────────────

export async function createPlaylist(folder: string, outputPath?: string): Promise<string> {
  return invoke<string>("create_playlist", { folder, outputPath: outputPath ?? null });
}

// ── Minimize Self ─────────────────────────────────────────────

export async function minimizeSelf(): Promise<void> {
  return invoke("minimize_self");
}

// ── Browser Detection ─────────────────────────────────────────

const BROWSER_APPS = [
  "chrome", "firefox", "safari", "edge", "msedge", "brave",
  "opera", "vivaldi", "chromium", "arc",
];

export async function isActiveBrowser(): Promise<boolean> {
  try {
    const win = await getActiveWindow();
    const appLower = win.app_name.toLowerCase();
    return BROWSER_APPS.some((b) => appLower.includes(b));
  } catch {
    return false;
  }
}