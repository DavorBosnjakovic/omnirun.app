// ============================================================
// Memory Service
// ============================================================
// Core logic for the 3-layer memory system.
//
// Layer 1: user_context.md — global identity, always loaded
// Layer 2: project context — .omnirun/context.md per project (handled by contextService, not here)
// Layer 3: vector store — sqlite-vec (future, not in this build)
//
// This service handles:
// - Loading/saving user context from SQLite
// - Observation extraction after conversations (Haiku, silent background)
// - Weekly compression (updates context, enforces 3000 token cap)
// - Memory settings (toggles + sync)
//
// All storage is local (SQLite). Supabase sync is future/opt-in.

import { dbService } from './dbService';
import { sendMessage } from './aiService';

// ─── Types ───────────────────────────────────────────────────

export interface MemorySettings {
  learnAssistant: boolean;  // learn from Assistant conversations
  learnProjects: boolean;   // learn from Project conversations
  learnVoice: boolean;      // learn writing voice
  syncEnabled: boolean;     // sync to cloud (future)
}

export interface MemoryObservation {
  id: number;
  content: string;
  source: 'assistant' | 'project' | 'voice';
  sessionId: string | null;
  createdAt: string;
}

// ─── Default context template ────────────────────────────────

const DEFAULT_CONTEXT = `## Identity
[Not yet known]

## How They Work
[Will be learned from conversations]

## Current Focus
[Will be updated as they work]

## Their Projects
[Will be populated as they build]

## Strong Preferences
[Will be learned over time]

## Patterns Observed
[Will emerge from conversations]

## Things That Have Gone Wrong
[Will be tracked to avoid repeating]

## Things To Always Remember
[Important facts will be stored here]

## Voice & Style
[Will be learned when drafting content]`;

// ─── Settings ────────────────────────────────────────────────

const DEFAULT_SETTINGS: MemorySettings = {
  learnAssistant: true,
  learnProjects: true,
  learnVoice: true,
  syncEnabled: false,
};

