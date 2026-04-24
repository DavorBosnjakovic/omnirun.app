// ============================================================
// anthropicModels.ts
// ============================================================
// Single source of truth for Anthropic model IDs and pricing.
//
// When Anthropic releases a new Opus/Sonnet/Haiku:
//   1. Update the ID in ANTHROPIC_MODELS below
//   2. Update the display name in ANTHROPIC_MODEL_OPTIONS
//   3. Add the previous ID to ANTHROPIC_MODEL_MIGRATIONS so users
//      who had the old version auto-upgrade
//   4. Update ANTHROPIC_PRICING if the price changed
// Everything else in the app reads from this file.
// ============================================================

/** Current Anthropic model IDs, one per tier. */
export const ANTHROPIC_MODELS = {
  opus:   "claude-opus-4-7",
  sonnet: "claude-sonnet-4-6",
  haiku:  "claude-haiku-4-5-20251001",
} as const;

export type AnthropicTier = keyof typeof ANTHROPIC_MODELS;

/** Dropdown options for the API Keys settings page. */
export const ANTHROPIC_MODEL_OPTIONS: { id: string; name: string }[] = [
  { id: ANTHROPIC_MODELS.opus,   name: "Claude Opus 4.7" },
  { id: ANTHROPIC_MODELS.sonnet, name: "Claude Sonnet 4.6" },
  { id: ANTHROPIC_MODELS.haiku,  name: "Claude Haiku 4.5" },
];

/**
 * Maps old/deprecated Anthropic model IDs to their current replacements.
 * Used on app load to silently upgrade users' saved model choice when a
 * previously-selected model is no longer the latest of its tier.
 */
export const ANTHROPIC_MODEL_MIGRATIONS: Record<string, string> = {
  // Previous-gen Opus
  "claude-opus-4-6":          ANTHROPIC_MODELS.opus,
  "claude-opus-4-5":          ANTHROPIC_MODELS.opus,
  "claude-opus-4-20250514":   ANTHROPIC_MODELS.opus,
  "claude-opus-4-0-20250514": ANTHROPIC_MODELS.opus,
  // Previous-gen Sonnet
  "claude-sonnet-4-5-20250929": ANTHROPIC_MODELS.sonnet,
  "claude-sonnet-4-5":          ANTHROPIC_MODELS.sonnet,
  "claude-sonnet-4-20250514":   ANTHROPIC_MODELS.sonnet,
  // Previous-gen Haiku (Haiku 4.5 is current, but list older for safety)
  "claude-haiku-4-20250414": ANTHROPIC_MODELS.haiku,
};

export interface TierPricing {
  /** USD per 1M input tokens. */
  input: number;
  /** USD per 1M output tokens. */
  output: number;
  /** USD per 1M tokens for cache writes (Anthropic standard: 1.25x input). */
  cacheCreation?: number;
  /** USD per 1M tokens for cache reads (Anthropic standard: 0.10x input). */
  cacheRead?: number;
}

/**
 * Pricing keyed by model-ID prefix. "claude-opus" matches any Opus version
 * (4.6, 4.7, future 4.8...), so new point releases of the same tier inherit
 * their tier's price automatically.
 * USD per 1,000,000 tokens.
 */
export const ANTHROPIC_PRICING: Record<string, TierPricing> = {
  "claude-opus":   { input: 5, output: 25, cacheCreation: 6.25, cacheRead: 0.50 },
  "claude-sonnet": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.30 },
  "claude-haiku":  { input: 1, output: 5,  cacheCreation: 1.25, cacheRead: 0.10 },
};

/**
 * Detect which Anthropic tier a model ID belongs to, or null if it isn't
 * an Anthropic model. Case-insensitive prefix match.
 */
export function getAnthropicTier(model: string): AnthropicTier | null {
  const m = model.toLowerCase();
  if (m.includes("claude-opus"))   return "opus";
  if (m.includes("claude-sonnet")) return "sonnet";
  if (m.includes("claude-haiku"))  return "haiku";
  return null;
}

/**
 * If `model` is an old Anthropic ID listed in ANTHROPIC_MODEL_MIGRATIONS,
 * returns the current replacement. Otherwise returns `model` unchanged.
 */
export function migrateAnthropicModel(model: string): string {
  return ANTHROPIC_MODEL_MIGRATIONS[model] ?? model;
}