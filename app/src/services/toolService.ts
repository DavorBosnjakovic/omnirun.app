import { readFile, writeFile, readDirectory, createDirectory, deletePath, FileEntry } from "./fileService";
import { updateManifestEntry, removeManifestEntry, getRelativePath, ProjectManifest } from "./manifestService";
import { executeConnectionTool, connectionToolPrompt, buildConnectionToolPrompt } from "./connectionTool";
import { deployProject, pickDefaultProvider, listConnectedDeployProviders } from "./deploymentService";
import { useProjectStore } from "../stores/projectStore";
import { useDeployStore } from "../stores/deployStore";
import { webSearch, formatResultsForAI } from "./webSearchService";
import { updateContextFromAI, VALID_SECTIONS, type ContextSection, type ProjectContext as ContextData } from "./contextService";
import { createTask } from "../stores/taskStore";
import { useSettingsStore } from "../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";
import {
  takeScreenshot,
  screenClick,
  screenDoubleClick,
  screenRightClick,
  screenType,
  screenKey,
  screenScroll,
  screenDrag,
  getActiveWindow,
  getScreenSize,
  loadScreenControlSettings,
  parseScreenAction,
  executeScreenAction,
  isBlockedApp,
} from "./screenControlService";

// Blocklist: directories/files that should never be read or listed
const BLOCKLIST = [
  "node_modules", "dist", "build", ".git", ".next", "coverage",
  "__pycache__", ".venv", "target", "vendor", ".omnirun/snapshots",
  ".DS_Store",
];
const BLOCKLIST_EXTENSIONS = [".lock", ".log"];

function isBlocklisted(name: string): boolean {
  if (BLOCKLIST.includes(name)) return true;
  return BLOCKLIST_EXTENSIONS.some(ext => name.endsWith(ext));
}

// ── SECURITY: Sensitive File Protection (Section 4) ────────────

const SENSITIVE_FILES = [
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  ".env.staging",
  ".env.test",
  ".gitconfig",
  ".npmrc",
  ".yarnrc",
  "id_rsa",
  "id_ed25519",
  ".ssh",
  "credentials",
  "secrets",
  ".aws",
  "serviceAccountKey.json",
  "firebase-adminsdk",
];

const SENSITIVE_EXTENSIONS = [
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".keystore",
];

function isSensitiveFile(path: string): boolean {
  const name = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() || "";
  if (SENSITIVE_FILES.some(s => name === s || name.startsWith(s))) return true;
  if (SENSITIVE_EXTENSIONS.some(ext => name.endsWith(ext))) return true;
  return false;
}

// ── SECURITY: Command Execution Safety (Section 2) ─────────────

const BLOCKED_COMMANDS: RegExp[] = [
  // Destructive
  /\brm\s+(-rf|-r)\s+[/\\]/i,
  /\bdel\s+\/s/i,
  /\brmdir\s+\/s/i,
  /\bformat\b/i,
  /\bfdisk\b/i,
  /\bmkfs\b/i,

  // System manipulation
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\breg\s+(add|delete)/i,
  /\bnet\s+(user|localgroup)/i,
  /\bschtasks\b/i,
  /\bsc\s+(create|delete|config)/i,

  // Data exfiltration
  /\bcurl\b.*\|/i,
  /\bwget\b.*\|/i,
  /\bnc\s+-/i,
  /\bscp\b/i,
  /\bftp\b/i,

  // Encoded/obfuscated execution
  /powershell.*-enc/i,
  /powershell.*-e\s/i,
  /\bbase64\b.*\|\s*(bash|sh|cmd)/i,
  /\beval\b/i,

  // Privilege escalation
  /\bsudo\b/i,
  /\brunas\b/i,
  /\bchmod\s+[0-7]*s/i,
  /\bchown\b/i,

  // Crypto/mining
  /\bxmrig\b/i,
  /\bminerd\b/i,
  /\bcpuminer\b/i,
];

const CD_ESCAPE_PATTERNS: RegExp[] = [
  /\bcd\s+[/\\]/i,
  /\bcd\s+\w:\\/i,
  /\bcd\s+\.\.\//i,
  /\bpushd\s+[/\\]/i,
];

function isCommandBlocked(command: string): string | null {
  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(command)) {
      return `BLOCKED: Command matches dangerous pattern: ${pattern}`;
    }
  }
  for (const pattern of CD_ESCAPE_PATTERNS) {
    if (pattern.test(command)) {
      return `BLOCKED: Command attempts to escape project directory: ${pattern}`;
    }
  }
  return null;
}

// ── SECURITY: File Size Limits (Section 5) ─────────────────────

const MAX_READ_SIZE = 100_000;   // 100KB — ~25k tokens
const MAX_WRITE_SIZE = 500_000;  // 500KB — largest reasonable code file

// ── SECURITY: Rate Limiting (Section 7) ────────────────────────

const RATE_LIMITS: Record<string, { max: number; window: number }> = {
  write_file: { max: 20, window: 60_000 },    // 20 writes per minute
  delete_file: { max: 5, window: 60_000 },     // 5 deletes per minute
  run_command: { max: 10, window: 60_000 },    // 10 commands per minute
  edit_file: { max: 20, window: 60_000 },      // 20 edits per minute
  web_search: { max: 10, window: 60_000 },     // 10 searches per minute
  create_scheduled_task: { max: 5, window: 60_000 }, // 5 task creations per minute
  screen_capture: { max: 30, window: 60_000 },       // 30 screenshots per minute
  screen_action: { max: 50, window: 60_000 },         // 50 actions per minute (safety cap)
};

const toolCallTimestamps: Map<string, number[]> = new Map();

function isRateLimited(toolName: string): string | null {
  const limit = RATE_LIMITS[toolName];
  if (!limit) return null; // No limit for this tool (read_file, list_directory, etc.)

  const now = Date.now();
  const timestamps = toolCallTimestamps.get(toolName) || [];

  // Remove timestamps outside the window
  const recent = timestamps.filter(t => now - t < limit.window);

  if (recent.length >= limit.max) {
    const waitSeconds = Math.ceil((recent[0] + limit.window - now) / 1000);
    return `RATE LIMITED: Too many ${toolName} calls (${limit.max} per minute). Wait ${waitSeconds}s.`;
  }

  // Record this call
  recent.push(now);
  toolCallTimestamps.set(toolName, recent);
  return null;
}

