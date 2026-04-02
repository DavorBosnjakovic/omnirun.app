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

IMPORTANT RULES:
- Never store raw email content, only summaries
- Never store credentials or API keys
- Never store third-party email addresses (first names only)
- Never store raw code (only patterns and decisions)
- Be specific: "prefers Tailwind over CSS modules" not "has CSS preferences"

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

Your job: produce an UPDATED context file that:
- Integrates new observations into the existing structure
- Keeps what matters, discards what doesn't
- Prioritizes recent information over old when space is tight
- Resolves contradictions (if something is contradicted multiple times, update it)
- Stays UNDER 3000 tokens total (this is a hard limit)
- Uses the exact section structure provided
- Replaces placeholder text like "[Not yet known]" with real data when available
- Is written in a neutral, factual tone

CRITICAL: If new observations contradict existing context and the contradiction has only appeared once, keep both and note the uncertainty. If contradicted 3+ times, update to the new information.

Respond ONLY with the updated context file. No preamble, no explanation. Start directly with "## Identity".`;

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

// ─── Build session orientation block ─────────────────────────
// Returns a string to inject into the system prompt so the AI
// behaves as if it knows this person without reciting every fact.

export async function buildMemoryBlock(): Promise<string> {
  const context = await loadUserContext();

  // If context is still default/empty, return minimal block
  if (context.includes('[Not yet known]') && !context.includes('## Strong Preferences\n')) {
    return '';
  }

  return `\n\n--- MEMORY (what you know about this user) ---\nUse this context to personalize your responses. Don't recite these facts — internalize them and let them naturally influence how you respond.\n\n${context}\n--- END MEMORY ---`;
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