export async function getMemorySettings(): Promise<MemorySettings> {
  try {
    const row = await dbService.getMemorySettings();
    if (!row) return DEFAULT_SETTINGS;
    return {
      learnAssistant: row.learn_assistant === 1,
      learnProjects: row.learn_projects === 1,
      learnVoice: row.learn_voice === 1,
      syncEnabled: row.sync_enabled === 1,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveMemorySettings(settings: MemorySettings): Promise<void> {
  await dbService.saveMemorySettings({
    learn_assistant: settings.learnAssistant ? 1 : 0,
    learn_projects: settings.learnProjects ? 1 : 0,
    learn_voice: settings.learnVoice ? 1 : 0,
    sync_enabled: settings.syncEnabled ? 1 : 0,
  });
}

// ─── User context ────────────────────────────────────────────

export async function loadUserContext(): Promise<string> {
  try {
    const row = await dbService.getUserMemory();
    if (row?.context_text) return row.context_text;
    return DEFAULT_CONTEXT;
  } catch {
    return DEFAULT_CONTEXT;
  }
}

export async function saveUserContext(text: string): Promise<void> {
  await dbService.saveUserMemory(text);
}

// ─── Observation extraction ──────────────────────────────────
// Runs after conversations with 4+ messages exchanged.
// Uses the cheapest available model (Haiku-class) silently in background.
// Never blocks the user. Failures are swallowed silently.

const EXTRACTION_PROMPT = `You are an observation extraction system for a personal AI assistant. Your job is to analyze a conversation transcript and extract signals about the user that would help the assistant serve them better in the future.

Extract every signal about this user. What did they approve? Reject? Correct? Ask about? Struggle with? What patterns appeared? What did you learn about their projects? About how they think? Be specific, be brief, no fluff.

For each observation, categorize it:
- PREFERENCE: something they want or don't want
- PATTERN: a behavioral pattern
- FACT: a concrete fact about them or their work
- PROJECT: something about a specific project
- VOICE: something about how they write or communicate
- CORRECTION: something they corrected or rejected
- FAILED_ATTEMPT: something that was tried and didn't work or was abandoned

IMPORTANT RULES:
- Never store raw email content, only summaries
- Never store credentials or API keys
- Never store third-party email addresses (first names only)
- Never store raw code (only patterns and decisions)
- Be specific: "prefers Tailwind over CSS modules" not "has CSS preferences"
- DERIVABILITY RULE: Do NOT extract facts that can be determined by reading config files, package.json, or the codebase. Skip things like "project uses React" or "using TypeScript" — those are in the config files. DO extract decisions and WHY: "chose React over Vue because of team familiarity"
- SUCCESS GATE: For observations about code changes or architecture, note whether the operation was confirmed successful, failed, or just discussed. Mark failed operations as FAILED_ATTEMPT — these are valuable because they prevent repeating mistakes.

Respond ONLY with a JSON array of observations. No preamble, no explanation.
Format: [{"type": "PREFERENCE", "observation": "..."}, ...]`;

export async function extractObservations(
  messages: { role: string; content: string }[],
  source: 'assistant' | 'project',
  sessionId?: string
): Promise<void> {
  // Only run if 4+ messages exchanged (2 user + 2 assistant minimum)
  if (messages.length < 4) return;

  // Check settings
  const settings = await getMemorySettings();
  if (source === 'assistant' && !settings.learnAssistant) return;
  if (source === 'project' && !settings.learnProjects) return;

  try {
    // Build transcript (truncate to last 20 messages to keep costs down)
    const recent = messages.slice(-20);
    const transcript = recent
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n');

    // Get the cheapest provider available
    const provider = getCheapestProvider();
    if (!provider) return; // No API key configured, skip silently

    const result = await sendMessage(
      [{ role: 'user', content: `Analyze this conversation:\n\n${transcript}` }],
      provider,
      () => {}, // no streaming needed
      {
        path: '',
        manifest: null,
        contextString: EXTRACTION_PROMPT,
      }
    );

    if (!result?.text) return;

    // Parse the JSON response
    let observations: { type: string; observation: string }[];
    try {
      const cleaned = result.text.replace(/```json\s*|```/g, '').trim();
      observations = JSON.parse(cleaned);
      if (!Array.isArray(observations)) return;
    } catch {
      // Model didn't return valid JSON — skip this round
      return;
    }

    // Save each observation
    for (const obs of observations) {
      if (!obs.observation || typeof obs.observation !== 'string') continue;

      await dbService.addMemoryObservation({
        content: `[${obs.type || 'GENERAL'}] ${obs.observation}`,
        source,
        session_id: sessionId || null,
      });
    }

    // Check if we've hit 50 observations — trigger compression if so
    const count = await dbService.getMemoryObservationCount();
    if (count >= 50) {
      await compressMemory();
    }
  } catch (err) {
    // Completely silent — memory extraction should never disrupt the user
    console.error('[MemoryService] Observation extraction failed (non-fatal):', err);
  }
}

// ─── Weekly compression ──────────────────────────────────────
// Takes current context + all observations since last compression.
// Produces an updated context that stays under 3000 tokens.
// Called weekly via Scheduled Tasks, or when observations hit 50.

const COMPRESSION_PROMPT = `You are a memory compression system. You maintain a personal context file about a user of a desktop AI assistant called Omnirun.

You will receive:
1. The current context file (what we already know)
2. New observations from recent conversations

Your job: produce an UPDATED context file by following these four phases IN ORDER.

PHASE 1 — DEDUPLICATE
Compare new observations against existing context entries. Skip any observation that is already captured (even if worded differently). Do not add duplicates.

PHASE 2 — CHECK FOR CONTRADICTIONS
Identify new observations that contradict existing context entries.
- If the same new version has appeared 3+ times across observations → UPDATE the existing entry
- If only 1-2 times → keep the existing entry, do not change it yet (it might be situational)
- Flag entries about fast-changing topics (current focus, blockers, active projects) that haven't been reinforced recently — consider removing them

PHASE 3 — CHECK FOR STALENESS
Review every entry in the current context. For each one ask:
- Is this derivable from config files or the codebase? (e.g. "uses React" — if yes, REMOVE it, the AI can read package.json)
- Has this been reinforced by any recent observation? (if not reinforced in 60+ days and it's about something that changes, demote or remove)
- Is this vague and never led to an action? (e.g. "seems to like clean code" — if yes, remove)

PHASE 4 — COMPRESS AND WRITE
Produce the updated context file:
- Add genuinely new, non-derivable, durable observations
- Remove stale, derivable, or superseded entries
- Merge related items (don't have 3 entries that say the same thing differently)
- Sharpen vague observations into specific, actionable facts
- Stay UNDER 3000 tokens total. Recency + frequency determine what stays.
- Use the exact section structure provided in the current context
- Replace placeholder text like "[Not yet known]" with real data when available

CRITICAL: Output ONLY the updated context file. No commentary, no phase labels, no explanations. Start directly with "## Identity".`;

export async function compressMemory(): Promise<void> {
  try {
    const currentContext = await loadUserContext();
    const observations = await dbService.getRecentMemoryObservations(100);

    if (observations.length === 0) return;

    const provider = getCheapestProvider();
    if (!provider) return;

    const observationText = observations
      .map((o) => `- ${o.content} (${o.source}, ${o.created_at})`)
      .join('\n');

    const userMessage = `CURRENT CONTEXT FILE:\n\n${currentContext}\n\n---\n\nNEW OBSERVATIONS:\n\n${observationText}\n\n---\n\nProduce the updated context file.`;

    const result = await sendMessage(
      [{ role: 'user', content: userMessage }],
      provider,
      () => {},
      {
        path: '',
        manifest: null,
        contextString: COMPRESSION_PROMPT,
      }
    );

    if (!result?.text) return;

    // Basic validation: must have at least one section header
    if (!result.text.includes('## ')) return;

    // Save the compressed context
    await saveUserContext(result.text.trim());

    // Clear processed observations
    await dbService.clearProcessedObservations();

    console.log('[MemoryService] Compression complete');
  } catch (err) {
    console.error('[MemoryService] Compression failed (non-fatal):', err);
  }
}

// ─── Idle-time memory consolidation ──────────────────────────
// Runs during idle periods (30+ min no user input, 10+ unprocessed
// observations, 4+ hours since last consolidation).
// Uses the same multi-phase compression prompt. Costs ~$0.001-0.003.
// Called from ChatArea/AssistantChatArea idle detection timers.

export async function runIdleConsolidation(): Promise<boolean> {
  try {
    // Check if there are enough unprocessed observations to bother
    const count = await dbService.getMemoryObservationCount();
    if (count < 10) return false;

    // Check cooldown: at least 4 hours since last consolidation
    const lastConsolidated = await dbService.getLastConsolidatedAt();
    if (lastConsolidated) {
      const hoursSince = (Date.now() - new Date(lastConsolidated + 'Z').getTime()) / (1000 * 60 * 60);
      if (hoursSince < 4) return false;
    }

    // Run compression (reuses the same multi-phase prompt)
    await compressMemory();

    // Update the consolidation timestamp
    await dbService.setLastConsolidatedAt();

    console.log('[MemoryService] Idle consolidation complete');
    return true;
  } catch (err) {
    console.error('[MemoryService] Idle consolidation failed (non-fatal):', err);
    return false;
  }
}

// ─── Build session orientation block ─────────────────────────
// Returns a string to inject into the system prompt so the AI
// behaves as if it knows this person without reciting every fact.

export async function buildMemoryBlock(): Promise<string> {
  const context = await loadUserContext();

  // If context is still default/empty, return minimal block
  if (context.includes('[Not yet known]') && !context.includes('## Strong Preferences\n')) {
    return '';
  }

  return `\n\n--- MEMORY (what you know about this user) ---
Use this context to personalize your responses. Don't recite these facts — internalize them and let them naturally influence how you respond.

MEMORY VERIFICATION RULE: Information about user preferences, behavioral patterns, and past failures is TRUSTED — act on it directly. Information about project architecture, tech stack, dependencies, file structure, or current code state is treated as HINTS — verify against actual files before acting. If memory says "using Stripe for payments" but the codebase has no Stripe imports, trust the codebase, not memory.

${context}
--- END MEMORY ---`;
}

// ─── Provider helper ─────────────────────────────────────────
// Gets the cheapest available provider for background tasks.
// Prefers Haiku, falls back to whatever is configured.

function getCheapestProvider(): { id: string; apiKey: string; model: string } | null {
  try {
    const savedProviders = localStorage.getItem('ai-providers');
    if (!savedProviders) return null;

    const providers = JSON.parse(savedProviders);

    // Prefer Anthropic with Haiku for cheapest extraction
    const anthropic = providers.find((p: any) => p.providerId === 'anthropic' && p.apiKey);
    if (anthropic) {
      return {
        id: 'anthropic',
        apiKey: anthropic.apiKey,
        model: 'claude-haiku-4-5-20251001',
      };
    }

    // Fall back to any configured provider
    const any = providers.find((p: any) => p.apiKey);
    if (any) {
      return {
        id: any.providerId,
        apiKey: any.apiKey,
        model: any.selectedModel || '',
      };
    }

    return null;
  } catch {
    return null;
  }
}