// ── Timeout Helper ─────────────────────────────────────────────
// Prevents Tauri invoke() calls from hanging indefinitely and
// accumulating ghost callbacks that freeze the app.

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout: "${label}" did not respond within ${ms / 1000}s`)),
      ms
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

// ── FIX: XML Entity Unescaping ─────────────────────────────────
// When AI writes HTML inside XML tool tags, entities like &lt; &gt; &amp;
// must be converted back to < > & before writing to disk.

function unescapeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ── SECURITY: File Content Sanitization (Section 3) ────────────

function sanitizeFileContent(path: string, content: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext || !["html", "htm"].includes(ext)) return content;

  let cleaned = content;

  // Unescape XML entities (safety net for HTML written inside XML tool calls)
  if (cleaned.includes("&lt;") || cleaned.includes("&gt;")) {
    cleaned = unescapeXmlEntities(cleaned);
  }

  // Replace \" with " (common XML artifact)
  cleaned = cleaned.replace(/\\"/g, '"');

  // Replace \/ with / (another common one)
  cleaned = cleaned.replace(/\\\//g, '/');

  return cleaned;
}

// ── Tool Definitions ───────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: string;
}

export const AVAILABLE_TOOLS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read the contents of a file. Use this to inspect code, configs, or any text file in the project.",
    parameters: '{"path": "relative/path/to/file"}',
  },
  {
    name: "edit_file",
    description: "Modify an existing file with one or more targeted edits. Pass a single search/replace pair, OR an `edits` array for multiple changes in one call. Each search string must match exactly once. Edits apply in order. ALWAYS use this for changes to existing files — never rewrite a file to change a few lines.",
    parameters: '{"path": "relative/path/to/file", "edits": [{"search": "old text 1", "replace": "new text 1"}, {"search": "old text 2", "replace": "new text 2"}]}',
  },
  {
    name: "write_file",
    description: "Create a NEW file. Do not use on existing files unless doing a full top-to-bottom restructure (rare). For any change to an existing file, use edit_file instead — even if there are multiple changes. Always provide complete content for new files.",
    parameters: '{"path": "relative/path/to/file", "content": "full file content here"}',
  },
  {
    name: "list_directory",
    description: "List files and subdirectories in a directory. Returns names, types, and sizes.",
    parameters: '{"path": "relative/path/to/dir"}',
  },
  {
    name: "create_directory",
    description: "Create a new directory (including parent directories if needed).",
    parameters: '{"path": "relative/path/to/new/dir"}',
  },
  {
    name: "delete_file",
    description: "Delete a file or directory.",
    parameters: '{"path": "relative/path/to/file"}',
  },
  {
    name: "read_multiple_files",
    description: "Read multiple files at once. More efficient than multiple read_file calls.",
    parameters: '{"paths": ["path/to/file1", "path/to/file2"]}',
  },
  {
    name: "run_command",
    description: "Run a shell command in the project directory. Use for: running scripts (python, node), running tests, building projects, or any CLI task. Do NOT use for npm install, npm run dev, npm start, or similar — the app handles dependency installation and dev servers automatically. Returns stdout, stderr, and exit code. Be cautious with destructive commands — confirm with the user first.",
    parameters: '{"command": "npm test"}',
  },
  {
    name: "web_search",
    description: "Search the web for documentation, error solutions, API references, tutorials, or current information. Use when you need external knowledge to solve a problem. Returns titles, URLs, and snippets.",
    parameters: '{"query": "react useEffect cleanup function"}',
  },
  {
    name: "connection",
    description: "Interact with connected external services (Vercel, GitHub, Supabase, Cloudflare). Specify provider, action, and parameters.",
    parameters: '{"provider": "vercel", "action": "list_projects", "params": {}}',
  },
  {
    name: "deploy",
    description: "Deploy the current project directly to a hosting provider (Vercel, Netlify, or Cloudflare Pages). Reads the project folder, uploads files, creates the deployment, and returns the live URL. If provider is omitted, auto-picks the first connected deploy provider. DO NOT deploy via github.put_file — this tool deploys DIRECTLY without GitHub. For Cloudflare Pages deploys, pass cloudflareAccountId.",
    parameters: '{"provider": "vercel", "projectName": "my-bakery"}',
  },
  {
    name: "write_context",
    description: "Save project knowledge that persists across conversations. Sections: 'about' (product description, audience, flows, business rules, status — REPLACE), 'styles' (colors as hex, fonts, spacing, border-radius, shadows, animations, layout patterns, responsive rules, dark/light mode, component styling — REPLACE), 'conventions' (coding patterns, naming rules, file structure — REPLACE), 'routes' (API endpoints and page routes — REPLACE), 'schema' (database tables/columns/relationships — REPLACE), 'progress' (current work in progress — REPLACE), 'decisions' (architectural choices — APPEND), 'preferences' (user workflow preferences — APPEND), 'built' (completed features — APPEND). IMPORTANT: On first interaction with a new project, ASK the user about the product (about), visual design (styles), and coding patterns (conventions). Gather this info, save it, and never ask again.",
    parameters: '{"section": "styles", "entries": ["Theme: dark", "Primary: #8b5cf6 (purple)", "Secondary: #1e1e2e", "Accent: #22d3ee (cyan)", "Background: #0a0a0f", "Text: #f5f5f7", "Fonts: Inter (body), Space Grotesk (headings)", "Border-radius: 12px cards, 8px buttons, 6px inputs", "Shadows: 0 4px 24px rgba(0,0,0,0.3)", "Animations: framer-motion, 200ms transitions", "Layout: max-w-7xl centered, 24px gap grid", "Responsive: mobile-first, bottom tab nav on mobile"]}',
  },
  {
    name: "create_scheduled_task",
    description: "Create a scheduled task that runs automatically on a schedule. Set scope to 'project' (default) for project tasks or 'assistant' for personal/global tasks (email, calendar, etc). For simple tasks, just provide a command. For multi-step tasks, provide a steps array with executor ('local' or 'web') and action objects. Action types — local: run_command, backup_files, git_commit, git_push, run_script, delete_files. Web: http_request, send_webhook.",
    parameters: '{"name": "Nightly Backup", "description": "Back up src folder every night", "schedule": "Every day at 2:00 AM", "cron_expression": "0 2 * * *", "scope": "project", "command": "cp -r ./src ./backups/src_backup"}',
  },
  // ── Screen Control Tools (Desktop App Control) ──────────────
  {
    name: "screen_capture",
    description: "Take a screenshot of the current screen or active window. Returns the image for analysis. Use this to see what's on screen before performing actions.",
    parameters: '{"crop_to_window": true}',
  },
  {
    name: "screen_action",
    description: "Perform a mouse or keyboard action on the screen. Types: CLICK x y, DOUBLE_CLICK x y, RIGHT_CLICK x y, TYPE text, KEY combo (e.g. ctrl+s), SCROLL direction amount (up/down/left/right), DRAG x1 y1 x2 y2, WAIT seconds. Coordinates are pixel positions from the screenshot.",
    parameters: '{"action": "CLICK", "x": 450, "y": 230}',
  },
  {
    name: "screen_info",
    description: "Get info about the active window (app name, title, dimensions) and screen size. Use before screen_capture to understand context.",
    parameters: '{}',
  },
];

// ── Tool name aliases (XML tags → canonical names) ─────────────

const XML_TOOL_NAME_MAP: Record<string, string> = {
  // Canonical names
  read_file: "read_file",
  write_file: "write_file",
  edit_file: "edit_file",
  list_directory: "list_directory",
  create_directory: "create_directory",
  delete_file: "delete_file",
  read_multiple_files: "read_multiple_files",
  run_command: "run_command",
  connection: "connection",
  // Web search aliases
  web_search: "web_search",
  search_web: "web_search",
  search: "web_search",
  internet_search: "web_search",
  google: "web_search",
  lookup: "web_search",
  // Context tool aliases
  write_context: "write_context",
  save_context: "write_context",
  update_context: "write_context",
  note: "write_context",
  remember: "write_context",
  // Scheduled task aliases
  create_scheduled_task: "create_scheduled_task",
  schedule_task: "create_scheduled_task",
  create_task: "create_scheduled_task",
  add_task: "create_scheduled_task",
  new_task: "create_scheduled_task",
  // Common aliases models might use
  create_file: "write_file",
  new_file: "write_file",
  make_file: "write_file",
  save_file: "write_file",
  cat: "read_file",
  get_file: "read_file",
  view_file: "read_file",
  make_directory: "create_directory",
  mkdir: "create_directory",
  new_directory: "create_directory",
  remove_file: "delete_file",
  rm: "delete_file",
  ls: "list_directory",
  list_dir: "list_directory",
  execute_command: "run_command",
  exec: "run_command",
  shell: "run_command",
  bash: "run_command",
  run: "run_command",
  terminal: "run_command",
  str_replace: "edit_file",
  find_replace: "edit_file",
  search_replace: "edit_file",
  replace_in_file: "edit_file",
  patch_file: "edit_file",
  modify_file: "edit_file",
  // Screen control aliases
  screen_capture: "screen_capture",
  take_screenshot: "screen_capture",
  screenshot: "screen_capture",
  capture_screen: "screen_capture",
  screen_action: "screen_action",
  click: "screen_action",
  type_text: "screen_action",
  press_key: "screen_action",
  screen_info: "screen_info",
  get_active_window: "screen_info",
  window_info: "screen_info",
};

// ── Tool Call Parsing ──────────────────────────────────────────

export interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

export interface ParsedResponse {
  textBefore: string;
  toolCalls: ToolCall[];
  textAfter: string;
  hasToolCalls: boolean;
}

/**
 * Parse AI response for tool calls.
 * Tries <tool_call> JSON format first, then XML-style <tool_name> format as fallback.
 */
export function parseToolCalls(response: string): ParsedResponse {
  // Normalize <function_calls> → <tool_call> (some models use this variant)
  const normalized = response
    .replace(/<function_calls>\s*/g, "<tool_call>")
    .replace(/<\/function_calls>/g, "</tool_call>");

  // ── Strategy 1: <tool_call>{JSON}</tool_call> (Claude, OpenAI, etc.) ──
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const toolCalls: ToolCall[] = [];
  let match;
  let firstMatchIndex = -1;
  let lastMatchEnd = 0;

  while ((match = toolCallRegex.exec(normalized)) !== null) {
    if (firstMatchIndex === -1) {
      firstMatchIndex = match.index;
    }
    lastMatchEnd = match.index + match[0].length;

    const raw = match[1].trim();
    const parsed = parseToolCallContent(raw);
    if (parsed) {
      toolCalls.push(parsed);
    }
  }

  if (toolCalls.length > 0) {
    const textBefore = firstMatchIndex >= 0 ? normalized.slice(0, firstMatchIndex).trim() : normalized;
    const textAfter = lastMatchEnd > 0 ? normalized.slice(lastMatchEnd).trim() : "";
    return { textBefore, toolCalls, textAfter, hasToolCalls: true };
  }

  // ── Strategy 2: XML-style <read_file><path>...</path></read_file> (DeepSeek, etc.) ──
  const xmlResult = parseXmlStyleToolCalls(normalized);
  if (xmlResult.hasToolCalls) {
    return xmlResult;
  }

  // ── No tool calls found ──
  return {
    textBefore: normalized,
    toolCalls: [],
    textAfter: "",
    hasToolCalls: false,
  };
}

/**
 * Parse XML-style tool calls like <read_file><path>styles.css</path></read_file>
 * Handles all known tool names and their aliases.
 */
function parseXmlStyleToolCalls(response: string): ParsedResponse {
  const allTagNames = Object.keys(XML_TOOL_NAME_MAP);
  const toolCalls: ToolCall[] = [];
  let firstMatchIndex = -1;
  let lastMatchEnd = 0;

  // Build a regex that matches any known tool tag name
  // Match: <tool_name>...content...</tool_name>
  const tagPattern = new RegExp(
    `<(${allTagNames.join("|")})>\\s*([\\s\\S]*?)\\s*</\\1>`,
    "g"
  );

  let match;
  while ((match = tagPattern.exec(response)) !== null) {
    const tagName = match[1];
    const innerContent = match[2];
    const canonicalName = XML_TOOL_NAME_MAP[tagName];

    if (!canonicalName) continue;

    if (firstMatchIndex === -1) {
      firstMatchIndex = match.index;
    }
    lastMatchEnd = match.index + match[0].length;

    const args = parseXmlToolArgs(innerContent);
    toolCalls.push({ name: canonicalName, arguments: args });
  }

  if (toolCalls.length === 0) {
    return { textBefore: response, toolCalls: [], textAfter: "", hasToolCalls: false };
  }

  const textBefore = firstMatchIndex >= 0 ? response.slice(0, firstMatchIndex).trim() : "";
  const textAfter = lastMatchEnd > 0 ? response.slice(lastMatchEnd).trim() : "";
  return { textBefore, toolCalls, textAfter, hasToolCalls: true };
}

/**
 * Extract arguments from XML child tags.
 * Input: "<path>styles.css</path>\n<search>color: blue;</search>\n<replace>color: red;</replace>"
 * Output: { path: "styles.css", search: "color: blue;", replace: "color: red;" }
 */
function parseXmlToolArgs(inner: string): Record<string, any> {
  const args: Record<string, any> = {};

  // Match all <param_name>value</param_name> pairs
  const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g;
  let paramMatch;

  while ((paramMatch = paramRegex.exec(inner)) !== null) {
    const key = paramMatch[1];
    let value = paramMatch[2];

    // Trim leading/trailing whitespace and newlines from values
    value = value.replace(/^\s+|\s+$/g, "");

    // Handle "paths" as an array — split by newlines or commas
    if (key === "paths" || key === "files") {
      const items = value
        .split(/[\n,]+/)
        .map((s) => unescapeXmlEntities(s.trim()))
        .filter(Boolean);
      args[key] = items;
    } else {
      args[key] = unescapeXmlEntities(value);
    }
  }

  // If no child tags found, treat the whole inner content as a single value
  // This handles cases like <read_file>styles.css</read_file>
  if (Object.keys(args).length === 0 && inner.trim()) {
    // If it doesn't contain any < chars, treat as a path
    if (!inner.includes("<")) {
      args.path = inner.trim();
    }
  }

  return args;
}

/**
 * Parse XML-structured content found INSIDE <tool_call> tags.
 * Handles: <name>read_file</name><arguments><path>file.css</path></arguments>
 * This is DeepSeek Reasoner's preferred format.
 */
function parseXmlInsideToolCall(raw: string): ToolCall | null {
  const nameMatch = raw.match(/<name>\s*([\w]+)\s*<\/name>/);
  if (!nameMatch) return null;

  const tagName = nameMatch[1];
  const canonicalName = XML_TOOL_NAME_MAP[tagName];
  if (!canonicalName) return null;

  // Extract args from <arguments>...</arguments> wrapper, or directly from raw content
  const argsBlockMatch = raw.match(/<arguments>\s*([\s\S]*?)\s*<\/arguments>/);
  const argsContent = argsBlockMatch ? argsBlockMatch[1] : raw;

  const args = parseXmlToolArgs(argsContent);
  return { name: canonicalName, arguments: args };
}

/**
 * Try multiple strategies to parse a single tool call's content.
 * Returns null only if ALL strategies fail.
 */
function parseToolCallContent(raw: string): ToolCall | null {
  // Strategy 1: Clean JSON then parse
  try {
    const cleaned = cleanJsonString(raw);
    const parsed = JSON.parse(cleaned);
    if (parsed.name) {
      const args = parsed.arguments || {};
      for (const key of Object.keys(parsed)) {
        if (key !== "name" && key !== "arguments") {
          args[key] = parsed[key];
        }
      }
      return { name: parsed.name, arguments: args };
    }
  } catch {
    // Continue to next strategy
  }

  // Strategy 2: Manual regex extraction (handles triple-quotes, malformed JSON)
  const extracted = extractToolCallManually(raw);
  if (extracted) return extracted;

  // Strategy 3: XML inside <tool_call> — <name>read_file</name><arguments><path>...</path></arguments>
  const xmlInner = parseXmlInsideToolCall(raw);
  if (xmlInner) return xmlInner;

  // Strategy 4: Line-based fallback parsing
  const fallback = parseToolCallFallback(raw);
  if (fallback) return fallback;

  console.warn("All tool call parse strategies failed for:", raw.slice(0, 200));
  return null;
}

/**
 * Clean up JSON strings that local models produce with issues.
 */
function cleanJsonString(raw: string): string {
  let cleaned = raw;

  // Remove $(root)/ or similar path prefixes models invent
  cleaned = cleaned.replace(/\$\([^)]*\)\//g, "");

  // ── Fix triple-quoted strings ("""...""") ──────────────────
  cleaned = cleaned.replace(
    /:\s*"{3,}\n?([\s\S]*?)"{3,}/g,
    (_match, content) => {
      const escaped = content
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
      return `: "${escaped}"`;
    }
  );

  // ── Fix backtick-quoted strings (```...```) ────────────────
  cleaned = cleaned.replace(
    /:\s*`{1,3}\n?([\s\S]*?)`{1,3}/g,
    (_match, content) => {
      const escaped = content
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\n/g, "\\n")
        .replace(/\r/g, "\\r")
        .replace(/\t/g, "\\t");
      return `: "${escaped}"`;
    }
  );

  // ── Fix single-quoted strings ──────────────────────────────
  cleaned = cleaned.replace(
    /"(\w+)":\s*'([^'\n]*)'/g,
    '"$1": "$2"'
  );

  // ── Fix trailing commas ────────────────────────────────────
  cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");

  // ── Test if valid now ──────────────────────────────────────
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch {
    // Try fixing unescaped newlines in content strings
    cleaned = cleaned.replace(
      /("(?:content|text|body|code|data|search|replace)":\s*")([\s\S]*?)("[\s]*[,}])/g,
      (_match, prefix, content, suffix) => {
        const escaped = content
          .replace(/\\/g, "\\\\")
          .replace(/"/g, '\\"')
          .replace(/\n/g, "\\n")
          .replace(/\r/g, "\\r")
          .replace(/\t/g, "\\t");
        return `${prefix}${escaped}${suffix}`;
      }
    );
  }

  return cleaned;
}

/**
 * Manual regex extraction for severely malformed tool calls.
 * Handles triple-quotes, multi-line content, weird formatting.
 */
function extractToolCallManually(text: string): ToolCall | null {
  // Extract tool name
  const nameMatch = text.match(/"name"\s*:\s*"(\w+)"/);
  if (!nameMatch) return null;

  const name = nameMatch[1];
  // Map common mistakes to real tool names
  const toolNameMap: Record<string, string> = {
    create_file: "write_file",
    new_file: "write_file",
    make_file: "write_file",
    save_file: "write_file",
    make_directory: "create_directory",
    mkdir: "create_directory",
    new_directory: "create_directory",
    remove_file: "delete_file",
    rm: "delete_file",
    cat: "read_file",
    get_file: "read_file",
    ls: "list_directory",
    execute_command: "run_command",
    exec: "run_command",
    shell: "run_command",
    bash: "run_command",
    run: "run_command",
    terminal: "run_command",
    str_replace: "edit_file",
    find_replace: "edit_file",
    search_replace: "edit_file",
    replace_in_file: "edit_file",
    patch_file: "edit_file",
    modify_file: "edit_file",
    search_web: "web_search",
    search: "web_search",
    internet_search: "web_search",
    google: "web_search",
    lookup: "web_search",
    schedule_task: "create_scheduled_task",
    create_task: "create_scheduled_task",
    add_task: "create_scheduled_task",
    new_task: "create_scheduled_task",
  };

  const resolvedName = toolNameMap[name] || name;
  if (!AVAILABLE_TOOLS.some((t) => t.name === resolvedName)) return null;

  const args: Record<string, any> = {};

  // Extract "path" value — try multiple patterns
  const pathMatch = text.match(/"path"\s*:\s*"([^"]+)"/);
  if (pathMatch) {
    // Clean up invented path prefixes
    args.path = pathMatch[1].replace(/^\$\([^)]*\)\//, "").replace(/^\.\//, "");
  }

  // Extract "content" — handle triple-quotes, backticks, and regular strings
  const tripleQuoteMatch = text.match(/"content"\s*:\s*"{3,}\n?([\s\S]*?)"{3,}/);
  const backtickMatch = text.match(/"content"\s*:\s*`{1,3}\n?([\s\S]*?)`{1,3}/);

  if (tripleQuoteMatch) {
    args.content = tripleQuoteMatch[1];
  } else if (backtickMatch) {
    args.content = backtickMatch[1];
  } else {
    // Try to extract regular JSON string content
    const contentIdx = text.indexOf('"content"');
    if (contentIdx >= 0) {
      const afterContent = text.slice(contentIdx);
      const colonIdx = afterContent.indexOf(":");
      if (colonIdx >= 0) {
        const valueStart = afterContent.slice(colonIdx + 1).trimStart();
        if (valueStart.startsWith('"')) {
          // Walk through the string finding the real end quote
          let i = 1;
          let content = "";
          let escaped = false;
          while (i < valueStart.length) {
            if (escaped) {
              // Handle escape sequences
              switch (valueStart[i]) {
                case "n": content += "\n"; break;
                case "t": content += "\t"; break;
                case "r": content += "\r"; break;
                case '"': content += '"'; break;
                case "\\": content += "\\"; break;
                default: content += valueStart[i];
              }
              escaped = false;
            } else if (valueStart[i] === "\\") {
              escaped = true;
            } else if (valueStart[i] === '"') {
              break;
            } else {
              content += valueStart[i];
            }
            i++;
          }
          if (content.length > 0) {
            args.content = content;
          }
        }
      }
    }
  }

  // Extract "edits" array (for multi-edit edit_file tool calls)
  const editsMatch = text.match(/"edits"\s*:\s*\[(\s*\{[\s\S]*\}\s*)\]/);
  if (editsMatch) {
    try {
      args.edits = JSON.parse(`[${editsMatch[1]}]`);
    } catch {
      // Fall through to single search/replace extraction below
    }
  }

  // Extract "search" value (for edit_file tool)
  const searchMatch = text.match(/"search"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (searchMatch) {
    args.search = searchMatch[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  // Extract "replace" value (for edit_file tool)
  const replaceMatch = text.match(/"replace"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (replaceMatch) {
    args.replace = replaceMatch[1].replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }

  // Extract "command" value (for run_command tool)
  const commandMatch = text.match(/"command"\s*:\s*"([^"]+)"/);
  if (commandMatch) {
    args.command = commandMatch[1];
  }

  // Extract "query" value (for web_search tool)
  const queryMatch = text.match(/"query"\s*:\s*"([^"]+)"/);
  if (queryMatch) {
    args.query = queryMatch[1];
  }

  // Extract "paths" array
  const pathsMatch = text.match(/"paths"\s*:\s*\[([\s\S]*?)\]/);
  if (pathsMatch) {
    const items: string[] = [];
    const itemRegex = /"([^"]+)"/g;
    let itemMatch;
    while ((itemMatch = itemRegex.exec(pathsMatch[1])) !== null) {
      items.push(itemMatch[1]);
    }
    if (items.length > 0) args.paths = items;
  }

  // Extract connection-specific fields: "provider", "action", "params"
  const providerMatch = text.match(/"provider"\s*:\s*"([^"]+)"/);
  if (providerMatch) args.provider = providerMatch[1];

  const actionMatch = text.match(/"action"\s*:\s*"([^"]+)"/);
  if (actionMatch) args.action = actionMatch[1];

  // Extract "params" object for connection tool
  const paramsMatch = text.match(/"params"\s*:\s*(\{[\s\S]*?\})\s*[,}]/);
  if (paramsMatch) {
    try {
      args.params = JSON.parse(paramsMatch[1]);
    } catch {
      // Keep as-is if we can't parse
    }
  }

  return { name: resolvedName, arguments: args };
}

/**
 * Line-based fallback parser.
 */
function parseToolCallFallback(text: string): ToolCall | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;

  let name = lines[0];
  let startLine = 1;

  if (name.toLowerCase().startsWith("name:")) {
    name = name.slice(5).trim().replace(/^["']|["']$/g, "");
    startLine = 1;
  }

  if (!AVAILABLE_TOOLS.some((t) => t.name === name)) return null;

  const args: Record<string, any> = {};
  for (let i = startLine; i < lines.length; i++) {
    const colonIndex = lines[i].indexOf(":");
    if (colonIndex > 0) {
      const key = lines[i].slice(0, colonIndex).trim().replace(/^["']|["']$/g, "");
      let value: any = lines[i].slice(colonIndex + 1).trim().replace(/^["']|["']$/g, "");

      if (value.startsWith("[") || value.startsWith("{")) {
        try { value = JSON.parse(value); } catch { /* keep as string */ }
      }

      args[key] = value;
    }
  }

  return { name, arguments: args };
}

// ── Argument Resolution ────────────────────────────────────────

function resolvePathArg(args: Record<string, any>): string | undefined {
  const pathKeys = ["path", "directory", "dir", "folder", "filepath", "file_path", "file", "filename", "name", "location"];

  for (const key of pathKeys) {
    if (args[key] !== undefined && args[key] !== null && String(args[key]).trim() !== "") {
      let path = String(args[key]).trim();
      // Clean up invented prefixes
      path = path.replace(/^\$\([^)]*\)\//, "").replace(/^\.\//, "");
      return path;
    }
  }

  return undefined;
}

function resolveContentArg(args: Record<string, any>): string | undefined {
  const contentKeys = ["content", "contents", "text", "data", "body", "code", "file_content"];

  for (const key of contentKeys) {
    if (args[key] !== undefined && args[key] !== null) {
      return String(args[key]);
    }
  }

  return undefined;
}

function resolvePathsArg(args: Record<string, any>): string[] | undefined {
  const pathsKeys = ["paths", "files", "file_paths", "filenames"];

  for (const key of pathsKeys) {
    if (Array.isArray(args[key]) && args[key].length > 0) {
      return args[key].map((p: any) => String(p).trim());
    }
  }

  if (Array.isArray(args.path)) {
    return args.path.map((p: any) => String(p).trim());
  }

  return undefined;
}

function resolveCommandArg(args: Record<string, any>): string | undefined {
  const commandKeys = ["command", "cmd", "script", "run", "exec"];

  for (const key of commandKeys) {
    if (args[key] !== undefined && args[key] !== null && String(args[key]).trim() !== "") {
      return String(args[key]).trim();
    }
  }

  return undefined;
}

function resolveQueryArg(args: Record<string, any>): string | undefined {
  const queryKeys = ["query", "q", "search_query", "search", "question", "term"];

  for (const key of queryKeys) {
    if (args[key] !== undefined && args[key] !== null && String(args[key]).trim() !== "") {
      return String(args[key]).trim();
    }
  }

  return undefined;
}

function resolveSearchArg(args: Record<string, any>): string | undefined {
  const searchKeys = ["search", "find", "old", "old_str", "original", "from"];
  for (const key of searchKeys) {
    if (args[key] !== undefined && args[key] !== null) {
      return String(args[key]);
    }
  }
  return undefined;
}

function resolveReplaceArg(args: Record<string, any>): string | undefined {
  const replaceKeys = ["replace", "replacement", "new", "new_str", "to", "with"];
  for (const key of replaceKeys) {
    if (args[key] !== undefined && args[key] !== null) {
      return String(args[key]);
    }
  }
  return undefined;
}

// Extract an array of {search, replace} edits for multi-edit mode.
// Accepts several shapes the model might emit:
//   edits: [{search, replace}]  — canonical
//   changes: [...]              — alias
//   patches: [...]              — alias
// Inside each item, the search/replace keys go through the same alias
// resolution as single-edit mode (find/old/original; replacement/new/with/etc).
// Returns undefined if no valid array is present — caller falls back to single-edit.
function resolveEditsArg(args: Record<string, any>): Array<{ search: string; replace: string }> | undefined {
  const arrayKeys = ["edits", "changes", "patches", "replacements"];
  let raw: any = undefined;
  for (const key of arrayKeys) {
    if (Array.isArray(args[key])) {
      raw = args[key];
      break;
    }
  }
  if (!raw) return undefined;

  const edits: Array<{ search: string; replace: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const search = resolveSearchArg(item);
    const replace = resolveReplaceArg(item);
    if (search === undefined || replace === undefined) continue;
    edits.push({ search, replace });
  }
  return edits.length > 0 ? edits : undefined;
}

// ── Tool Execution ─────────────────────────────────────────────

export interface ToolResult {
  tool: string;
  success: boolean;
  result: string;
  filesChanged?: string[];
}

// ─── Diff & Approval ─────────────────────────────────────────

export interface PendingDiff {
  id: string;
  action: "create" | "rewrite" | "edit" | "delete";
  filePath: string;           // Relative path
  oldContent: string | null;  // null for new files
  newContent: string | null;  // null for deletions
  searchText?: string;        // For edit_file
  replaceText?: string;       // For edit_file
}

/** Callback that shows a diff to the user and returns true (approved) or false (rejected). */
export type ApprovalCallback = (diff: PendingDiff) => Promise<boolean>;

/**
 * Execute a single tool call and return the result.
 */
export async function executeTool(
  toolCall: ToolCall,
  projectPath: string,
  manifest: ProjectManifest | null,
  onApproval?: ApprovalCallback,
  contextData?: ContextData | null
): Promise<{ result: ToolResult; updatedManifest: ProjectManifest | null; updatedContext?: ContextData | null }> {
  const { name, arguments: args } = toolCall;
  let updatedManifest = manifest;

  try {
    // SECURITY: Rate limiting
    const rateLimited = isRateLimited(name);
    if (rateLimited) {
      return {
        result: {
          tool: name,
          success: false,
          result: `❌ ${rateLimited}`,
        },
        updatedManifest,
      };
    }

    switch (name) {
      case "read_file": {
        const path = resolvePathArg(args);
        if (!path) {
          throw new Error("Missing 'path' parameter. Use: {\"name\": \"read_file\", \"arguments\": {\"path\": \"filename.ext\"}}");
        }

        // SECURITY: Block sensitive files
        if (isSensitiveFile(path)) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ BLOCKED: "${path}" is a sensitive file. AI cannot read or modify it.`,
            },
            updatedManifest,
          };
        }

        // Block dangerous directories
        const pathParts = path.replace(/\\/g, "/").split("/");
        if (pathParts.some(part => isBlocklisted(part))) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ Blocked: "${path}" is in a restricted directory. These directories are excluded to save tokens: ${BLOCKLIST.join(", ")}`,
            },
            updatedManifest,
          };
        }

        const filePath = resolveProjectPath(projectPath, path);
        const content = await readFile(filePath);

        // SECURITY: File size limit
        if (content.length > MAX_READ_SIZE) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ File too large (${(content.length / 1024).toFixed(1)}KB). Max readable: ${MAX_READ_SIZE / 1000}KB. Try reading a specific section or use run_command to extract what you need.`,
            },
            updatedManifest,
          };
        }

        return {
          result: {
            tool: name,
            success: true,
            result: `Contents of ${path}:\n\`\`\`\n${content}\n\`\`\``,
          },
          updatedManifest,
        };
      }

      case "read_multiple_files": {
        const paths = resolvePathsArg(args);
        if (!paths || paths.length === 0) {
          throw new Error("Missing 'paths' parameter. Use: {\"name\": \"read_multiple_files\", \"arguments\": {\"paths\": [\"file1\", \"file2\"]}}");
        }
        const results: string[] = [];
        for (const p of paths) {
          try {
            // SECURITY: Block sensitive files
            if (isSensitiveFile(p)) {
              results.push(`### ${p}\n❌ BLOCKED: Sensitive file. AI cannot read or modify it.`);
              continue;
            }

            // SECURITY: Block dangerous directories
            const pParts = p.replace(/\\/g, "/").split("/");
            if (pParts.some(part => isBlocklisted(part))) {
              results.push(`### ${p}\n❌ Blocked: "${p}" is in a restricted directory.`);
              continue;
            }

            const filePath = resolveProjectPath(projectPath, p);
            const content = await readFile(filePath);

            // SECURITY: File size limit (per file)
            if (content.length > MAX_READ_SIZE) {
              results.push(`### ${p}\n❌ File too large (${(content.length / 1024).toFixed(1)}KB). Max readable: ${MAX_READ_SIZE / 1000}KB.`);
              continue;
            }

            results.push(`### ${p}\n\`\`\`\n${content}\n\`\`\``);
          } catch (e: any) {
            results.push(`### ${p}\nError: ${e.message}`);
          }
        }
        return {
          result: { tool: name, success: true, result: results.join("\n\n") },
          updatedManifest,
        };
      }

      case "write_file": {
        const path = resolvePathArg(args);
        if (!path) {
          throw new Error("Missing 'path' parameter. Use: {\"name\": \"write_file\", \"arguments\": {\"path\": \"filename.ext\", \"content\": \"file content\"}}");
        }

        // SECURITY: Block sensitive files
        if (isSensitiveFile(path)) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ BLOCKED: "${path}" is a sensitive file. AI cannot read or modify it.`,
            },
            updatedManifest,
          };
        }

        // SECURITY: Block dangerous directories
        const writePathParts = path.replace(/\\/g, "/").split("/");
        if (writePathParts.some(part => isBlocklisted(part))) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ Blocked: "${path}" is in a restricted directory. AI cannot write to: ${BLOCKLIST.join(", ")}`,
            },
            updatedManifest,
          };
        }

        const content = resolveContentArg(args);
        if (content === undefined) {
          throw new Error("Missing 'content' parameter. The content must be a JSON string with \\n for newlines. Use: {\"name\": \"write_file\", \"arguments\": {\"path\": \"" + path + "\", \"content\": \"<!DOCTYPE html>\\n<html>...</html>\"}}");
        }

        // SECURITY: File size limit
        if (content.length > MAX_WRITE_SIZE) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ Content too large (${(content.length / 1024).toFixed(1)}KB). Max writable: ${MAX_WRITE_SIZE / 1000}KB.`,
            },
            updatedManifest,
          };
        }

        const filePath = resolveProjectPath(projectPath, path);

        // Ensure parent directory exists
        const parentDir = filePath.replace(/[/\\][^/\\]+$/, "");
        try {
          await createDirectory(parentDir);
        } catch {
          // Directory might already exist
        }

        // SECURITY: Sanitize HTML content
        const sanitizedContent = sanitizeFileContent(path, content);

        // ── Approval gate ──
        if (onApproval) {
          // Check if file exists to determine create vs rewrite
          let existingContent: string | null = null;
          try {
            existingContent = await readFile(filePath);
          } catch {
            // File doesn't exist — it's a new file
          }

          const approved = await onApproval({
            id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            action: existingContent !== null ? "rewrite" : "create",
            filePath: path,
            oldContent: existingContent,
            newContent: sanitizedContent,
          });

          if (!approved) {
            return {
              result: {
                tool: name,
                success: false,
                result: `⏭️ Skipped: ${path} — change rejected by user.`,
              },
              updatedManifest,
            };
          }
        }

        await writeFile(filePath, sanitizedContent);

        if (updatedManifest) {
          const relativePath = getRelativePath(projectPath, filePath);
          updatedManifest = updateManifestEntry(updatedManifest, relativePath, sanitizedContent);
        }

        return {
          result: {
            tool: name,
            success: true,
            result: `✅ Written: ${path} (${sanitizedContent.length} chars, ${sanitizedContent.split("\n").length} lines)`,
            filesChanged: [path],
          },
          updatedManifest,
        };
      }

      case "edit_file": {
        const path = resolvePathArg(args);
        if (!path) {
          throw new Error("Missing 'path' parameter. Use: {\"name\": \"edit_file\", \"arguments\": {\"path\": \"file.html\", \"edits\": [{\"search\": \"old\", \"replace\": \"new\"}]}}");
        }

        // SECURITY: Block sensitive files
        if (isSensitiveFile(path)) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ BLOCKED: "${path}" is a sensitive file. AI cannot read or modify it.`,
            },
            updatedManifest,
          };
        }

        // SECURITY: Block dangerous directories
        const editPathParts = path.replace(/\\/g, "/").split("/");
        if (editPathParts.some(part => isBlocklisted(part))) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ Blocked: "${path}" is in a restricted directory. AI cannot edit files in: ${BLOCKLIST.join(", ")}`,
            },
            updatedManifest,
          };
        }

        // Resolve edits: prefer the `edits` array (multi-edit), fall back to
        // single {search, replace}. This keeps old conversation history working
        // while allowing the new efficient multi-edit mode.
        const multiEdits = resolveEditsArg(args);
        let edits: Array<{ search: string; replace: string }>;

        if (multiEdits) {
          edits = multiEdits;
        } else {
          const search = resolveSearchArg(args);
          if (search === undefined) {
            throw new Error("Missing 'search' parameter. Provide the exact text to find, or use an 'edits' array for multiple changes.");
          }
          const replace = resolveReplaceArg(args);
          if (replace === undefined) {
            throw new Error("Missing 'replace' parameter. Provide the replacement text (use empty string to delete).");
          }
          edits = [{ search, replace }];
        }

        const filePath = resolveProjectPath(projectPath, path);
        const existing = await readFile(filePath);

        // Apply edits sequentially to a working buffer.
        // Validate each step against the CURRENT state of the buffer (not the
        // original file) — because edit N can change whether edit N+1's search
        // string still matches uniquely. This is atomic: if any edit fails,
        // no changes are written to disk.
        let working = existing;
        const appliedNotes: string[] = [];

        for (let i = 0; i < edits.length; i++) {
          const { search, replace } = edits[i];

          if (search === "") {
            return {
              result: {
                tool: name,
                success: false,
                result: `❌ Edit ${i + 1}/${edits.length} in ${path}: missing search value (empty search string is not allowed).`,
              },
              updatedManifest,
            };
          }

          if (search === replace) {
            // No-op edit — skip silently rather than fail the whole batch
            appliedNotes.push(`edit ${i + 1}: no change (search === replace)`);
            continue;
          }

          const occurrences = working.split(search).length - 1;

          if (occurrences === 0) {
            return {
              result: {
                tool: name,
                success: false,
                result: `❌ Edit ${i + 1}/${edits.length} in ${path}: search string not found (may have been changed by a previous edit in this batch, or it was never present). Use read_file to check current contents. No changes have been written.`,
              },
              updatedManifest,
            };
          }

          if (occurrences > 1) {
            return {
              result: {
                tool: name,
                success: false,
                result: `❌ Edit ${i + 1}/${edits.length} in ${path}: unique match not found — search string appears ${occurrences} times. Include surrounding context so it matches exactly once. No changes have been written.`,
              },
              updatedManifest,
            };
          }

          working = working.replace(search, () => replace);
          appliedNotes.push(`edit ${i + 1}: ${search.length}→${replace.length} chars`);
        }

        // No-op batch? Return success without touching disk.
        if (working === existing) {
          return {
            result: {
              tool: name,
              success: true,
              result: `✅ No changes needed in ${path} (all edits were no-ops).`,
              filesChanged: [],
            },
            updatedManifest,
          };
        }

        // ── Approval gate ──
        // For single-edit mode, pass searchText/replaceText so the UI can
        // show the familiar targeted diff. For multi-edit, omit them and
        // let the diff viewer render a plain before/after.
        if (onApproval) {
          const diffPayload: PendingDiff = {
            id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            action: "edit",
            filePath: path,
            oldContent: existing,
            newContent: working,
          };
          if (edits.length === 1) {
            diffPayload.searchText = edits[0].search;
            diffPayload.replaceText = edits[0].replace;
          }
          const approved = await onApproval(diffPayload);

          if (!approved) {
            return {
              result: {
                tool: name,
                success: false,
                result: `⏭️ Skipped: ${path} — edit rejected by user.`,
              },
              updatedManifest,
            };
          }
        }

        await writeFile(filePath, working);

        if (updatedManifest) {
          const relativePath = getRelativePath(projectPath, filePath);
          updatedManifest = updateManifestEntry(updatedManifest, relativePath, working);
        }

        const summary = edits.length === 1
          ? `✅ Edited: ${path} (replaced ${edits[0].search.length} chars with ${edits[0].replace.length} chars)`
          : `✅ Edited: ${path} (${edits.length} changes: ${appliedNotes.join(", ")})`;

        return {
          result: {
            tool: name,
            success: true,
            result: summary,
            filesChanged: [path],
          },
          updatedManifest,
        };
      }

      case "list_directory": {
        const path = resolvePathArg(args) || ".";
        const dirPath = path === "." || path === "" || path === "/"
          ? projectPath
          : resolveProjectPath(projectPath, path);
        const entries = await readDirectory(dirPath, 2);
        const filtered = filterBlocklisted(entries);
        const listing = formatDirectoryListing(filtered, "");
        return {
          result: {
            tool: name,
            success: true,
            result: `Contents of ${path || "project root"}:\n${listing}`,
          },
          updatedManifest,
        };
      }

      case "create_directory": {
        const path = resolvePathArg(args);
        if (!path) {
          throw new Error("Missing 'path' parameter. Use: {\"name\": \"create_directory\", \"arguments\": {\"path\": \"dirname\"}}");
        }

        // ── Safety: prevent creating "directories" that look like files ──
        const hasExtension = /\.\w{1,10}$/.test(path);
        if (hasExtension) {
          // The model confused create_directory with write_file
          // Try to recover: if there's content, write a file instead
          const content = resolveContentArg(args);
          if (content) {
            // SECURITY: Block sensitive files
            if (isSensitiveFile(path)) {
              return {
                result: {
                  tool: name,
                  success: false,
                  result: `❌ BLOCKED: "${path}" is a sensitive file. AI cannot read or modify it.`,
                },
                updatedManifest,
              };
            }

            const filePath = resolveProjectPath(projectPath, path);
            const parentDir = filePath.replace(/[/\\][^/\\]+$/, "");
            try { await createDirectory(parentDir); } catch { /* ok */ }

            // SECURITY: Sanitize HTML content
            const sanitizedContent = sanitizeFileContent(path, content);

            // ── Approval gate ──
            if (onApproval) {
              const approved = await onApproval({
                id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                action: "create",
                filePath: path,
                oldContent: null,
                newContent: sanitizedContent,
              });

              if (!approved) {
                return {
                  result: {
                    tool: "write_file",
                    success: false,
                    result: `⏭️ Skipped: ${path} — change rejected by user.`,
                  },
                  updatedManifest,
                };
              }
            }

            await writeFile(filePath, sanitizedContent);
            if (updatedManifest) {
              const relativePath = getRelativePath(projectPath, filePath);
              updatedManifest = updateManifestEntry(updatedManifest, relativePath, sanitizedContent);
            }
            return {
              result: {
                tool: "write_file",
                success: true,
                result: `✅ Written: ${path} (auto-corrected from create_directory to write_file)`,
                filesChanged: [path],
              },
              updatedManifest,
            };
          }
          // No content — reject with helpful error
          throw new Error(`"${path}" looks like a file, not a directory. Use write_file instead: {"name": "write_file", "arguments": {"path": "${path}", "content": "..."}}`);
        }

        const dirPath = resolveProjectPath(projectPath, path);
        await createDirectory(dirPath);
        return {
          result: {
            tool: name,
            success: true,
            result: `✅ Created directory: ${path}`,
          },
          updatedManifest,
        };
      }

      case "delete_file": {
        const path = resolvePathArg(args);
        if (!path) {
          throw new Error("Missing 'path' parameter. Use: {\"name\": \"delete_file\", \"arguments\": {\"path\": \"filename.ext\"}}");
        }

        // SECURITY: Block sensitive files
        if (isSensitiveFile(path)) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ BLOCKED: "${path}" is a sensitive file. AI cannot read or modify it.`,
            },
            updatedManifest,
          };
        }

        // SECURITY: Block dangerous directories
        const delPathParts = path.replace(/\\/g, "/").split("/");
        if (delPathParts.some(part => isBlocklisted(part))) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ Blocked: "${path}" is in a restricted directory. AI cannot delete from: ${BLOCKLIST.join(", ")}`,
            },
            updatedManifest,
          };
        }

        const filePath = resolveProjectPath(projectPath, path);

        // ── Approval gate ──
        if (onApproval) {
          let existingContent: string | null = null;
          try {
            existingContent = await readFile(filePath);
          } catch {
            // May be a directory or unreadable
          }

          const approved = await onApproval({
            id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            action: "delete",
            filePath: path,
            oldContent: existingContent,
            newContent: null,
          });

          if (!approved) {
            return {
              result: {
                tool: name,
                success: false,
                result: `⏭️ Skipped: ${path} — deletion rejected by user.`,
              },
              updatedManifest,
            };
          }
        }

        await deletePath(filePath);

        if (updatedManifest) {
          const relativePath = getRelativePath(projectPath, filePath);
          updatedManifest = removeManifestEntry(updatedManifest, relativePath);
        }

        return {
          result: {
            tool: name,
            success: true,
            result: `✅ Deleted: ${path}`,
            filesChanged: [path],
          },
          updatedManifest,
        };
      }

      case "run_command": {
        let command = resolveCommandArg(args);
        if (!command) {
          throw new Error('Missing \'command\' parameter. Use: {"name": "run_command", "arguments": {"command": "npm test"}}');
        }

        // Handle "cd subfolder && actual_command" pattern
        // Each run_command is a fresh process, so standalone cd has no effect.
        // Extract the cd prefix and use it as the working directory instead.
        let cwd = projectPath;
        const cdAndPattern = /^cd\s+["']?([^"'&\n]+?)["']?\s*&&\s*(.+)$/i;
        const cdMatch = command.match(cdAndPattern);
        if (cdMatch) {
          const subdir = cdMatch[1].trim();
          const restCommand = cdMatch[2].trim();

          // Security: resolve subdir within project — blocks escape via ../
          try {
            cwd = resolveProjectPath(projectPath, subdir);
          } catch (e: any) {
            return {
              result: {
                tool: name,
                success: false,
                result: `❌ ${e.message}`,
              },
              updatedManifest,
            };
          }
          command = restCommand;
          console.log(`[run_command] cd detected → cwd: ${cwd}, command: ${command}`);
        }

        // Catch standalone "cd subfolder" with no && (does nothing in fresh process)
        if (/^cd\s+\S+\s*$/i.test(command)) {
          return {
            result: {
              tool: name,
              success: true,
              result: `Note: Each command runs in a fresh process, so standalone "cd" has no lasting effect. To run a command in a subfolder, combine them: "cd subfolder && your_command"`,
            },
            updatedManifest,
          };
        }

        // SECURITY: Block dangerous commands (check the actual command after stripping cd)
        const blocked = isCommandBlocked(command);
        if (blocked) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ ${blocked}`,
            },
            updatedManifest,
          };
        }

        // Dynamic timeout: install commands can take minutes, regular commands 30s
        const isInstall = /\b(npm\s+install|npm\s+i|yarn\s+install|yarn\s+add|pnpm\s+install|pnpm\s+add|pip\s+install|composer\s+install|cargo\s+build|bundle\s+install|npx\s+create-)\b/i.test(command);
        const isBuild = /\b(npm\s+run\s+build|yarn\s+build|next\s+build|vite\s+build|tsc)\b/i.test(command);
        const commandTimeout = isInstall ? 300_000 : isBuild ? 120_000 : 30_000; // 5min / 2min / 30s

        const result = await withTimeout(
          invoke<{ stdout: string; stderr: string; exit_code: number }>("execute_command", {
            command,
            cwd,
          }),
          commandTimeout,
          `run_command: ${command.slice(0, 60)}`
        );

        const output: string[] = [];
        if (result.stdout.trim()) {
          output.push(`stdout:\n${result.stdout.trim()}`);
        }
        if (result.stderr.trim()) {
          output.push(`stderr:\n${result.stderr.trim()}`);
        }
        output.push(`Exit code: ${result.exit_code}`);

        return {
          result: {
            tool: name,
            success: result.exit_code === 0,
            result: output.join("\n\n"),
          },
          updatedManifest,
        };
      }

      case "web_search": {
        const query = resolveQueryArg(args);
        if (!query) {
          throw new Error('Missing \'query\' parameter. Use: {"name": "web_search", "arguments": {"query": "search terms"}}');
        }

        const settings = useSettingsStore.getState();
        if (!settings.webSearchEnabled) {
          return {
            result: {
              tool: name,
              success: false,
              result: "❌ Web search is disabled. The user can enable it in Settings → General.",
            },
            updatedManifest,
          };
        }

        const apiKey = settings.searchApiKey || "";
        const maxResults = parseInt(args.max_results || args.count || "5", 10);
        const searchResponse = await webSearch(query, apiKey, maxResults);
        const formattedResult = formatResultsForAI(searchResponse);

        return {
          result: {
            tool: name,
            success: !searchResponse.error,
            result: formattedResult,
          },
          updatedManifest,
        };
      }

      case "connection": {
        const provider = args.provider;
        const action = args.action;
        const params = args.params || {};

        if (!provider || !action) {
          throw new Error('Missing provider or action. Use: {"name": "connection", "arguments": {"provider": "vercel", "action": "list_projects", "params": {}}}');
        }

        const result = await executeConnectionTool({ provider, action, params });
        return {
          result: {
            tool: "connection",
            success: !result.startsWith("Error:"),
            result,
          },
          updatedManifest,
        };
      }
	  
	  case "deploy": {
        const currentProject = useProjectStore.getState().currentProject;
        if (!currentProject) {
          return {
            result: {
              tool: "deploy",
              success: false,
              result: "❌ No project is open. Open a project first, then deploy.",
            },
            updatedManifest,
          };
        }

        // Auto-pick provider if not specified.
        const requestedProvider = args.provider as
          | "vercel" | "netlify" | "cloudflare" | undefined;
        const provider = requestedProvider ?? pickDefaultProvider(currentProject.id);

        if (!provider) {
          const connected = listConnectedDeployProviders(currentProject.id);
          const hint = connected.length
            ? `Connected deploy providers: ${connected.join(", ")}. Specify one with the provider argument.`
            : "No deploy provider connected. Connect Vercel, Netlify, or Cloudflare in Settings > Project Connections.";
          return {
            result: {
              tool: "deploy",
              success: false,
              result: `❌ ${hint}`,
            },
            updatedManifest,
          };
        }

        // Derive project name: explicit arg > current project name > folder name
        const projectName =
          (args.projectName as string | undefined) ||
          currentProject.name ||
          projectPath.split(/[\\/]/).filter(Boolean).pop() ||
          "omnirun-project";

        try {
          // Use the deploy store so the progress modal opens automatically.
          // startDeploy calls deployProject internally and pipes progress.
          await useDeployStore.getState().startDeploy({
            projectId: currentProject.id,
            projectPath,
            projectName,
            provider,
            cloudflareAccountId: args.cloudflareAccountId as string | undefined,
          });

          // Read final state from the store.
          const { stage, url, error } = useDeployStore.getState();

          if (stage === 'live' && url) {
            return {
              result: {
                tool: "deploy",
                success: true,
                result: `✅ Deployed to ${provider}: ${url}`,
              },
              updatedManifest,
            };
          } else {
            return {
              result: {
                tool: "deploy",
                success: false,
                result: `❌ Deploy failed: ${error || "Unknown error"}`,
              },
              updatedManifest,
            };
          }
        } catch (err: any) {
          return {
            result: {
              tool: "deploy",
              success: false,
              result: `❌ Deploy failed: ${err?.message || "Unknown error"}`,
            },
            updatedManifest,
          };
        }
      }

      case "write_context": {
        if (!contextData) {
          return {
            result: {
              tool: name,
              success: false,
              result: "❌ No project context available. Open a project first.",
            },
            updatedManifest,
          };
        }

        const section = args.section as ContextSection;
        if (!section || !(VALID_SECTIONS as readonly string[]).includes(section)) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ Invalid section "${section}". Valid sections: ${VALID_SECTIONS.join(", ")}`,
            },
            updatedManifest,
          };
        }

        let entries: string[] = [];
        if (Array.isArray(args.entries)) {
          entries = args.entries.map((e: any) => String(e).trim()).filter(Boolean);
        } else if (typeof args.entries === "string") {
          entries = [args.entries.trim()];
        }

        if (entries.length === 0) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ Missing entries. Use: {"section": "${section}", "entries": ["entry1", "entry2"]}`,
            },
            updatedManifest,
          };
        }

        const updatedContext = updateContextFromAI(contextData, section, entries);

        return {
          result: {
            tool: name,
            success: true,
            result: `✅ Saved ${entries.length} ${section}: ${entries.join(", ")}`,
          },
          updatedManifest,
          updatedContext,
        };
      }

      case "create_scheduled_task": {
        const taskName = args.name || args.task_name;
        if (!taskName) {
          throw new Error('Missing task name. Use: {"name": "create_scheduled_task", "arguments": {"name": "My Task", "schedule": "Every day at 2am", "cron_expression": "0 2 * * *", "steps": [...]}}');
        }

        const cronExpr = args.cron_expression || args.cron || "";
        const schedule = args.schedule || args.description_schedule || "";

        if (!cronExpr && !schedule) {
          throw new Error("Missing schedule. Provide cron_expression (e.g. '0 2 * * *') and/or schedule (e.g. 'Every day at 2:00 AM').");
        }

        // Parse on_failure
        let onFailure: any = { type: "stop" };
        if (args.on_failure === "skip" || args.on_failure === "skip_and_continue") {
          onFailure = { type: "skip_and_continue" };
        } else if (typeof args.on_failure === "string" && args.on_failure.startsWith("retry")) {
          const retryMatch = args.on_failure.match(/(\d+)/);
          onFailure = { type: "retry", max_attempts: retryMatch ? parseInt(retryMatch[1]) : 3 };
        } else if (typeof args.on_failure === "object") {
          onFailure = args.on_failure;
        }

        // Parse steps — accept full steps array OR flat command string
        const rawSteps = Array.isArray(args.steps) ? args.steps : [];
        let steps;

        if (rawSteps.length > 0) {
          // Full format (Claude/OpenAI) — use as-is
          steps = rawSteps.map((s: any, i: number) => ({
            id: s.id || `step_${i + 1}`,
            name: s.name || `Step ${i + 1}`,
            executor: s.executor || "local",
            action: s.action || { type: "run_command", command: s.command || "" },
            depends_on_previous: s.depends_on_previous ?? true,
          }));
        } else {
          // Flat format (DeepSeek etc.) — auto-wrap command into a step
          const cmd = args.command || args.cmd || args.script || "";
          if (!cmd) {
            throw new Error("Missing steps or command. Provide either a 'steps' array or a 'command' string.");
          }
          steps = [{
            id: "step_1",
            name: taskName,
            executor: "local" as const,
            action: { type: "run_command", command: cmd },
            depends_on_previous: true,
          }];
        }

        // Determine scope and project_id
        const taskScope = args.scope === "assistant" ? "assistant" : "project";
        const taskProjectId = taskScope === "assistant"
          ? undefined  // assistant tasks have no project
          : (args.project_id || projectPath || undefined);

        // Inject cwd into run_command/run_script steps that don't have one set
        // Without this, commands run in the system default dir (e.g. C:\Users\Name\)
        if (taskProjectId) {
          steps = steps.map((s: any) => {
            if (s.action?.type === "run_command" && !s.action.cwd) {
              return { ...s, action: { ...s.action, cwd: taskProjectId } };
            }
            if (s.action?.type === "run_script" && !s.action.cwd) {
              return { ...s, action: { ...s.action, cwd: taskProjectId } };
            }
            return s;
          });
        }

        const created = await createTask({
          name: taskName,
          description: args.description || "",
          schedule,
          cron_expression: cronExpr,
          project_id: taskProjectId,
          scope: taskScope,
          enabled: true,
          steps,
          on_failure: onFailure,
        });

        if (created) {
          return {
            result: {
              tool: name,
              success: true,
              result: `✅ Scheduled task "${created.name}" created successfully!\n• Scope: ${created.scope === "assistant" ? "Assistant (global)" : "Project"}\n• Schedule: ${created.schedule || created.cron_expression}\n• Steps: ${created.steps.length}\n• Next run: ${created.next_run || "Calculating..."}\n\nThe task is now active and will run automatically. View it in Tasks.`,
            },
            updatedManifest,
          };
        } else {
          return {
            result: {
              tool: name,
              success: false,
              result: "❌ Failed to create scheduled task. Check the Rust backend logs.",
            },
            updatedManifest,
          };
        }
      }

      // ── Screen Control Tools ─────────────────────────────────

      case "screen_capture": {
        const settings = loadScreenControlSettings();
        if (!settings.enabled) {
          return {
            result: {
              tool: name,
              success: false,
              result: "❌ Desktop app control is disabled. The user can enable it in Settings → Screen Control.",
            },
            updatedManifest,
          };
        }

        // Check if active app is blocked
        const blockCheck = await isBlockedApp();
        if (blockCheck.blocked) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ BLOCKED: "${blockCheck.appName}" is in the blocked apps list. Screen control will not interact with this app.`,
            },
            updatedManifest,
          };
        }

        const cropToWindow = args.crop_to_window !== false && settings.cropToWindow;
        const quality = settings.screenshotQuality || "medium";

        const screenshot = await takeScreenshot(cropToWindow, quality);

        // Return base64 image data — the AI integration layer will
        // attach this as a vision image to the next message
        return {
          result: {
            tool: name,
            success: true,
            result: `✅ Screenshot captured (${screenshot.width}x${screenshot.height})\n<screenshot_base64>${screenshot.base64}</screenshot_base64>`,
          },
          updatedManifest,
        };
      }

      case "screen_action": {
        const settings = loadScreenControlSettings();
        if (!settings.enabled) {
          return {
            result: {
              tool: name,
              success: false,
              result: "❌ Desktop app control is disabled. The user can enable it in Settings → Screen Control.",
            },
            updatedManifest,
          };
        }

        // Check if active app is blocked
        const actionBlockCheck = await isBlockedApp();
        if (actionBlockCheck.blocked) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ BLOCKED: "${actionBlockCheck.appName}" is in the blocked apps list.`,
            },
            updatedManifest,
          };
        }

        // Build action from args
        const actionType = (args.action || args.type || "").toUpperCase();
        const action: any = { type: actionType };

        if (args.x !== undefined) action.x = parseInt(args.x);
        if (args.y !== undefined) action.y = parseInt(args.y);
        if (args.x2 !== undefined) action.x2 = parseInt(args.x2);
        if (args.y2 !== undefined) action.y2 = parseInt(args.y2);
        if (args.text !== undefined) action.text = args.text;
        if (args.combo !== undefined) action.combo = args.combo;
        if (args.direction !== undefined) action.direction = args.direction;
        if (args.amount !== undefined) action.amount = parseInt(args.amount);
        if (args.seconds !== undefined) action.seconds = parseInt(args.seconds);
        if (args.reason !== undefined) action.reason = args.reason;

        // Add configurable delay before action
        const delay = settings.actionDelay || 500;
        if (delay > 0) {
          await new Promise((r) => setTimeout(r, delay));
        }

        const actionResult = await executeScreenAction(action);

        return {
          result: {
            tool: name,
            success: true,
            result: `✅ ${actionResult}`,
          },
          updatedManifest,
        };
      }

      case "screen_info": {
        const settings = loadScreenControlSettings();
        if (!settings.enabled) {
          return {
            result: {
              tool: name,
              success: false,
              result: "❌ Desktop app control is disabled. The user can enable it in Settings → Screen Control.",
            },
            updatedManifest,
          };
        }

        let info = "";
        try {
          const win = await getActiveWindow();
          info += `Active window:\n  App: ${win.app_name}\n  Title: ${win.title}\n  Position: (${win.x}, ${win.y})\n  Size: ${win.width}x${win.height}\n`;
        } catch (e: any) {
          info += `Active window: could not detect (${e.message})\n`;
        }

        try {
          const screen = await getScreenSize();
          info += `Screen size: ${screen.width}x${screen.height}`;
        } catch (e: any) {
          info += `Screen size: could not detect (${e.message})`;
        }

        return {
          result: {
            tool: name,
            success: true,
            result: info,
          },
          updatedManifest,
        };
      }

      default:
        return {
          result: {
            tool: name,
            success: false,
            result: `Unknown tool: ${name}. Available tools are: ${AVAILABLE_TOOLS.map(t => t.name).join(", ")}`,
          },
          updatedManifest,
        };
    }
  } catch (error: any) {
    const message = error?.message || error?.toString() || "Unknown error";
    return {
      result: {
        tool: name,
        success: false,
        result: `❌ Error executing ${name}: ${message}`,
      },
      updatedManifest,
    };
  }
}

