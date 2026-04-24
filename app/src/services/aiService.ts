import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { fetch } from "@tauri-apps/plugin-http";
import { ProjectManifest } from "./manifestService";
import { buildToolsPrompt } from "./toolService";
import { getConnectionsSummary, buildConnectionToolPrompt } from "./connectionTool";
import { useSettingsStore } from "../stores/settingsStore";
import { useConnectionsStore } from "../stores/connectionsStore";
import { useProjectStore } from "../stores/projectStore";
import { useTeamStore } from "../stores/teamStore";
import { loadScreenControlSettings } from "./screenControlService";
import { ANTHROPIC_MODELS as CENTRAL_ANTHROPIC_MODELS } from "../config/anthropicModels";
import type { MessageImage } from "../stores/chatStore";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  images?: MessageImage[];
}

interface Provider {
  id: string;
  apiKey: string;
  model: string;
  endpoint?: string;
}

interface ProjectContext {
  path: string;
  manifest: ProjectManifest | null;
  contextString?: string; // Lean context from contextService (~300-800 tokens)
  isNewProject?: boolean; // True when there's no saved context yet — AI should follow the kickoff steps shown in the project context banner
  templateId?: string;    // Template slug if project was created from a template
  templateName?: string;  // Template display name
}

export interface UsageData {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

const ENDPOINTS: Record<string, string> = {
  anthropic: "https://api.anthropic.com/v1/messages",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openai: "https://api.openai.com/v1/chat/completions",
  google: "https://generativelanguage.googleapis.com/v1beta/models",
  ollama: "http://localhost:11434/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
};


// ——— Smart Model Routing ————————————————————————————————————————
// Local rules pick the right model — no extra API call needed.
// Analyzes conversation history to detect phase, failures, and patterns.
// Escalation chain: Haiku → Sonnet → Opus (bumps on real failures).
//
// Haiku: exploring, asking questions, reading files, new projects
// Sonnet: writing code, building features, active development
// Opus: model is struggling (repeated failures or circular edits)

const ANTHROPIC_MODELS = {
  haiku:  "claude-haiku-4-5-20251001",
  sonnet: "claude-sonnet-4-5-20250929",
  opus:   "claude-opus-4-6",
} as const;

type ModelTier = "haiku" | "sonnet" | "opus";

// Output ceilings per tier. These are caps, not targets.
// Output tokens are ~5× more expensive than input, so tight ceilings
// matter — especially on Opus. A runaway full-file rewrite on Opus can
// single-handedly blow a task's budget. These ceilings force the AI
// to use edit_file (diffs) for typical changes.
const MAX_TOKENS_PER_TIER: Record<ModelTier, number> = {
  haiku: 16384,
  sonnet: 32768,
  opus: 32768,
};

// --- Conversation analysis helpers ---

function getLastAssistantMessage(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") return messages[i].content;
  }
  return null;
}

function detectLastAssistantAction(messages: Message[]): "asked_question" | "used_tools" | "just_talked" {
  const last = getLastAssistantMessage(messages);
  if (!last) return "just_talked";
  if (last.includes("<tool_call>")) return "used_tools";
  const lastParagraph = last.trim().split("\n").pop() || "";
  if (lastParagraph.includes("?")) return "asked_question";
  return "just_talked";
}

function lastMessageHasImages(messages: Message[]): boolean {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return !!(lastUser?.images && lastUser.images.length > 0);
}

// Errors the model can self-correct without needing a stronger model
const RECOVERABLE_PATTERNS = [
  "not found", "no such file", "missing", "blocked", "rate limited",
  "does not exist", "directory not found", "missing 'path'",
  "missing 'content'", "missing 'command'", "missing 'query'",
];

function isRecoverableError(line: string): boolean {
  const lower = line.toLowerCase();
  return RECOVERABLE_PATTERNS.some((p) => lower.includes(p));
}

// Walk backwards through tool results to count consecutive real failures.
// Recoverable errors (wrong path, missing param) are skipped — not counted, don't break chain.
// Successful tool results break the chain.
function countConsecutiveRealFailures(messages: Message[]): number {
  let failures = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user" || !msg.content.includes("<tool_result>")) continue;
    if (!msg.content.includes("❌")) break; // success — chain broken
    const errorLines = msg.content.split("\n").filter((l) => l.includes("❌"));
    if (errorLines.every((l) => isRecoverableError(l))) continue; // recoverable — skip
    failures++;
  }
  return failures;
}

// Walk backwards through tool results to count consecutive SUCCESSFUL turns.
// Currently unused — kept in place because stricter de-escalation (e.g. "require
// 2 successes before dropping from Opus") may want it. Safe to delete if never
// needed. Defined next to countConsecutiveRealFailures for symmetry.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function countConsecutiveSuccesses(messages: Message[]): number {
  let successes = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user" || !msg.content.includes("<tool_result>")) continue;
    if (msg.content.includes("❌")) {
      // Only break on real failures — recoverable errors don't count as failure
      const errorLines = msg.content.split("\n").filter((l) => l.includes("❌"));
      if (!errorLines.every((l) => isRecoverableError(l))) break;
      continue;
    }
    successes++;
  }
  return successes;
}

