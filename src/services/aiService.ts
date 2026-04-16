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
  contextString?: string; // Lean context from contextService (~100-150 tokens)
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

const MAX_TOKENS_PER_TIER: Record<ModelTier, number> = {
  haiku: 4096,
  sonnet: 8192,
  opus: 16384,
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

function lastToolsWereReadOnly(messages: Message[]): boolean {
  const last = getLastAssistantMessage(messages);
  if (!last || !last.includes("<tool_call>")) return false;
  return !/"name"\s*:\s*"(?:write_file|edit_file|delete_file|run_command|create_directory)"/.test(last);
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

// Detect circular editing: same file written/edited 3+ times means model is struggling
function getMaxFileEditCount(messages: Message[]): number {
  const counts: Record<string, number> = {};
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const matches = msg.content.matchAll(/"name"\s*:\s*"(?:write_file|edit_file)"[\s\S]*?"path"\s*:\s*"([^"]+)"/g);
    for (const m of matches) {
      counts[m[1]] = (counts[m[1]] || 0) + 1;
    }
  }
  const values = Object.values(counts);
  return values.length > 0 ? Math.max(...values) : 0;
}

function routeModel(messages: Message[], projectContext?: ProjectContext): { model: string; maxTokens: number; tier: ModelTier } {
  // --- Guard: first real user message → skip escalation from stale history ---
  // When a conversation loads from DB, old failures could be in the array.
  // Don't let those trigger escalation on the user's fresh request.
  const realUserMessages = messages.filter((m) => m.role === "user" && !m.content.includes("<tool_result>"));
  const isFirstRequest = realUserMessages.length <= 1;

  // --- Escalation: any real failure → Opus (skip on first request) ---
  // If Sonnet or Haiku fumbled, the task is harder than expected. Send in Opus.
  if (!isFirstRequest) {
    const failures = countConsecutiveRealFailures(messages);
    if (failures >= 1) {
      return { model: ANTHROPIC_MODELS.opus, maxTokens: MAX_TOKENS_PER_TIER.opus, tier: "opus" };
    }

    // --- Circular editing (same file 3+ times) → model is struggling ---
    if (getMaxFileEditCount(messages) >= 3) {
      return { model: ANTHROPIC_MODELS.opus, maxTokens: MAX_TOKENS_PER_TIER.opus, tier: "opus" };
    }
  }

  // --- Image attached → Opus for vision + code quality ---
  if (lastMessageHasImages(messages)) {
    return { model: ANTHROPIC_MODELS.opus, maxTokens: MAX_TOKENS_PER_TIER.opus, tier: "opus" };
  }

  // --- AI asked a question → user is answering → Haiku ---
  const lastAction = detectLastAssistantAction(messages);
  if (lastAction === "asked_question") {
    return { model: ANTHROPIC_MODELS.haiku, maxTokens: MAX_TOKENS_PER_TIER.haiku, tier: "haiku" };
  }

  // --- AI only used read-only tools last turn → still exploring → Haiku ---
  if (lastAction === "used_tools" && lastToolsWereReadOnly(messages)) {
    return { model: ANTHROPIC_MODELS.haiku, maxTokens: MAX_TOKENS_PER_TIER.haiku, tier: "haiku" };
  }

  // --- Default: any code writing (new build or follow-up edits) → Opus ---
  return { model: ANTHROPIC_MODELS.opus, maxTokens: MAX_TOKENS_PER_TIER.opus, tier: "opus" };
}