/**
 * Execute all tool calls in sequence and return combined results.
 */
export async function executeToolCalls(
  toolCalls: ToolCall[],
  projectPath: string,
  manifest: ProjectManifest | null,
  onApproval?: ApprovalCallback,
  contextData?: ContextData | null
): Promise<{ results: ToolResult[]; updatedManifest: ProjectManifest | null; filesChanged: string[]; updatedContext?: ContextData | null }> {
  // Ensure Rust backend is scoped to this project before any tool runs.
  // Prevents "Access denied: path outside project scope" if set_project_path
  // hasn't completed yet (race on startup) or failed silently on project switch.
  try {
    await invoke("set_project_path", { path: projectPath });
  } catch (e) {
    console.error("Failed to set project path before tool execution:", e);
  }

  const results: ToolResult[] = [];
  let currentManifest = manifest;
  let currentContext = contextData || null;
  const allFilesChanged: string[] = [];

  for (const toolCall of toolCalls) {
    const { result, updatedManifest, updatedContext } = await executeTool(toolCall, projectPath, currentManifest, onApproval, currentContext);
    results.push(result);
    currentManifest = updatedManifest;
    if (updatedContext) {
      currentContext = updatedContext;
    }
    if (result.filesChanged) {
      allFilesChanged.push(...result.filesChanged);
    }
  }

  return {
    results,
    updatedManifest: currentManifest,
    filesChanged: allFilesChanged,
    updatedContext: currentContext,
  };
}