// Detect circular editing WITHIN THE CURRENT USER REQUEST only.
// Walks backward from the end of history, stopping at the most recent
// "real" user message (one without a tool_result — i.e. a fresh user
// instruction). This means 3 legitimate rounds of edits across 3 separate
// user requests do NOT count as thrashing. Only 3 edits to the same file
// within a single request (the model stuck fixing its own mistake) count.
function getMaxFileEditCountInCurrentRequest(messages: Message[]): number {
  const counts: Record<string, number> = {};
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    // Stop at the most recent real user message (new instruction)
    if (msg.role === "user" && !msg.content.includes("<tool_result>")) break;
    if (msg.role !== "assistant") continue;
    const matches = msg.content.matchAll(/"name"\s*:\s*"(?:write_file|edit_file)"[\s\S]*?"path"\s*:\s*"([^"]+)"/g);
    for (const m of matches) {
      counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
  }
  const values = Object.values(counts);
  return values.length > 0 ? Math.max(...values) : 0;
}

// Check whether the last TWO assistant tool-using turns were both read-only.
// Used for sticky Haiku routing — we only drop to Haiku when the model is
// clearly in a multi-turn exploration phase, not for a single read_file call
// in the middle of a writing task (which would waste a cache rebuild).
//
// "Write" tools include anything that modifies state — files (write_file,
// edit_file, delete_file, create_directory), shell commands (run_command),
// external services (connection, deploy), and scheduled tasks
// (create_scheduled_task). write_context is intentionally excluded — it saves
// low-stakes project notes that happen routinely, and including it would
// basically disable Haiku routing.
function lastTwoToolTurnsWereReadOnly(messages: Message[]): boolean {
  const toolTurns: string[] = [];
  for (let i = messages.length - 1; i >= 0 && toolTurns.length < 2; i--) {
    if (messages[i].role !== "assistant") continue;
    const content = messages[i].content;
    if (content.includes("<tool_call>")) toolTurns.push(content);
  }
  if (toolTurns.length < 2) return false;
  return toolTurns.every(
    (t) => !/"name"\s*:\s*"(?:write_file|edit_file|delete_file|run_command|create_directory|connection|deploy|create_scheduled_task)"/.test(t)
  );
}

// Does the conversation contain fresh evidence from this request?
// Fresh evidence = at least one tool_result AFTER the most recent real user
// message. If yes, escalation checks should run (fresh failures/thrash count).
// If no, the user just typed their instruction and nothing has happened yet —
// skip escalation so stale history doesn't trigger a spurious Opus bump.
// Replaces the old "isFirstRequest" guard which was too coarse: it disabled
// escalation on ANY single-user-message conversation, even when the AI had
// already failed mid-task within that request.
function hasFreshEvidence(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "user") continue;
    if (msg.content.includes("<tool_result>")) return true;   // tool result after most recent real user msg
    return false;                                             // real user msg with nothing after it
  }
  return false;
}

function routeModel(messages: Message[], projectContext?: ProjectContext): { model: string; maxTokens: number; tier: ModelTier } {
  // --- Image attached → Opus for vision + code quality (always) ---
  if (lastMessageHasImages(messages)) {
    return { model: ANTHROPIC_MODELS.opus, maxTokens: MAX_TOKENS_PER_TIER.opus, tier: "opus" };
  }

  // --- Escalation checks (only when fresh evidence exists) ---
  // "Fresh evidence" means tool results after the most recent real user message.
  // On a brand-new request with no AI turns yet, there's nothing to escalate
  // from. But once the AI has acted and produced results, failures/thrash in
  // THIS request (not stale prior-request failures) count.
  if (hasFreshEvidence(messages)) {
    const failures = countConsecutiveRealFailures(messages);
    const editThrash = getMaxFileEditCountInCurrentRequest(messages);

    // Real failures at the tail → escalate to Opus
    if (failures >= 1) {
      return { model: ANTHROPIC_MODELS.opus, maxTokens: MAX_TOKENS_PER_TIER.opus, tier: "opus" };
    }

    // Circular editing in the current request → model is stuck, escalate
    if (editThrash >= 3) {
      return { model: ANTHROPIC_MODELS.opus, maxTokens: MAX_TOKENS_PER_TIER.opus, tier: "opus" };
    }

    // De-escalation: if we reach here, failures === 0 (no trailing failures)
    // and thrash < 3. The task is going fine, so we naturally fall through
    // to the normal Sonnet/Haiku routing below. The old logic had no path
    // down from Opus; this one does — a single clean turn returns us to Sonnet.
  }

  // --- AI asked a question → user is answering → Haiku ---
  // Answering a question is lightweight; a single cheap turn is fine here
  // because it's unlikely to be followed by another switch.
  const lastAction = detectLastAssistantAction(messages);
  if (lastAction === "asked_question") {
    return { model: ANTHROPIC_MODELS.haiku, maxTokens: MAX_TOKENS_PER_TIER.haiku, tier: "haiku" };
  }

  // --- Sticky Haiku: AI has been exploring (read-only) for 2+ turns ---
  // Single-turn flips to Haiku waste cache rebuilds. Only drop to Haiku when
  // the model is clearly in a sustained exploration phase.
  if (lastAction === "used_tools" && lastTwoToolTurnsWereReadOnly(messages)) {
    return { model: ANTHROPIC_MODELS.haiku, maxTokens: MAX_TOKENS_PER_TIER.haiku, tier: "haiku" };
  }

  // --- Default: Sonnet for code writing ---
  // Sonnet handles almost all real coding work well and is ~5× cheaper than
  // Opus per token. Opus is reserved for escalations (failures, thrash,
  // images) above.
  return { model: ANTHROPIC_MODELS.sonnet, maxTokens: MAX_TOKENS_PER_TIER.sonnet, tier: "sonnet" };
}


