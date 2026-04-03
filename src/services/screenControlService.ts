// ============================================================
// screenControlService.ts
// ============================================================
// Frontend service layer for desktop app control.
// Wraps Tauri invoke() calls to the Rust screen_control module.
//
// Used by:
// - toolService.ts (AI tool execution)
// - AssistantChatArea.tsx (screenshot→AI→action loop)
// - ScreenControlSettings.tsx (test actions)

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

// ── Common Apps Registry ──────────────────────────────────────
// Apps that Windows/Mac/Linux can launch by name without a full path.
// Users toggle these on/off — no manual path entry needed.

export interface CommonApp {
  id: string;
  label: string;
  command: string;        // what gets passed to launch_app (e.g. "wmplayer")
  description: string;
  aliases: string[];      // words the user might say to refer to this app
}

export const COMMON_APPS: CommonApp[] = [
  { id: "notepad",    label: "Notepad",               command: "notepad",     description: "Text editor",        aliases: ["notepad", "text editor"] },
  { id: "calc",       label: "Calculator",             command: "calc",        description: "Calculator",         aliases: ["calculator", "calc"] },
  { id: "paint",      label: "Paint",                  command: "mspaint",     description: "Image editor",       aliases: ["paint", "mspaint", "drawing"] },
  { id: "wmplayer",   label: "Windows Media Player",   command: "wmplayer",    description: "Media player",       aliases: ["wmp", "windows media player", "media player", "wmplayer"] },
  { id: "explorer",   label: "File Explorer",          command: "explorer",    description: "File manager",       aliases: ["file explorer", "explorer", "files", "my computer"] },
  { id: "cmd",        label: "Command Prompt",         command: "cmd",         description: "Terminal",           aliases: ["command prompt", "cmd", "terminal", "console"] },
  { id: "powershell", label: "PowerShell",             command: "powershell",  description: "Terminal",           aliases: ["powershell", "ps"] },
  { id: "winword",    label: "Microsoft Word",         command: "winword",     description: "Word processor",     aliases: ["word", "microsoft word", "winword"] },
  { id: "excel",      label: "Microsoft Excel",        command: "excel",       description: "Spreadsheet",        aliases: ["excel", "microsoft excel", "spreadsheet"] },
  { id: "powerpnt",   label: "Microsoft PowerPoint",   command: "powerpnt",    description: "Presentations",      aliases: ["powerpoint", "microsoft powerpoint", "ppt", "slides"] },
  { id: "outlook",    label: "Microsoft Outlook",      command: "outlook",     description: "Email client",       aliases: ["outlook", "microsoft outlook", "email"] },
  { id: "chrome",     label: "Google Chrome",          command: "chrome",      description: "Web browser",        aliases: ["chrome", "google chrome"] },
  { id: "firefox",    label: "Firefox",                command: "firefox",     description: "Web browser",        aliases: ["firefox", "mozilla firefox"] },
  { id: "brave",      label: "Brave",                  command: "brave",       description: "Web browser",        aliases: ["brave", "brave browser"] },
  { id: "spotify",    label: "Spotify",                command: "spotify",     description: "Music streaming",    aliases: ["spotify", "music"] },
  { id: "vlc",        label: "VLC",                    command: "vlc",         description: "Media player",       aliases: ["vlc", "vlc player", "video player"] },
  { id: "code",       label: "VS Code",                command: "code",        description: "Code editor",        aliases: ["vscode", "vs code", "visual studio code", "code editor"] },
];

// ── Settings (read from localStorage, written by ScreenControlSettings) ──

export interface ScreenControlSettings {
  enabled: boolean;
  screenshotQuality: "low" | "medium" | "high";
  actionDelay: number;        // ms between actions (default 500)
  cropToWindow: boolean;      // crop screenshot to active window
  modelPreference: "haiku" | "auto" | "sonnet" | "opus";
  blockedApps: string[];      // apps that screen control should never interact with
  killSwitchKey: string;      // global hotkey to stop (default "F10")
  confirmSensitive: boolean;  // pause on password/payment/send screens
  selectedMonitor: number;    // monitor index (0 = primary/first)
  // User preferences — context injected into every screen control prompt
  userContext: string;        // free-text: display setup, habits, preferences
  appNotes: string;           // free-text: app locations, shortcuts, common workflows
  folders: { label: string; path: string }[]; // labeled folder paths picked via explorer
  // Registered apps — the AI can launch these instantly (no screenshots needed)
  enabledCommonApps: string[];  // IDs from COMMON_APPS that are enabled
  customApps: { label: string; path: string }[];  // user-added apps with full .exe path
}

