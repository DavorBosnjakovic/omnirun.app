import { readFile, writeFile, readDirectory, createDirectory, deletePath, FileEntry } from "./fileService";
import { updateManifestEntry, removeManifestEntry, getRelativePath, ProjectManifest } from "./manifestService";
import { executeConnectionTool, connectionToolPrompt } from "./connectionTool";
import { webSearch, formatResultsForAI } from "./webSearchService";
import { updateContextFromAI, type ProjectContext as ContextData } from "./contextService";
import { createTask } from "../stores/taskStore";
import { useSettingsStore } from "../stores/settingsStore";
import { invoke } from "@tauri-apps/api/core";

// Blocklist: directories/files that should never be read or listed
const BLOCKLIST = [
  "node_modules", "dist", "build", ".git", ".next", "coverage",
  "__pycache__", ".venv", "target", "vendor", ".mydevify/snapshots",
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
    name: "write_file",
    description: "Create a new file or completely rewrite a file. Always provide the COMPLETE file content. For small changes to existing files, prefer edit_file instead.",
    parameters: '{"path": "relative/path/to/file", "content": "full file content here"}',
  },
  {
    name: "edit_file",
    description: "Make a targeted edit to an existing file. Provide a search string (must match exactly once in the file) and a replacement string. Much more efficient than rewriting the whole file.",
    parameters: '{"path": "relative/path/to/file", "search": "exact text to find", "replace": "replacement text"}',
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
    description: "Run a shell command in the project directory. Use for: running scripts (python, node), installing packages, running tests, building projects, or any CLI task. Returns stdout, stderr, and exit code. Be cautious with destructive commands — confirm with the user first.",
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
    name: "write_context",
    description: "Save important decisions or user preferences so you remember them in future conversations. Use after completing tasks to note things like design choices, tech decisions, or user style preferences.",
    parameters: '{"section": "decisions", "entries": ["Using localStorage for cart", "Stripe for payments"]}',
  },
  {
    name: "create_scheduled_task",
    description: "Create a scheduled task that runs automatically on a schedule. For simple tasks, just provide a command. For multi-step tasks, provide a steps array with executor ('local' or 'web') and action objects. Action types — local: run_command, backup_files, git_commit, git_push, run_script, delete_files. Web: http_request, send_webhook.",
    parameters: '{"name": "Nightly Backup", "description": "Back up src folder every night", "schedule": "Every day at 2:00 AM", "cron_expression": "0 2 * * *", "command": "cp -r ./src ./backups/src_backup"}',
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
  // ── Strategy 1: <tool_call>{JSON}</tool_call> (Claude, OpenAI, etc.) ──
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const toolCalls: ToolCall[] = [];
  let match;
  let firstMatchIndex = -1;
  let lastMatchEnd = 0;

  while ((match = toolCallRegex.exec(response)) !== null) {
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
    const textBefore = firstMatchIndex >= 0 ? response.slice(0, firstMatchIndex).trim() : response;
    const textAfter = lastMatchEnd > 0 ? response.slice(lastMatchEnd).trim() : "";
    return { textBefore, toolCalls, textAfter, hasToolCalls: true };
  }

  // ── Strategy 2: XML-style <read_file><path>...</path></read_file> (DeepSeek, etc.) ──
  const xmlResult = parseXmlStyleToolCalls(response);
  if (xmlResult.hasToolCalls) {
    return xmlResult;
  }

  // ── No tool calls found ──
  return {
    textBefore: response,
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
          throw new Error("Missing 'path' parameter. Use: {\"name\": \"edit_file\", \"arguments\": {\"path\": \"file.html\", \"search\": \"old text\", \"replace\": \"new text\"}}");
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

        const search = resolveSearchArg(args);
        if (search === undefined) {
          throw new Error("Missing 'search' parameter. Provide the exact text to find in the file.");
        }
        const replace = resolveReplaceArg(args);
        if (replace === undefined) {
          throw new Error("Missing 'replace' parameter. Provide the replacement text (use empty string to delete).");
        }

        const filePath = resolveProjectPath(projectPath, path);
        const existing = await readFile(filePath);

        // Count occurrences
        const occurrences = existing.split(search).length - 1;

        if (occurrences === 0) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ Search string not found in ${path}. Make sure the search text matches exactly (including whitespace and newlines). Use read_file to check the current contents.`,
            },
            updatedManifest,
          };
        }

        if (occurrences > 1) {
          return {
            result: {
              tool: name,
              success: false,
              result: `❌ Search string found ${occurrences} times in ${path}. It must match exactly once. Use a longer, more specific search string to target the right occurrence.`,
            },
            updatedManifest,
          };
        }

        // Exactly one match — do the replacement
        const updated = existing.replace(search, replace);

        // ── Approval gate ──
        if (onApproval) {
          const approved = await onApproval({
            id: `diff_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            action: "edit",
            filePath: path,
            oldContent: existing,
            newContent: updated,
            searchText: search,
            replaceText: replace,
          });

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

        await writeFile(filePath, updated);

        if (updatedManifest) {
          const relativePath = getRelativePath(projectPath, filePath);
          updatedManifest = updateManifestEntry(updatedManifest, relativePath, updated);
        }

        return {
          result: {
            tool: name,
            success: true,
            result: `✅ Edited: ${path} (replaced ${search.length} chars with ${replace.length} chars)`,
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

        const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>("execute_command", {
          command,
          cwd,
        });

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

        const section = args.section as "preferences" | "decisions";
        if (!section || !["preferences", "decisions"].includes(section)) {
          return {
            result: {
              tool: name,
              success: false,
              result: '❌ Invalid section. Use "preferences" or "decisions".',
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
              result: '❌ Missing entries. Use: {"section": "decisions", "entries": ["Using Stripe for payments"]}',
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

        // Determine project_id
        const taskProjectId = args.project_id || projectPath || undefined;

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
          enabled: true,
          steps,
          on_failure: onFailure,
        });

        if (created) {
          return {
            result: {
              tool: name,
              success: true,
              result: `✅ Scheduled task "${created.name}" created successfully!\n• Schedule: ${created.schedule || created.cron_expression}\n• Steps: ${created.steps.length}\n• Next run: ${created.next_run || "Calculating..."}\n\nThe task is now active and will run automatically. View it in Tools → Scheduled Tasks.`,
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

export function buildToolsPrompt(includeConnections: boolean = true, includeWebSearch: boolean = false): string {
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

<tool_call>{"name": "write_file", "arguments": {"path": "index.html", "content": "<!DOCTYPE html>\\n<html>\\n<body>\\n<h1>Hello</h1>\\n</body>\\n</html>"}}</tool_call>

<tool_call>{"name": "edit_file", "arguments": {"path": "styles.css", "search": "color: blue;", "replace": "color: red;"}}</tool_call>

<tool_call>{"name": "run_command", "arguments": {"command": "npm test"}}</tool_call>
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
1. Use edit_file for modifications to existing files. Use write_file only for new files or complete rewrites.
2. The "content", "search", and "replace" values MUST be single-line JSON strings. Use \\n for newlines, \\" for quotes. NEVER use triple quotes or multi-line strings.
3. Place index.html at the project root. NOT inside src/ or public/.
4. Use relative paths WITH extensions for links: href="about.html" (NOT href="/about").
5. You can use multiple <tool_call> blocks in one response.
6. write_file auto-creates parent directories — you do NOT need to call create_directory first.
7. Always provide COMPLETE file content when using write_file. Do not use placeholders.
8. For the connection tool, always check the system prompt to see which services are connected before using them.
9. Use run_command to execute scripts, install packages, run tests, or any shell command. The command runs in the project directory.
10. Use web_search when you need docs, error solutions, or API references you're unsure about. Keep queries short and specific.
11. Use create_scheduled_task when the user wants something to run automatically on a schedule (backups, deployments, cleanups, reports, etc.). Always provide both a cron_expression AND a plain English schedule. Available step action types: run_command, backup_files, git_commit, git_push, run_script, delete_files (executor: "local"), http_request, send_webhook (executor: "web"). Do NOT create code files for scheduling — use this tool instead.
`;

  // Only include detailed connection docs if any service is connected
  if (includeConnections) {
    prompt += connectionToolPrompt;
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