// ═══════════════════════════════════════════════════════════════════
// System prompt — ONE source of truth
// ═══════════════════════════════════════════════════════════════════
// Anthropic: buildSystemPromptBlocks returns structured blocks for caching.
// Other providers: buildSystemPrompt flattens blocks into a plain string.
// New-project kickoff steps are inlined in the project context banner (not a separate file).

/** Static instructions — identical across all projects/sessions. Cached by Anthropic. */
const STATIC_INSTRUCTIONS = `You are Omnirun, an AI development assistant in a desktop app. You build and modify applications via tools.

# Code output
- Write complete, working files when creating new files.
- Use modern best practices.
- For HTML: include CSS and JS in the same file unless asked otherwise.
- For EXISTING files: always use edit_file with the list of changes. Never output a rewritten copy of an existing file as the normal way of making changes.

# Dependencies — load everything you use
- Any library, plugin, font, or icon you reference MUST be loaded in the same change. No feature without its matching <script>/<link> tag or import.
- Plugins load BEFORE their core script. Alpine plugins (x-intersect, x-collapse, x-mask), Swiper modules, Chart.js plugins, GSAP plugins — order matters, or the directives silently do nothing.
- Node projects: add packages to package.json dependencies. Don't import a package that isn't listed.
- NEVER hide content by default (opacity-0, x-show, display:none, visibility:hidden) waiting on JS to reveal it. If the script fails to load or a plugin is missing, the content MUST still be visible. Use CSS-only animations or intersection-observer with a fail-open default instead.
- Before finishing, re-read the file and confirm every referenced directive, class, font, icon pack, and import has a matching loader in the same file (or in the project manifest).

# Tools — ALWAYS act, never instruct
- list_directory / read_file: use only when you don't already know from this conversation.
- edit_file: MANDATORY for any change to an existing file. You can pass multiple edits in one call — do this instead of rewriting. Multiple edit_file calls in one response are expected and encouraged.
- write_file: for creating NEW files ONLY. Do not use write_file on an existing file unless you are restructuring it top-to-bottom (rare). Rewriting an existing file to change a few lines is wrong — use edit_file.
- create_directory: create folders yourself.
- NEVER say "you should" or "you can" — just DO IT.
- Be concise. Don't narrate your actions. Do the work, report briefly.
- SCOPE: Only touch files related to the request. If an unrelated change is truly necessary, explain why and wait for approval.
- DO NOT run npm/yarn/pnpm install, dev servers, or build commands — the app handles these automatically.
- ELEMENT SELECTION: If the user's message contains [ELEMENT SELECTED] blocks, they clicked a specific element in the live preview. Use the selector to locate and modify ONLY that element (or those elements when multiple).

# New project kickoff
If the project context below includes a "⚠️ NEW PROJECT" banner, follow the kickoff steps in that banner BEFORE calling write_file. The banner contains everything you need.

# Memory — when to write_context
Before saving anything, ask: "Would next session be worse without this?" If yes → save. If no → stay silent. Don't save to feel productive.

SAVE these:
- Decisions + WHY (architectural, product, tech choices with reasoning)
- Failed approaches with why they failed (prevents repeating them)
- Preferences the user has confirmed 3+ times
- User's naming conventions or workflow quirks specific to this project
- Product direction shifts or scope changes

DON'T SAVE these:
- Code changes visible in files ("added login page", "changed button color")
- Cosmetic tweaks, one-off fixes, typos
- Installed libraries (package.json already has them)
- Tech stack, file structure, schema (all re-derivable from files)
- Anything you can get by reading a config file or running grep

Write discipline: only save facts when the operation actually succeeded. A failed migration goes in as a failed attempt, not as a success.

## write_context sections

Topic files — REPLACE semantics, written as standalone files in .omnirun/:
- "about" → one-sentence description: what it is, who it's for
- "brief" → comprehensive project document: vision, user flows, business rules, feature list, design direction, scope. Your primary reference across sessions. Written to .omnirun/brief.md.
- "styles" → design language beyond tailwind.config/theme files: colors, fonts, spacing, component patterns, animations. Written to .omnirun/styles.md.
- "conventions" → coding patterns specific to this project: naming, imports, error handling, folder structure. Written to .omnirun/conventions.md.

Index sections — lists inside index.md:
- "decisions" (APPEND) — architectural/product choices with reasoning
- "preferences" (APPEND) — confirmed user preferences
- "built" (APPEND) — compress completed work here
- "progress" (REPLACE) — what you're working on right now

# Uploaded project knowledge
When the user uploads or pastes project knowledge, save it proactively — don't ask:
- Design spec → write_context("styles", [...])
- Product description / requirements → write_context("brief", [...])
- Database SQL or schema dump → write_file to .omnirun/docs/schema.sql (live DB connections via Supabase tools are preferred when available)
- General reference docs → write_file to .omnirun/docs/<descriptive-name>.md
- Mention briefly: "💾 Saved to project knowledge"
- If the same type was saved before, UPDATE it (replace, don't duplicate)
- DO NOT save ephemeral content (error logs, stack traces, debug screenshots)

# Scheduling
For automation on a schedule (backups, deployments, cleanups, checks) use the create_scheduled_task tool — do NOT write scheduling code yourself. Common cron patterns: "0 2 * * *" (daily 2am), "0 17 * * 5" (Fridays 5pm), "0 0 * * 0" (weekly Sunday midnight), "0 */6 * * *" (every 6 hours).

# Quality rules
- SIMPLICITY: Write the minimum code that solves the problem. If 200 lines could be 50, make it 50.
- SURGICAL EDITS: Only change what's needed. Don't reformat adjacent code or improve pre-existing dead code unless asked.
- VERIFY: After completing a task, re-read the changed file to confirm it's correct.
- AMBIGUITY: If unclear, state your interpretation and ask before building.`;