// ── Human-readable summaries for tool actions ───────────────────

/**
 * Generate a short, human-readable summary line for a tool call.
 * Used in the chat UI instead of showing raw tool_call JSON.
 */
export function generateToolSummary(toolCall: ToolCall): string {
  const { name, arguments: args } = toolCall;
  const path = args.path || args.paths?.[0] || "";
  const filename = path ? path.split(/[/\\]/).pop() || path : "";

  switch (name) {
    case "write_file": {
      const lines = args.content ? args.content.split("\n").length : 0;
      return `Writing ${filename}` + (lines > 0 ? ` (${lines} lines)` : "");
    }
    case "read_file":
      return `Reading ${filename}`;
    case "read_multiple_files": {
      const paths: string[] = args.paths || [];
      if (paths.length <= 2) return `Reading ${paths.map((p: string) => p.split(/[/\\]/).pop()).join(", ")}`;
      return `Reading ${paths.length} files`;
    }
    case "edit_file":
    case "str_replace":
    case "find_replace":
    case "search_replace":
      return `Editing ${filename}`;
    case "list_directory":
      return `Listing ${filename || "directory"}`;
    case "create_directory":
      return `Creating folder ${filename}`;
    case "delete_file":
      return `Deleting ${filename}`;
    case "run_command": {
      const cmd = args.command || "";
      const shortCmd = cmd.length > 40 ? cmd.slice(0, 37) + "…" : cmd;
      return `Running: ${shortCmd}`;
    }
    case "web_search":
      return `Searching: ${args.query || "web"}`;
    case "write_context":
      return `Saving project context`;
    case "create_scheduled_task":
      return `Creating scheduled task: ${args.name || ""}`;
    case "screen_capture":
      return "Taking screenshot";
    case "screen_action": {
      const act = args.action || args.type || "";
      if (act === "CLICK" || act === "DOUBLE_CLICK" || act === "RIGHT_CLICK") return `${act} at (${args.x}, ${args.y})`;
      if (act === "TYPE") return `Typing: "${(args.text || "").slice(0, 30)}${(args.text || "").length > 30 ? "…" : ""}"`;
      if (act === "KEY") return `Pressing: ${args.combo}`;
      if (act === "SCROLL") return `Scrolling ${args.direction}`;
      return `Screen action: ${act}`;
    }
    case "screen_info":
      return "Getting screen info";
    default:
      return `${name}${filename ? `: ${filename}` : ""}`;
  }
}