const DEFAULT_SETTINGS: ScreenControlSettings = {
  enabled: false,
  screenshotQuality: "medium",
  actionDelay: 500,
  cropToWindow: true,
  modelPreference: "opus",
  blockedApps: [],
  killSwitchKey: "F10",
  confirmSensitive: true,
  selectedMonitor: 0,
  userContext: "",
  appNotes: "",
  folders: [],
  enabledCommonApps: ["notepad", "calc", "wmplayer", "explorer", "chrome", "excel", "spotify"],
  customApps: [],
};

export function loadScreenControlSettings(): ScreenControlSettings {
  try {
    const saved = localStorage.getItem("screen-control-settings");
    if (saved) {
      const parsed = JSON.parse(saved);
      // Migrate: old format had folders as a string, new format is array
      if (typeof parsed.folders === "string") {
        parsed.folders = [];
      }
      if (!Array.isArray(parsed.folders)) {
        parsed.folders = [];
      }
      // Migrate: add new fields if missing
      if (!Array.isArray(parsed.enabledCommonApps)) {
        parsed.enabledCommonApps = DEFAULT_SETTINGS.enabledCommonApps;
      }
      if (!Array.isArray(parsed.customApps)) {
        parsed.customApps = [];
      }
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

// ── Screenshot ────────────────────────────────────────────────

export async function takeScreenshot(
  cropToWindow: boolean = true,
  quality: string = "medium"
): Promise<ScreenshotResult> {
  const settings = loadScreenControlSettings();
  return invoke<ScreenshotResult>("take_screenshot", {
    monitorIndex: settings.selectedMonitor,
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

export async function getScreenSize(): Promise<ScreenSize> {
  const settings = loadScreenControlSettings();
  return invoke<ScreenSize>("get_screen_size", { monitorIndex: settings.selectedMonitor });
}

// ── Action Parser ─────────────────────────────────────────────

export function parseScreenAction(aiResponse: string): ScreenAction | null {
  const actions = parseAllScreenActions(aiResponse);
  return actions.length > 0 ? actions[0] : null;
}

/** Parse ALL action lines from an AI response. Supports batching. */
export function parseAllScreenActions(aiResponse: string): ScreenAction[] {
  const lines = aiResponse.trim().split("\n");
  const actions: ScreenAction[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    // Strip markdown bold/formatting
    const clean = line.replace(/\*\*/g, "").replace(/`/g, "").trim();

    // Match: Action: CLICK x y  OR just  CLICK x y
    const actionLine = clean.replace(/^Action:\s*/i, "").trim();

    // Handle compound lines like "TYPE hello KEY enter" — split on known action keywords
    const subActions = splitCompoundAction(actionLine);
    
    for (const sub of subActions) {
      const clickMatch = sub.match(/^CLICK\s+(\d+)[,\s]+(\d+)$/i);
      if (clickMatch) {
        actions.push({ type: "CLICK", x: parseInt(clickMatch[1]), y: parseInt(clickMatch[2]) });
        continue;
      }

      const dblClickMatch = sub.match(/^DOUBLE_CLICK\s+(\d+)[,\s]+(\d+)$/i);
      if (dblClickMatch) {
        actions.push({ type: "DOUBLE_CLICK", x: parseInt(dblClickMatch[1]), y: parseInt(dblClickMatch[2]) });
        continue;
      }

      const rightClickMatch = sub.match(/^RIGHT_CLICK\s+(\d+)[,\s]+(\d+)$/i);
      if (rightClickMatch) {
        actions.push({ type: "RIGHT_CLICK", x: parseInt(rightClickMatch[1]), y: parseInt(rightClickMatch[2]) });
        continue;
      }

      const typeMatch = sub.match(/^TYPE\s+(.+)$/i);
      if (typeMatch) {
        actions.push({ type: "TYPE", text: typeMatch[1] });
        continue;
      }

      const keyMatch = sub.match(/^KEY\s+(.+)$/i);
      if (keyMatch) {
        actions.push({ type: "KEY", combo: keyMatch[1].trim() });
        continue;
      }

      const scrollMatch = sub.match(/^SCROLL\s+(up|down|left|right)\s*(\d*)$/i);
      if (scrollMatch) {
        actions.push({ type: "SCROLL", direction: scrollMatch[1].toLowerCase(), amount: scrollMatch[2] ? parseInt(scrollMatch[2]) : 3 });
        continue;
      }

      const dragMatch = sub.match(/^DRAG\s+(\d+)[,\s]+(\d+)[,\s]+(\d+)[,\s]+(\d+)$/i);
      if (dragMatch) {
        actions.push({ type: "DRAG", x: parseInt(dragMatch[1]), y: parseInt(dragMatch[2]), x2: parseInt(dragMatch[3]), y2: parseInt(dragMatch[4]) });
        continue;
      }

      const waitMatch = sub.match(/^WAIT\s+(\d+)$/i);
      if (waitMatch) {
        actions.push({ type: "WAIT", seconds: parseInt(waitMatch[1]) });
        continue;
      }

      if (/^DONE$/i.test(sub)) {
        actions.push({ type: "DONE" });
        continue;
      }

      const failMatch = sub.match(/^FAIL\s+(.+)$/i);
      if (failMatch) {
        actions.push({ type: "FAIL", reason: failMatch[1] });
        continue;
      }
    }
  }

  return actions;
}

/** Split a compound action line like "TYPE hello KEY enter" into separate actions */
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

// ── User Context Builder ──────────────────────────────────────
// Builds a context string from user preferences to inject into screen control prompts.

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

  // Include registered apps so AI knows what's available for instant launch
  const registeredApps = getRegisteredApps();
  if (registeredApps.length > 0) {
    const appLines = registeredApps.map((a) => `${a.label} (command: ${a.command})`).join(", ");
    parts.push(`Registered apps (can be launched instantly): ${appLines}`);
  }

  if (parts.length === 0) return "";
  return "\nUser preferences:\n" + parts.join("\n") + "\n";
}

// ── Registered Apps Helper ────────────────────────────────────
// Returns the full list of launchable apps (common + custom).

export function getRegisteredApps(): { label: string; command: string }[] {
  const settings = loadScreenControlSettings();
  const apps: { label: string; command: string }[] = [];

  // Add enabled common apps
  for (const id of settings.enabledCommonApps) {
    const common = COMMON_APPS.find((a) => a.id === id);
    if (common) {
      apps.push({ label: common.label, command: common.command });
    }
  }

  // Add custom apps
  for (const custom of settings.customApps) {
    if (custom.label && custom.path) {
      apps.push({ label: custom.label, command: custom.path });
    }
  }

  return apps;
}

// ── App Launch Matcher ────────────────────────────────────────
// Given a user instruction like "open WMP and play my music",
// tries to match an app from the registry and returns the launch command.
// Returns null if no match found (AI handles it visually instead).

export function matchAppLaunch(instruction: string): { label: string; command: string; fileArg?: string } | null {
  const settings = loadScreenControlSettings();
  const lower = instruction.toLowerCase();

  // Only match if instruction starts with an "open" intent
  const openMatch = lower.match(/(?:open|launch|start|run)\s+(.+)/i);
  if (!openMatch) return null;

  const rest = openMatch[1];

  // Check enabled common apps (match by alias)
  for (const id of settings.enabledCommonApps) {
    const common = COMMON_APPS.find((a) => a.id === id);
    if (!common) continue;

    for (const alias of common.aliases) {
      if (rest.includes(alias)) {
        // Check if user also mentioned a folder
        const fileArg = matchFolderArg(instruction, settings);
        return { label: common.label, command: common.command, fileArg };
      }
    }
  }

  // Check custom apps (match by label)
  for (const custom of settings.customApps) {
    if (rest.includes(custom.label.toLowerCase())) {
      const fileArg = matchFolderArg(instruction, settings);
      return { label: custom.label, command: custom.path, fileArg };
    }
  }

  return null;
}

// Try to match a folder reference in the instruction (e.g. "play my music" → Music folder path)
function matchFolderArg(instruction: string, settings: ScreenControlSettings): string | undefined {
  const lower = instruction.toLowerCase();

  // Direct folder label match
  for (const folder of settings.folders) {
    if (lower.includes(folder.label.toLowerCase())) {
      return folder.path;
    }
  }

  // Common keyword → folder label mapping
  const keywordMap: Record<string, string> = {
    "music": "Music",
    "video": "Videos",
    "document": "Documents",
    "download": "Downloads",
    "picture": "Pictures",
    "photo": "Pictures",
    "project": "Projects",
  };

  for (const [keyword, folderLabel] of Object.entries(keywordMap)) {
    if (lower.includes(keyword)) {
      const folder = settings.folders.find((f) => f.label === folderLabel);
      if (folder) return folder.path;
    }
  }

  return undefined;
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

// ── App Launch (scripted pre-step — no AI needed) ─────────────

export async function launchApp(app: string, file?: string): Promise<string> {
  return invoke<string>("launch_app", { app, file: file ?? null });
}

// ── Minimize Self (get Omnirun out of the way) ────────────────

export async function minimizeSelf(): Promise<void> {
  return invoke("minimize_self");
}

// ── Browser Detection (for auto-routing to Playwright) ────────

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