/**
 * Build system prompt as content blocks.
 * Static instructions + tools + screen-control share ONE cached block.
 * Dynamic pieces (project context, connection summary, template origin) come after the cache breakpoint.
 */
function buildSystemPromptBlocks(context?: ProjectContext): Array<{ type: string; text: string; cache_control?: { type: string } }> {
  const projectId = useProjectStore.getState().currentProject?.id;
  const connectionContext = getConnectionsSummary(projectId);
  const connectedProviders = projectId
    ? Object.entries(useConnectionsStore.getState().projectConnections[projectId] || {})
        .filter(([, c]) => c?.status === 'connected')
        .map(([p]) => p)
    : [];
  const hasConnections = connectedProviders.length > 0;
  const { webSearchEnabled, searchApiKey } = useSettingsStore.getState();
  const includeWebSearch = webSearchEnabled && !!searchApiKey.trim();
  const toolsPrompt = context ? buildToolsPrompt(hasConnections, includeWebSearch, connectedProviders) : "";
  const screenControlPrompt = buildScreenControlPrompt();

  // ── Static cached block: instructions + tools + screen control ──
  const staticText = [STATIC_INSTRUCTIONS, toolsPrompt, screenControlPrompt]
    .filter(s => s && s.trim().length > 0)
    .join("\n\n");

  const blocks: Array<{ type: string; text: string; cache_control?: { type: string } }> = [
    { type: "text", text: staticText, cache_control: { type: "ephemeral" } },
  ];

  // ── Dynamic project context (~300-800 tokens, changes per project) ──
  if (context) {
    if (context.contextString) {
      blocks.push({ type: "text", text: `## Project Context\n${context.contextString}` });
    } else {
      blocks.push({ type: "text", text: `## Current Project\n- **Path:** ${context.path}` });
    }
  }

  // ── Connection summary (only if active) ──
  if (connectionContext) {
    blocks.push({ type: "text", text: `## Connected Services\n${connectionContext}` });
  }

  // ── Template origin (only if project was created from a template) ──
  if (context?.templateId) {
    blocks.push({
      type: "text",
      text: `## Template Origin\nThis project was created from the "${context.templateName || context.templateId}" template. The starter files are already in place. Build on top of them — don't recreate the scaffolding unless the user asks to start over.`,
    });
  }

  return blocks;
}

/** Flatten blocks to a plain string for providers that don't support structured system prompts. */
export function buildSystemPrompt(context?: ProjectContext): string {
  return buildSystemPromptBlocks(context)
    .map(b => b.text)
    .filter(t => t && t.length > 0)
    .join("\n\n");
}


export function flattenFileTree(entries: any[], prefix = ""): string {
  let result = "";
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.is_dir) {
      result += `📁 ${path}/\n`;
      if (entry.children) {
        result += flattenFileTree(entry.children, path);
      }
    } else {
      result += `  ${path}\n`;
    }
  }
  return result;
}

// ──── Screen Control System Prompt ────────────────────────────
// Instructions for the AI when desktop app control is enabled.
// Used by both the Projects chat and the Assistant chat.