/**
 * Generate a short result summary from a ToolResult.
 * Extracts just the first-line status (✅, ❌, ⏭️) without verbose details.
 */
export function generateResultSummary(result: ToolResult): string {
  if (result.tool === "web_search") {
    if (result.result.startsWith("Web search error:") || result.result.includes("returned no results")) {
      return `Search failed`;
    }
    // Count results
    const urls = result.result.split("\n").filter(l => l.trim().startsWith("http"));
    return `Found ${urls.length || "some"} results`;
  }

  // Extract first line which usually has the status emoji + short message
  const firstLine = result.result.split("\n")[0] || "";

  // Strip "Contents of path:" prefix for reads — just say "Read X"
  if (firstLine.startsWith("Contents of ")) {
    const filePath = firstLine.replace("Contents of ", "").replace(/:$/, "");
    const fname = filePath.split(/[/\\]/).pop() || filePath;
    return `Read ${fname}`;
  }

  // For directory listings
  if (firstLine.includes("Directory listing:") || firstLine.includes("entries)")) {
    return firstLine.split("\n")[0];
  }

  // Success/error messages are already short enough — take first line, cap length
  if (firstLine.length > 80) return firstLine.slice(0, 77) + "…";
  return firstLine;
}

/**
 * Format tool results into a message to send back to the AI.
 */