export function buildSystemPrompt(context?: ProjectContext): string {
  // Detect if this is a new/empty project (no About section filled yet)
  const hasAbout = context?.contextString?.includes("## About");

  let prompt = `You are Omnirun, an AI development assistant built into a desktop app. You help users build websites and applications by generating code.
`;

  // ── Project Kickoff Instructions (only when About is empty) ──
  if (!hasAbout) {
    prompt += `
## NEW PROJECT KICKOFF — READ THIS FIRST
The project context has NO "About" section yet. This means you don't know what you're building.

MANDATORY RULE: Your FIRST tool calls in a new project MUST be write_context calls. You MUST save about, brief, styles, and conventions BEFORE your first write_file. No exceptions — even if the user gave you a complete spec.

**If the user's message is vague** (e.g. "build me a website"):
1. Ask clarifying questions in ONE grouped message. Cover: tech stack (SUGGEST one), design direction, key features, audience. Only ask what they haven't already specified.
2. After they answer, proceed to the MANDATORY saves below.

**If the user's message is a detailed spec** (tech stack, features, design, etc. are all clear):
1. Skip questions — go directly to the MANDATORY saves below.

**MANDATORY SAVES (always, before ANY write_file):**
- write_context("about", [...]) — one-liner: name, type, purpose, audience, status
- write_context("brief", [...]) — COMPREHENSIVE project document: product vision, all user flows in detail, business rules, feature list with priorities, design direction, technical constraints, what's in scope vs out of scope. Make this thorough — it's your primary reference in every future session.
- write_context("styles", [...]) — colors, fonts, spacing, layout patterns. If user didn't specify, SUGGEST good defaults and save them.
- write_context("conventions", [...]) — coding patterns for the chosen stack
- write_context("decisions", [...]) — tech choices made and why
- ONLY THEN call write_file to start building

**When building, create a COMPLETE, polished foundation** — not a bare HTML dump. If using React: set up proper project structure with components, routing, styling. If using HTML: include real CSS with a proper color scheme, responsive layout, navigation, and real content sections. The first build should look like a real website, not a skeleton.

NEVER skip the mandatory saves. A $0.10 context save prevents a $2.00 rebuild.
`;
  }

  prompt += `
When generating code:
- Generate complete, working files
- Use modern best practices
- If creating HTML, include all CSS and JS in the same file unless asked otherwise
- When editing existing files, provide the complete updated file

IMPORTANT: You have direct access to project files through tools. You MUST use them:
- Use list_directory to see what files and folders exist — don't guess the project structure.
- Use read_file to see file contents — never guess or ask the user to show you.
- Use write_file to create and edit files — never ask the user to copy/paste code.
- Use create_directory to make folders — never tell the user to create them.
- ALWAYS take action with tools. NEVER say "you should" or "you can" — just DO IT.
- When using tools, be concise. Do not explain what you're about to do or narrate your actions. Just do it and report results briefly.
- Only explore (list_directory/read_file) when you actually need to. If you already know the file from this conversation, just edit it directly.
- SCOPE RULE: Only modify files directly related to what the user asked for. Do NOT touch, "improve," or refactor files the user didn't mention. If a change to another file is truly necessary, explain why BEFORE making it and wait for approval.
- Do NOT run "npm install", "yarn install", "pnpm install", "npm run dev", "npm start", or any dev server commands. The app detects dependencies automatically and prompts the user to install them. The app also starts dev servers automatically. Just create the files and the app handles the rest.
- After completing a task, use write_context to save project knowledge that persists across conversations.
- CRITICAL — NEW PROJECT RULE: On your FIRST interaction with a new project (when About and Styles sections are empty), your FIRST tool calls MUST be write_context — BEFORE any write_file. Save about, brief, styles, conventions. If the user gave a detailed spec, save immediately without asking. If vague, ask first, then save. NEVER write_file before write_context in a new project.
- When you make design/code decisions during a task, PROACTIVELY save them to the right section without being asked.
- write_context sections (REPLACE = overwrites, APPEND = adds):
  "about" (REPLACE): product brief — name, type, purpose, audience, tone/voice, user roles, core flows, key features, business rules, monetization, integrations, current status
  "brief" (REPLACE): comprehensive project document — product vision, all user flows, business rules, feature list, design direction, technical constraints, scope. Written as rich prose. This is your primary reference for understanding the entire project.
  "styles" (REPLACE): colors (primary, secondary, accent, bg, text as hex), fonts (headings + body + mono), spacing scale, border-radius, shadows, animations (library + duration), layout (max-width, grid gap, container), responsive (breakpoints, mobile nav), dark/light mode, component patterns (card style, button variants, form inputs)
  "conventions" (REPLACE): coding patterns, naming rules, imports, error handling, file/folder structure
  "routes" (REPLACE): API endpoints (method + path + description) and page routes
  "schema" (REPLACE): database tables with columns, types, relationships, constraints
  "progress" (REPLACE): what you're currently working on
  "decisions" (APPEND): architectural / product choices
  "preferences" (APPEND): user workflow preferences
  "built" (APPEND): completed features — compress finished work here
- When the user wants to automate something on a schedule (backups, deployments, cleanups, checks, etc.), use the create_scheduled_task tool. Do NOT write scheduling code — use the built-in task scheduler instead. Common cron patterns: "0 2 * * *" (daily 2am), "0 17 * * 5" (Fridays 5pm), "0 0 * * 0" (weekly Sunday midnight), "0 */6 * * *" (every 6 hours).
- PROJECT KNOWLEDGE PERSISTENCE: When the user uploads or pastes a document containing project knowledge (specs, database schemas, design systems, business rules, API docs, requirements), save it proactively — don't ask, just do it:
  - Database schema/SQL → write_context("schema", [...])
  - Design specs/styles → write_context("styles", [...])
  - Project description/requirements → write_context("brief", [...])
  - API routes/endpoints → write_context("routes", [...])
  - General reference docs that don't fit a specific section → save with write_file to .omnirun/docs/descriptive-name.md
  - Briefly mention "💾 Saved to project knowledge" in your response
  - If the same type of content was saved before, UPDATE it (replace, don't duplicate)
  - Do NOT save ephemeral content (error logs, stack traces, screenshots for one-time fixes)
- SIMPLICITY: Write the minimum code that solves the problem. No speculative features, no abstractions for single-use code, no "just in case" flexibility. If 200 lines could be 50, make it 50.
- SURGICAL EDITS: When editing files, only change what's needed for the task. Don't "improve" adjacent code, comments, or formatting. Match the existing style. If your changes make imports or variables unused, clean those up — but don't touch pre-existing dead code unless asked.
- VERIFY BEFORE DONE: After completing a task, re-read the changed file to confirm it's correct. Don't report "done" on assumption.
- AMBIGUITY: If the request is unclear, state your interpretation and ask before building — don't guess silently. If a simpler approach exists, suggest it first.
`;

  // Get connection context early so we can use it for both tools prompt and services section
  const projectId = useProjectStore.getState().currentProject?.id;
  const connectionContext = getConnectionsSummary(projectId);
  const connectedProviders = projectId
    ? Object.entries(useConnectionsStore.getState().projectConnections[projectId] || {})
        .filter(([, c]) => c?.status === 'connected')
        .map(([p]) => p)
    : [];

  if (context) {
    // Lean context: project info + AI notes (~100-150 tokens)
    // NO file tree — AI uses list_directory when it needs to explore
    if (context.contextString) {
      prompt += `\n## Project Context\n${context.contextString}\n`;
    } else {
      prompt += `\n## Current Project\n- **Path:** ${context.path}\n`;
    }

    const hasConnections = connectedProviders.length > 0;
    const { webSearchEnabled, searchApiKey } = useSettingsStore.getState();
    const includeWebSearch = webSearchEnabled && !!searchApiKey.trim();
    prompt += buildToolsPrompt(hasConnections, includeWebSearch, connectedProviders);

    // Template context — let AI know the starting point
    if (context.templateId) {
      prompt += `\n## Template Origin\nThis project was created from the "${context.templateName || context.templateId}" template. The starter files are already in place. Build on top of them — don't recreate the scaffolding unless the user asks to start over.\n`;
    }
  }

  // Add connected services context (only if any are connected)
  if (connectionContext) {
    prompt += `\n## Connected Services\n${connectionContext}\n`;
  }

  // Add screen control instructions (only if enabled)
  prompt += buildScreenControlPrompt();

  return prompt;
}