export function buildScreenControlPrompt(): string {
  const settings = loadScreenControlSettings();
  if (!settings.enabled) return "";

  return `
## Desktop App Control
You can see and control the user's computer screen. You have access to screenshot capture, mouse, and keyboard simulation.

### How it works:
1. Take a screenshot to see the screen (screen_capture tool)
2. Analyze what you see — describe it before acting
3. Perform actions: click, type, press keys, scroll (screen_action tool)
4. Take another screenshot to verify the result
5. Repeat until the task is complete

### Action format:
When using the screen_action tool, specify the action type and parameters:
- CLICK at coordinates: {"action": "CLICK", "x": 450, "y": 230}
- DOUBLE_CLICK: {"action": "DOUBLE_CLICK", "x": 450, "y": 230}
- RIGHT_CLICK: {"action": "RIGHT_CLICK", "x": 450, "y": 230}
- TYPE text: {"action": "TYPE", "text": "hello world"}
- KEY combo: {"action": "KEY", "combo": "ctrl+s"} (supports: ctrl, alt, shift, meta/cmd, enter, tab, escape, f1-f12, etc.)
- SCROLL: {"action": "SCROLL", "direction": "down", "amount": 3}
- DRAG: {"action": "DRAG", "x": 100, "y": 200, "x2": 400, "y2": 500}
- WAIT: {"action": "WAIT", "seconds": 2}

### Screen resolution:
The screenshot dimensions are included in the tool result. Use these to calibrate your click coordinates.

### Safety rules — CRITICAL:
- ALWAYS describe what you see before performing any action
- NEVER click send/submit/post buttons, enter password fields, or interact with payment screens without explicit user approval
- If something unexpected appears (error dialog, popup, wrong app), stop and ask the user
- When the task is complete, tell the user "Done" and summarize what you did
- If you cannot complete the task, explain why

### Efficiency tips:
- Use screen_info first to check which app is active (cheaper than a screenshot)
- When confident, batch 2-3 related actions from one screenshot (e.g. click field, type value, press tab)
- Skip verification screenshots for simple, confident actions (typing into a field you just clicked)
- Only take a new screenshot when navigating somewhere new, after a potentially state-changing action, or to verify completion
`;
}

// ——— Format messages with images for each provider ——————————————

function formatAnthropicMessages(messages: Message[]) {
  const formatted = messages.map((m) => {
    if (m.images && m.images.length > 0) {
      const content: any[] = [];
      // Images first
      for (const img of m.images) {
        content.push({
          type: "image",
          source: {
            type: "base64",
            media_type: img.mimeType,
            data: img.base64,
          },
        });
      }
      // Then text
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      return { role: m.role, content };
    }
    return { role: m.role, content: m.content };
  });

  // Add cache breakpoint on second-to-last user message.
  // This caches the entire conversation prefix up to that point,
  // so only the latest user message + assistant response are uncached.
  if (formatted.length >= 3) {
    // Find indices of user messages
    const userIndices: number[] = [];
    formatted.forEach((m, i) => { if (m.role === "user") userIndices.push(i); });

    if (userIndices.length >= 2) {
      const idx = userIndices[userIndices.length - 2];
      const msg = formatted[idx];

      if (typeof msg.content === "string") {
        msg.content = [{
          type: "text",
          text: msg.content,
          cache_control: { type: "ephemeral" },
        }];
      } else if (Array.isArray(msg.content) && msg.content.length > 0) {
        const lastBlock = msg.content[msg.content.length - 1];
        lastBlock.cache_control = { type: "ephemeral" };
      }
    }
  }

  return formatted;
}

function formatOpenAIMessages(messages: Message[], systemPrompt: string) {
  const formatted: any[] = [{ role: "system", content: systemPrompt }];

  for (const m of messages) {
    if (m.images && m.images.length > 0) {
      const content: any[] = [];
      // Images first
      for (const img of m.images) {
        content.push({
          type: "image_url",
          image_url: {
            url: `data:${img.mimeType};base64,${img.base64}`,
          },
        });
      }
      // Then text
      if (m.content) {
        content.push({ type: "text", text: m.content });
      }
      formatted.push({ role: m.role, content });
    } else {
      formatted.push({ role: m.role, content: m.content });
    }
  }

  return formatted;
}

function formatGoogleMessages(messages: Message[], systemPrompt: string) {
  const contents: any[] = [
    { role: "user", parts: [{ text: systemPrompt }] },
    { role: "model", parts: [{ text: "Understood. I'm ready to help." }] },
  ];

  for (const m of messages) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts: any[] = [];

    // Images first
    if (m.images && m.images.length > 0) {
      for (const img of m.images) {
        parts.push({
          inline_data: {
            mime_type: img.mimeType,
            data: img.base64,
          },
        });
      }
    }
    // Then text
    if (m.content) {
      parts.push({ text: m.content });
    }

    contents.push({ role, parts });
  }

  return contents;
}

// ——— History Trimming (Phase 3.1) ——————————————————————————————————
// Collapse consumed tool results to save tokens.
// Any tool_result that the AI has already responded to gets replaced
// with a short summary. Only the most recent tool_result (not yet
// consumed) keeps its full content.

function trimHistory(messages: Message[]): Message[] {
  const trimmed: Message[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Only process user messages that contain tool results
    if (msg.role !== "user" || !msg.content.includes("<tool_result>")) {
      trimmed.push(msg);
      continue;
    }

    // Check if there's an assistant message AFTER this one.
    // If yes, the AI already consumed this result — safe to collapse.
    const hasAssistantAfter = messages.slice(i + 1).some((m) => m.role === "assistant");

    if (!hasAssistantAfter) {
      // This is the most recent tool result — keep full content
      trimmed.push(msg);
      continue;
    }

    // Collapse the tool result content, preserving images if any
    trimmed.push({
      ...msg,
      content: collapseToolResult(msg.content),
    });
  }

  return trimmed;
}