export function formatToolResults(results: ToolResult[]): string {
  if (results.length === 1) {
    return `<tool_result>\n${results[0].result}\n</tool_result>`;
  }

  return results
    .map((r) => `<tool_result>\n[${r.tool}] ${r.result}\n</tool_result>`)
    .join("\n\n");
}

// ── System Prompt ──────────────────────────────────────────────

export function buildToolsPrompt(includeConnections: boolean = true, includeWebSearch: boolean = false, connectedProviders: string[] = []): string {
  let prompt = `\n## Available Tools

You have tools to work with project files. You MUST use these tools to create and edit files.

FORMAT — use this EXACT format (do NOT put inside code blocks):

<tool_call>{"name": "tool_name", "arguments": {"param": "value"}}</tool_call>

### Tools:

`;

  for (const tool of AVAILABLE_TOOLS) {
    // Skip web_search if not enabled
    if (tool.name === "web_search" && !includeWebSearch) continue;

    prompt += `**${tool.name}** — ${tool.description}\n`;
    prompt += `Parameters: ${tool.parameters}\n\n`;
  }

  prompt += `### Examples:

New file — use write_file:
<tool_call>{"name": "write_file", "arguments": {"path": "index.html", "content": "<!DOCTYPE html>\\n<html>\\n<body>\\n<h1>Hello</h1>\\n</body>\\n</html>"}}</tool_call>

Single change to an existing file — use edit_file:
<tool_call>{"name": "edit_file", "arguments": {"path": "styles.css", "search": "color: blue;", "replace": "color: red;"}}</tool_call>

Multiple changes to an existing file — use edit_file with an edits array (ONE call, not several write_file calls):
<tool_call>{"name": "edit_file", "arguments": {"path": "index.html", "edits": [{"search": "<title>Old</title>", "replace": "<title>New</title>"}, {"search": "<h1>Welcome</h1>", "replace": "<h1>Hello</h1>"}, {"search": "footer-old", "replace": "footer-new"}]}}</tool_call>

Running a command:
<tool_call>{"name": "run_command", "arguments": {"command": "npm test"}}</tool_call>

### GOOD vs BAD:
Task: "update the header color and footer text in index.html"
GOOD → one edit_file call with an edits array containing both changes.
BAD  → one write_file call that rewrites the entire index.html. This wastes output tokens and risks breaking unrelated code.

Task: "rename 'oldFunc' to 'newFunc' everywhere in utils.js"
GOOD → one edit_file call with an edits array, one entry per occurrence (use enough surrounding context so each search matches exactly once).
BAD  → rewriting the whole file.
`;

  if (includeWebSearch) {
    prompt += `
<tool_call>{"name": "web_search", "arguments": {"query": "tailwind css grid layout"}}</tool_call>
`;
  }

  prompt += `
<tool_call>{"name": "create_scheduled_task", "arguments": {"name": "Nightly Backup", "schedule": "Every day at 2:00 AM", "cron_expression": "0 2 * * *", "command": "cp -r ./src ./backups/src_backup"}}</tool_call>
`;

  prompt += `### RULES:
1. edit_file is MANDATORY for any change to an existing file, no matter how many things are changing. If you have 5 changes across one file, make ONE edit_file call with 5 entries in the edits array — do NOT call write_file. write_file on an existing file is only allowed when you are restructuring the file top-to-bottom (rare — ask yourself: is more than half the file changing? If no, use edit_file).
2. Each search string in edit_file must match EXACTLY ONCE in the file at the time that edit is applied. If the same text appears multiple times, include surrounding context in the search string to make it unique.
3. Within one edit_file call, edits apply in order. If edit #2 depends on text that edit #1 just created, the order works. If edit #1 and #2 conflict, the batch fails atomically — no changes are written.
4. The "content", "search", and "replace" values MUST be single-line JSON strings. Use \\n for newlines, \\" for quotes. NEVER use triple quotes or multi-line strings.
5. Place index.html at the project root. NOT inside src/ or public/.
6. Use relative paths WITH extensions for links: href="about.html" (NOT href="/about").
7. You can use multiple <tool_call> blocks in one response.
8. write_file auto-creates parent directories — you do NOT need to call create_directory first.
9. Always provide COMPLETE file content when using write_file (which should only be for NEW files). Do not use placeholders.
10. For the connection tool, always check the system prompt to see which services are connected before using them.
11. Use run_command to execute scripts, run tests, build commands, or other shell tasks. The command runs in the project directory. Do NOT run npm install, npm run dev, npm start, or any long-running dev server commands — the app handles dependency installation and dev servers automatically.
12. Use web_search when you need docs, error solutions, or API references you're unsure about. Keep queries short and specific.
13. Use create_scheduled_task when the user wants something to run automatically on a schedule (backups, deployments, cleanups, reports, etc.). Always provide both a cron_expression AND a plain English schedule. Set scope to "project" (default) for project-specific tasks, or "assistant" for personal/global tasks (email checks, calendar digests, reminders). Assistant-scoped tasks don't need a project_id. Available step action types: run_command, backup_files, git_commit, git_push, run_script, delete_files (executor: "local"), http_request, send_webhook (executor: "web"). Do NOT create code files for scheduling — use this tool instead.
`;

  // Only include detailed connection docs if any service is connected
  if (includeConnections) {
    prompt += connectedProviders.length > 0
      ? buildConnectionToolPrompt(connectedProviders)
      : connectionToolPrompt;
  }

  // Include screen control tools if enabled
  const screenSettings = loadScreenControlSettings();
  if (screenSettings.enabled) {
    prompt += `
### Screen Control (Desktop App Control)
You can see and control the user's screen. Use these tools to interact with ANY desktop application.

**screen_capture** — Take a screenshot. Returns an image you can analyze.
Parameters: {"crop_to_window": true}

**screen_action** — Perform a mouse/keyboard action.
Parameters vary by action type:
- CLICK: {"action": "CLICK", "x": 450, "y": 230}
- DOUBLE_CLICK: {"action": "DOUBLE_CLICK", "x": 450, "y": 230}
- RIGHT_CLICK: {"action": "RIGHT_CLICK", "x": 450, "y": 230}
- TYPE: {"action": "TYPE", "text": "hello world"}
- KEY: {"action": "KEY", "combo": "ctrl+s"}
- SCROLL: {"action": "SCROLL", "direction": "down", "amount": 3}
- DRAG: {"action": "DRAG", "x": 100, "y": 200, "x2": 400, "y2": 500}
- WAIT: {"action": "WAIT", "seconds": 2}

**screen_info** — Get active window name, title, dimensions, and screen size.
Parameters: {}

#### Screen control workflow:
1. Use screen_info to understand what app is active
2. Use screen_capture to see the screen
3. Describe what you see, then use screen_action to interact
4. Use screen_capture again to verify the result
5. Repeat until the task is done

#### Rules:
- Always describe what you see before acting
- Use screen_capture after actions to verify results
- If something unexpected appears (dialog, error, popup), handle it or ask the user
- If you're unsure about coordinates, describe the element and ask
- When confident, you can batch 2-3 actions between screenshots
- NEVER interact with password fields, payment screens, or send/submit buttons without asking the user first
`;
  }

  return prompt;
}