/**
 * Build system prompt as structured content blocks for Anthropic prompt caching.
 * Static instructions go FIRST (cached). Dynamic project context goes LAST (not cached, but tiny).
 * cache_control is placed on the last static block so everything above it gets cached.
 */
function buildSystemPromptBlocks(context?: ProjectContext): Array<{ type: string; text: string; cache_control?: { type: string } }> {
  // ── Static instructions (identical across all projects/sessions) ──
  const staticInstructions = `You are Omnirun, an AI development assistant built into a desktop app. You help users build websites and applications by generating code.

When generating code:
- Generate complete, working files
- Use modern best practices
- If creating HTML, include all CSS and JS in the same file unless asked otherwise
- When editing existing files, provide the complete updated file

IMPORTANT: You have direct access to project files through tools. You MUST use them:
- Use list_directory to see what files and folders exist — don't guess the project structure.
- Use read_file to see file contents — never guess or ask the user to show you.
- Use write_file to create and edit files — never ask the user to copy/paste code.
- Use create_directory to make folders — never tell the user to create them.
- ALWAYS take action with tools. NEVER say "you should" or "you can" — just DO IT.
- When using tools, be concise. Do not explain what you're about to do or narrate your actions. Just do it and report results briefly.
- Only explore (list_directory/read_file) when you actually need to. If you already know the file from this conversation, just edit it directly.
- SCOPE RULE: Only modify files directly related to what the user asked for. Do NOT touch, "improve," or refactor files the user didn't mention. If a change to another file is truly necessary, explain why BEFORE making it and wait for approval.
- Do NOT run "npm install", "yarn install", "pnpm install", "npm run dev", "npm start", or any dev server commands. The app detects dependencies automatically and prompts the user to install them. The app also starts dev servers automatically. Just create the files and the app handles the rest.
- After completing a task, use write_context to save project knowledge that persists across conversations.
- CRITICAL — NEW PROJECT RULE: On your FIRST interaction with a new project (when About and Styles sections are empty), your FIRST tool calls MUST be write_context — BEFORE any write_file. Save about, brief, styles, conventions. If the user gave a detailed spec, save immediately without asking. If vague, ask first, then save. NEVER write_file before write_context in a new project.
- When you make design/code decisions during a task, PROACTIVELY save them to the right section without being asked.
- write_context sections (REPLACE = overwrites, APPEND = adds):
  "about" (REPLACE): product brief — name, type, purpose, audience, tone/voice, user roles, core flows, key features, business rules, monetization, integrations, current status
  "brief" (REPLACE): comprehensive project document — product vision, all user flows, business rules, feature list, design direction, technical constraints, scope. Written as rich prose. This is your primary reference for understanding the entire project.
  "styles" (REPLACE): colors (primary, secondary, accent, bg, text as hex), fonts (headings + body + mono), spacing scale, border-radius, shadows, animations (library + duration), layout (max-width, grid gap, container), responsive (breakpoints, mobile nav), dark/light mode, component patterns (card style, button variants, form inputs)
  "conventions" (REPLACE): coding patterns, naming rules, imports, error handling, file/folder structure
  "routes" (REPLACE): API endpoints (method + path + description) and page routes
  "schema" (REPLACE): database tables with columns, types, relationships, constraints
  "progress" (REPLACE): what you're currently working on
  "decisions" (APPEND): architectural / product choices
  "preferences" (APPEND): user workflow preferences
  "built" (APPEND): completed features — compress finished work here
- When the user wants to automate something on a schedule (backups, deployments, cleanups, checks, etc.), use the create_scheduled_task tool. Do NOT write scheduling code — use the built-in task scheduler instead. Common cron patterns: "0 2 * * *" (daily 2am), "0 17 * * 5" (Fridays 5pm), "0 0 * * 0" (weekly Sunday midnight), "0 */6 * * *" (every 6 hours).
- PROJECT KNOWLEDGE PERSISTENCE: When the user uploads or pastes a document containing project knowledge (specs, database schemas, design systems, business rules, API docs, requirements), save it proactively — don't ask, just do it:
  - Database schema/SQL → write_context("schema", [...])
  - Design specs/styles → write_context("styles", [...])
  - Project description/requirements → write_context("brief", [...])
  - API routes/endpoints → write_context("routes", [...])
  - General reference docs that don't fit a specific section → save with write_file to .omnirun/docs/descriptive-name.md
  - Briefly mention "💾 Saved to project knowledge" in your response
  - If the same type of content was saved before, UPDATE it (replace, don't duplicate)
  - Do NOT save ephemeral content (error logs, stack traces, screenshots for one-time fixes)
- ELEMENT SELECTION: When the user's message contains [ELEMENT SELECTED] or [ELEMENTS SELECTED] blocks, the user clicked a specific element in the live preview. The block contains the CSS selector, tag name, text content, and current computed styles. Use this to make precise, targeted changes to ONLY that element. Do not modify unrelated elements. When multiple elements are selected, apply changes consistently across all of them. Always use the selector path to locate the element in the source code.
- SIMPLICITY: Write the minimum code that solves the problem. No speculative features, no abstractions for single-use code, no "just in case" flexibility. If 200 lines could be 50, make it 50.
- SURGICAL EDITS: When editing files, only change what's needed for the task. Don't "improve" adjacent code, comments, or formatting. Match the existing style. If your changes make imports or variables unused, clean those up — but don't touch pre-existing dead code unless asked.
- VERIFY BEFORE DONE: After completing a task, re-read the changed file to confirm it's correct. Don't report "done" on assumption.
- AMBIGUITY: If the request is unclear, state your interpretation and ask before building — don't guess silently. If a simpler approach exists, suggest it first.`;

  // ── Tools prompt (static per session — tool definitions don't change) ──
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

  // Combine static parts into one block and mark for caching
  const screenControlPrompt = buildScreenControlPrompt();
  const staticText = toolsPrompt
    ? `${staticInstructions}\n${toolsPrompt}${screenControlPrompt}`
    : `${staticInstructions}${screenControlPrompt}`;

  const blocks: Array<{ type: string; text: string; cache_control?: { type: string } }> = [
    {
      type: "text",
      text: staticText,
      cache_control: { type: "ephemeral" },
    },
  ];

  // ── Dynamic project context (~100-150 tokens, changes per project) ──
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

    if (smartRouting) {
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