function collapseToolResult(content: string): string {
  // Process each <tool_result>...</tool_result> block in the message
  return content.replace(
    /<tool_result>\n?([\s\S]*?)\n?<\/tool_result>/g,
    (_match, inner: string) => {
      const collapsed = collapseSingleResult(inner.trim());
      return `<tool_result>\n${collapsed}\n</tool_result>`;
    }
  );
}

function collapseSingleResult(result: string): string {
  // Already short (covers ✅ Written, ✅ Edited, short errors) — keep as-is
  if (result.length < 300) return result;

  // Strip optional [tool_name] prefix for pattern matching, re-add after
  let prefix = "";
  let body = result;
  const prefixMatch = result.match(/^\[(\w+)\]\s*/);
  if (prefixMatch) {
    prefix = prefixMatch[0];
    body = result.slice(prefix.length);
  }

  // Pattern 1: File read — "Contents of path:\n```\n...content...\n```"
  const fileReadMatch = body.match(/^Contents of (.+?):\n```\n([\s\S]*)\n```$/);
  if (fileReadMatch) {
    const filePath = fileReadMatch[1];
    const lineCount = fileReadMatch[2].split("\n").length;
    return `${prefix}[read ${filePath} — ${lineCount} lines]`;
  }

  // Pattern 2: Directory listing — "Contents of path:\n..."
  const dirMatch = body.match(/^Contents of (.+?):\n/);
  if (dirMatch) {
    const dirPath = dirMatch[1];
    const entryCount = body.split("\n").length - 1;
    return `${prefix}[listed ${dirPath} — ${entryCount} entries]`;
  }

  // Pattern 3: Multiple file reads in one result
  const multiFileMatches = body.match(/Contents of .+?:/g);
  if (multiFileMatches && multiFileMatches.length > 1) {
    const files = multiFileMatches.map((m) => m.replace("Contents of ", "").replace(":", ""));
    return `${prefix}[read ${files.length} files: ${files.join(", ")}]`;
  }

  // Fallback: keep first line + collapsed note
  const firstLine = body.split("\n")[0];
  return `${prefix}${firstLine} [...collapsed, ${body.length} chars]`;
}

// ——— History Limiting (Phase 3.2) —————————————————————————————————
// Keep only the last 10 user/assistant pairs (20 messages).
// Older turns are dropped — the AI still has the project manifest
// for context about what files exist.

const MAX_HISTORY_PAIRS = 10;

function limitHistory(messages: Message[]): Message[] {
  if (messages.length <= MAX_HISTORY_PAIRS * 2) return messages;

  // Keep the last 20 messages (10 pairs)
  return messages.slice(-MAX_HISTORY_PAIRS * 2);
}

// ——— Main send function —————————————————————————————————————————

export async function sendMessage(
  messages: Message[],
  provider: Provider,
  onStream?: (chunk: string) => void,
  projectContext?: ProjectContext,
  signal?: AbortSignal,
  onReader?: (reader: ReadableStreamDefaultReader) => void
): Promise<{ text: string; usage: UsageData; model: string }> {
  let endpoint = provider.endpoint || ENDPOINTS[provider.id];

  // ── Project locking (team feature) ─────────────────────────
  // On first AI message in a project, auto-lock it for this user.
  // If locked by someone else, block the send.
  if (projectContext?.path) {
    const teamState = useTeamStore.getState();
    const projectName = useProjectStore.getState().currentProject?.name;

    if (teamState.hasTeam && projectName) {
      // Track activity (resets idle timer)
      teamState.trackActivity();

      // Check if locked by someone else
      const { user } = await import('../stores/authStore').then(m => ({
        user: m.useAuthStore.getState().user,
      }));

      if (user?.id && teamState.isProjectLocked(projectName) && !teamState.isProjectLockedByMe(projectName, user.id)) {
        const lockedBy = teamState.getLockedByName(projectName);
        throw new Error(`🔒 ${lockedBy} is currently working on this project. You'll be notified when it's available.`);
      }

      // Auto-lock on first AI message (upsert — safe to call repeatedly)
      if (user?.id && !teamState.isProjectLockedByMe(projectName, user.id)) {
        const { error } = await teamState.lockProject(projectName);
        if (error) {
          throw new Error(`🔒 ${error}`);
        }
      }
    }
  }

  // Trim consumed tool results, then limit to last 10 pairs
  const trimmedMessages = limitHistory(trimHistory(messages));

  // Strip images for providers that don't support image_url in messages
  const supportsImages = ["anthropic", "openai", "google"].includes(provider.id);
  const cleanMessages = supportsImages
    ? trimmedMessages
    : trimmedMessages.map((m) => ({ ...m, images: undefined }));

  // Load user memory block for project chat (what the AI knows about this user).
  // Uses dynamic import to avoid circular dependency (memoryService imports sendMessage).
  // Only loads when there's a real project path (skips background memory/extraction calls).
  // Timeout: 3 seconds max — never block the AI call for memory.
  let memoryBlock = '';
  if (projectContext?.path) {
    try {
      const memoryPromise = import('./memoryService').then(m => m.buildMemoryBlock());
      const timeoutPromise = new Promise<string>((resolve) => setTimeout(() => resolve(''), 3000));
      memoryBlock = await Promise.race([memoryPromise, timeoutPromise]);
    } catch {
      // Non-fatal — proceed without memory
      console.warn('[aiService] Memory block loading failed (non-fatal)');
    }
  }

  if (provider.id === "ollama" && provider.apiKey) {
    const baseUrl = provider.apiKey.replace(/\/+$/, "");
    endpoint = `${baseUrl}/v1/chat/completions`;
  }

  if (provider.id === "anthropic") {
    const { smartRouting } = useSettingsStore.getState();
    let model = provider.model;
    let maxTokens = 16384;

    // Skip smart routing for background calls (memory extraction, compression).
    // They explicitly chose the cheapest model — respect it.
    const isBackgroundCall = !projectContext?.path;

    if (smartRouting && !isBackgroundCall) {
      const route = routeModel(trimmedMessages, projectContext);
      model = route.model;
      maxTokens = route.maxTokens;
    }

    const routedProvider = { ...provider, model };
    const systemBlocks = buildSystemPromptBlocks(projectContext);
    // Append user memory as a dynamic block (not cached — changes between sessions)
    if (memoryBlock) {
      systemBlocks.push({ type: "text", text: memoryBlock });
    }
    const result = await sendAnthropicMessage(cleanMessages, routedProvider, systemBlocks, maxTokens, onStream, onReader);
    return { ...result, model };
  }

  // All other providers: plain string system prompt
  const systemPrompt = buildSystemPrompt(projectContext) + memoryBlock;

  if (provider.id === "google") {
    const result = await sendGoogleMessage(cleanMessages, provider, systemPrompt);
    return { ...result, model: provider.model };
  } else {
    if (!endpoint) {
      throw new Error("No API endpoint configured. Please check your provider settings.");
    }
    const result = await sendOpenAICompatibleMessage(cleanMessages, provider, endpoint, systemPrompt, onStream, onReader);
    return { ...result, model: provider.model };
  }
}