// ── Helpers ────────────────────────────────────────────────────

// SECURITY: Path traversal protection (Section 1)
// Resolves relative path and verifies it stays inside the project directory
function resolveProjectPath(projectPath: string, relativePath: string): string {
  const normalized = relativePath
    .replace(/^\$\([^)]*\)\//, "") // Remove $(root)/ etc.
    .replace(/^\.\//, "")          // Remove ./
    .replace(/^[/\\]+/, "")        // Remove leading slashes
    .replace(/\//g, "\\");         // Normalize to backslash

  const fullPath = `${projectPath}\\${normalized}`;

  // Resolve all ../ segments to get the real path
  const parts = fullPath.split(/[/\\]/);
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") {
      resolved.pop();
    } else if (part !== "." && part !== "") {
      resolved.push(part);
    }
  }
  const resolvedPath = resolved.join("\\");

  // Must start with project path (case-insensitive on Windows)
  const projectNorm = projectPath.toLowerCase().replace(/\//g, "\\");
  const resolvedNorm = resolvedPath.toLowerCase();

  if (!resolvedNorm.startsWith(projectNorm)) {
    throw new Error(`BLOCKED: Path "${relativePath}" resolves outside the project directory.`);
  }

  return resolvedPath;
}

function formatDirectoryListing(entries: FileEntry[], indent: string): string {
  let result = "";
  for (const entry of entries) {
    if (entry.is_dir) {
      result += `${indent}📁 ${entry.name}/\n`;
      if (entry.children) {
        result += formatDirectoryListing(entry.children, indent + "  ");
      }
    } else {
      result += `${indent}  ${entry.name}\n`;
    }
  }
  return result;
}

function filterBlocklisted(entries: FileEntry[]): FileEntry[] {
  return entries
    .filter(entry => !isBlocklisted(entry.name))
    .map(entry => {
      if (entry.is_dir && entry.children) {
        return { ...entry, children: filterBlocklisted(entry.children) };
      }
      return entry;
    });
}