async function sendAnthropicMessage(
  messages: Message[],
  provider: Provider,
  systemBlocks: Array<{ type: string; text: string; cache_control?: { type: string } }>,
  maxTokens: number,
  onStream?: (chunk: string) => void,
  onReader?: (reader: ReadableStreamDefaultReader) => void
): Promise<{ text: string; usage: UsageData }> {
  const formattedMessages = formatAnthropicMessages(messages);

  const requestBody = {
    model: provider.model,
    max_tokens: maxTokens,
    system: systemBlocks,
    messages: formattedMessages,
    stream: !!onStream,
  };

  const usage: UsageData = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  // ── Streaming path: use Rust proxy (bypasses tauri-plugin-http timeout) ──
  // The plugin's fetch() kills SSE streams when Opus pauses 10-30s to think.
  // The Rust command uses reqwest with NO read timeout, so pauses are fine.
  if (onStream) {
    const streamId = crypto.randomUUID();
    const eventName = `ai-stream-${streamId}`;

    return new Promise(async (resolve, reject) => {
      let fullContent = "";
      let stopped = false;

      // Set up the event listener BEFORE invoking the command
      const unlisten = await listen<{
        stream_id: string;
        data: string;
        done: boolean;
        error: string | null;
        status: number | null;
      }>(eventName, (event) => {
        if (stopped) return;
        const chunk = event.payload;

        // Error from Rust (network error or HTTP error status)
        if (chunk.error) {
          unlisten();
          reject(new Error(
            chunk.status
              ? `API Error: ${chunk.status} - ${chunk.data}`
              : chunk.error
          ));
          return;
        }

        // Stream complete
        if (chunk.done) {
          unlisten();
          resolve({ text: fullContent, usage });
          return;
        }

        // Process SSE lines from this chunk
        const lines = chunk.data.split("\n").filter((line: string) => line.startsWith("data: "));
        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);

            // Content streaming
            if (parsed.type === "content_block_delta") {
              const content = parsed.delta?.text || "";
              if (content) {
                fullContent += content;
                onStream(content);
              }
            }

            // Anthropic sends input tokens in message_start
            if (parsed.type === "message_start" && parsed.message?.usage) {
              usage.inputTokens = parsed.message.usage.input_tokens || 0;
              usage.cacheCreationTokens = parsed.message.usage.cache_creation_input_tokens || 0;
              usage.cacheReadTokens = parsed.message.usage.cache_read_input_tokens || 0;
            }

            // Anthropic sends output tokens in message_delta
            if (parsed.type === "message_delta" && parsed.usage) {
              usage.outputTokens = parsed.usage.output_tokens || 0;
            }
          } catch {
            // Skip invalid JSON (partial chunks)
          }
        }
      });

      // Provide a fake "reader" so the stop button works.
      // The caller calls reader.cancel() to abort — we just stop
      // processing events and resolve with what we have so far.
      if (onReader) {
        const fakeReader = {
          cancel: () => {
            stopped = true;
            unlisten();
            resolve({ text: fullContent, usage });
            return Promise.resolve();
          },
          read: () => Promise.resolve({ done: true, value: undefined }),
          releaseLock: () => {},
          closed: Promise.resolve(undefined),
        } as unknown as ReadableStreamDefaultReader;
        onReader(fakeReader);
      }

      // Fire the Rust command — returns immediately, chunks come via events
      try {
        await invoke("stream_ai_request", {
          url: ENDPOINTS.anthropic,
          headers: {
            "Content-Type": "application/json",
            "x-api-key": provider.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-beta": "token-efficient-tools-2025-02-19",
            "User-Agent": "Mozilla/5.0",
          },
          body: JSON.stringify(requestBody),
          streamId,
        });
      } catch (e) {
        unlisten();
        reject(e);
      }
    });
  }

  // ── Non-streaming path: use plugin-http fetch (no timeout issue) ──
  const response = await fetch(ENDPOINTS.anthropic, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "token-efficient-tools-2025-02-19",
      "anthropic-dangerous-direct-browser-access": "true",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Capture usage from non-streaming response
  if (data.usage) {
    usage.inputTokens = data.usage.input_tokens || 0;
    usage.outputTokens = data.usage.output_tokens || 0;
    usage.cacheCreationTokens = data.usage.cache_creation_input_tokens || 0;
    usage.cacheReadTokens = data.usage.cache_read_input_tokens || 0;
  }

  return { text: data.content?.[0]?.text || "", usage };
}

async function sendOpenAICompatibleMessage(
  messages: Message[],
  provider: Provider,
  endpoint: string,
  systemPrompt: string,
  onStream?: (chunk: string) => void,
  onReader?: (reader: ReadableStreamDefaultReader) => void
): Promise<{ text: string; usage: UsageData }> {
  const allMessages = formatOpenAIMessages(messages, systemPrompt);

  const requestBody: any = {
    model: provider.model,
    messages: allMessages,
    stream: !!onStream,
  };

  // Ask for usage data in streaming mode (OpenAI & Groq support this)
  if (onStream) {
    requestBody.stream_options = { include_usage: true };
  }

  const usage: UsageData = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  // ── Streaming path: use Rust proxy (bypasses tauri-plugin-http timeout) ──
  if (onStream) {
    const streamId = crypto.randomUUID();
    const eventName = `ai-stream-${streamId}`;

    return new Promise(async (resolve, reject) => {
      let fullContent = "";
      let stopped = false;

      const unlisten = await listen<{
        stream_id: string;
        data: string;
        done: boolean;
        error: string | null;
        status: number | null;
      }>(eventName, (event) => {
        if (stopped) return;
        const chunk = event.payload;

        if (chunk.error) {
          unlisten();
          reject(new Error(
            chunk.status
              ? `API Error: ${chunk.status} - ${chunk.data}`
              : chunk.error
          ));
          return;
        }

        if (chunk.done) {
          unlisten();
          resolve({ text: fullContent, usage });
          return;
        }

        const lines = chunk.data.split("\n").filter((line: string) => line.startsWith("data: "));
        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || "";
            if (content) {
              fullContent += content;
              onStream(content);
            }

            // Capture usage from the final chunk (OpenAI/Groq send it here)
            if (parsed.usage) {
              usage.inputTokens = parsed.usage.prompt_tokens || 0;
              usage.outputTokens = parsed.usage.completion_tokens || 0;
            }
          } catch {
            // Skip invalid JSON
          }
        }
      });

      // Stop button support
      if (onReader) {
        const fakeReader = {
          cancel: () => {
            stopped = true;
            unlisten();
            resolve({ text: fullContent, usage });
            return Promise.resolve();
          },
          read: () => Promise.resolve({ done: true, value: undefined }),
          releaseLock: () => {},
          closed: Promise.resolve(undefined),
        } as unknown as ReadableStreamDefaultReader;
        onReader(fakeReader);
      }

      try {
        await invoke("stream_ai_request", {
          url: endpoint,
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${provider.apiKey}`,
            "User-Agent": "Mozilla/5.0",
          },
          body: JSON.stringify(requestBody),
          streamId,
        });
      } catch (e) {
        unlisten();
        reject(e);
      }
    });
  }

  // ── Non-streaming path: use plugin-http fetch ──
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${provider.apiKey}`,
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  // Capture usage from non-streaming response
  if (data.usage) {
    usage.inputTokens = data.usage.prompt_tokens || 0;
    usage.outputTokens = data.usage.completion_tokens || 0;
  }

  return { text: data.choices?.[0]?.message?.content || "", usage };
}

async function sendGoogleMessage(
  messages: Message[],
  provider: Provider,
  systemPrompt: string
): Promise<{ text: string; usage: UsageData }> {
  const endpoint = `${ENDPOINTS.google}/${provider.model}:generateContent?key=${provider.apiKey}`;
  const contents = formatGoogleMessages(messages, systemPrompt);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ contents }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error: ${response.status} - ${error}`);
  }

  const data = await response.json();

  const usage: UsageData = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };

  // Google sends usage in usageMetadata
  if (data.usageMetadata) {
    usage.inputTokens = data.usageMetadata.promptTokenCount || 0;
    usage.outputTokens = data.usageMetadata.candidatesTokenCount || 0;
  }

  return { text: data.candidates?.[0]?.content?.parts?.[0]?.text || "", usage };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}