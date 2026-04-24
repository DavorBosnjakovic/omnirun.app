import { create } from "zustand";
import { dbService } from "../services/dbService";
import { ANTHROPIC_PRICING } from "../config/anthropicModels";

// ─── Types ───────────────────────────────────────────────────────────

export interface UsageEntry {
  id: string;
  timestamp: number;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
  inputCost: number;
  outputCost: number;
  taskLabel?: string; // Generic label like "Task 1" (privacy-first)
}

interface SessionData {
  id: string;
  startTime: number;
  entries: UsageEntry[];
  totalTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalInputCost: number;
  totalOutputCost: number;
}

// ─── Session History Types ──────────────────────────────────────────

export interface SessionSummary {
  id: string;
  startTime: number;
  endTime: number;
  totalTokens: number;
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalInputCost: number;
  totalOutputCost: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  entryCount: number;
  models: string[];       // Unique models used in this session
  providers: string[];    // Unique providers used
}

export interface SessionDetail {
  summary: SessionSummary;
  entries: UsageEntry[];
}

interface UsageState {
  // Current session
  session: SessionData;

  // Computed aggregates
  todayTokens: number;
  todayInputTokens: number;
  todayOutputTokens: number;
  todayInputCost: number;
  todayOutputCost: number;
  todayCacheReadTokens: number;
  todayCacheCreationTokens: number;
  monthlyTokens: number;
  monthlyCost: number;
  monthlyInputTokens: number;
  monthlyOutputTokens: number;
  monthlyInputCost: number;
  monthlyOutputCost: number;
  monthlyCacheReadTokens: number;
  monthlyCacheCreationTokens: number;
  allTimeTokens: number;
  allTimeCost: number;
  allTimeInputTokens: number;
  allTimeOutputTokens: number;
  allTimeInputCost: number;
  allTimeOutputCost: number;
  allTimeCacheReadTokens: number;
  allTimeCacheCreationTokens: number;

  // Budget
  monthlyBudget: number | null;
  budgetAlertEnabled: boolean;
  budgetAlertThreshold: number; // percentage (0-100), default 80

  // Session history
  sessionHistory: SessionSummary[];
  selectedSession: SessionDetail | null;

  // Actions
  trackAPICall: (params: {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    taskLabel?: string;
    source?: 'project' | 'assistant';
    projectName?: string | null;
  }) => UsageEntry;
  setMonthlyBudget: (budget: number | null) => void;
  setBudgetAlertEnabled: (enabled: boolean) => void;
  setBudgetAlertThreshold: (threshold: number) => void;
  resetSession: () => void;
  clearAllData: () => void;
  // Load from SQLite on startup
  loadFromDB: () => Promise<void>;
  // Session history actions
  loadSessionHistory: (options?: { fromDate?: number; toDate?: number; filter?: { source?: 'project' | 'assistant'; projectName?: string } }) => Promise<void>;
  loadSessionDetail: (sessionId: string) => Promise<void>;
  clearSelectedSession: () => void;
}

// ─── Pricing (per 1M tokens) ────────────────────────────────────────

interface ModelPricing {
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude — pulled from the single source of truth
  ...ANTHROPIC_PRICING,
  // OpenAI
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "gpt-4.1": { input: 2, output: 8 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o": { input: 2.50, output: 10 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5": { input: 0.50, output: 1.50 },
  "o3-mini": { input: 1.10, output: 4.40 },
  "o1-mini": { input: 3, output: 12 },
  "o1": { input: 15, output: 60 },
  // DeepSeek (V3.2 unified pricing, Feb 2025)
  "deepseek-chat": { input: 0.28, output: 0.42, cacheRead: 0.028 },
  "deepseek-reasoner": { input: 0.28, output: 0.42, cacheRead: 0.028 },
  // Google Gemini
  "gemini-2.0-flash": { input: 0.10, output: 0.40 },
  "gemini-2.0-pro": { input: 1.25, output: 10 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30 },
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  // Groq (free tier, but track tokens)
  "llama-3.3-70b": { input: 0.59, output: 0.79 },
  "llama-3.1-8b": { input: 0.05, output: 0.08 },
  "mixtral-8x7b": { input: 0.24, output: 0.24 },
  // Ollama (local = free)
  "ollama": { input: 0, output: 0 },
};

/**
 * Resolve pricing for a model string.
 * Matches by checking if the model name contains a known key.
 */
function getPricing(model: string, provider: string): ModelPricing {
  const m = model.toLowerCase();

  // Local models are free
  if (provider === "ollama") return { input: 0, output: 0 };

  // Try exact-ish matches
  for (const [key, pricing] of Object.entries(MODEL_PRICING)) {
    if (m.includes(key)) return pricing;
  }

  // Provider-aware fallback so we don't massively overcount cheap providers
  const PROVIDER_FALLBACKS: Record<string, ModelPricing> = {
    deepseek: { input: 0.28, output: 0.42 },
    openai: { input: 2.50, output: 10 },
    anthropic: { input: 3, output: 15 },
    google: { input: 0.10, output: 0.40 },
    groq: { input: 0.59, output: 0.79 },
  };

  return PROVIDER_FALLBACKS[provider] || { input: 3, output: 15 };
}

interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  total: number;
}

/**
 * Calculate cost for an API call.
 *
 * Anthropic token fields:
 *   inputTokens         = total input tokens (INCLUDES cache_read tokens)
 *   cacheReadTokens     = tokens read from cache (subset of inputTokens, charged at cacheRead rate)
 *   cacheCreationTokens = tokens written to cache (NOT included in inputTokens, charged at cacheCreation rate)
 *
 * Correct formula:
 *   regularInput = (inputTokens - cacheReadTokens) × base_rate
 *   cacheRead    = cacheReadTokens × cacheRead_rate
 *   cacheCreate  = cacheCreationTokens × cacheCreation_rate
 *   output       = outputTokens × output_rate
 */
function calculateCost(
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number
): CostBreakdown {
  const pricing = getPricing(model, provider);

  // input_tokens is regular (non-cached) input only — cache_read tokens are separate.
  const regularInputCost = (inputTokens / 1_000_000) * pricing.input;

  // Cache read tokens: charged at the discounted cache_read rate
  const cacheReadCost = pricing.cacheRead
    ? (cacheReadTokens / 1_000_000) * pricing.cacheRead
    : 0;

  // Cache creation tokens: charged at the premium cache_creation rate
  // These are NOT included in inputTokens — they're always separate.
  const cacheCreateCost = pricing.cacheCreation
    ? (cacheCreationTokens / 1_000_000) * pricing.cacheCreation
    : 0;

  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  // Total input cost = regular + cache read + cache creation
  const totalInputCost = regularInputCost + cacheReadCost + cacheCreateCost;
  const totalOutputCost = outputCost;

  return {
    inputCost: totalInputCost,
    outputCost: totalOutputCost,
    total: totalInputCost + totalOutputCost,
  };
}

// ─── Create new session ─────────────────────────────────────────────

function createSession(): SessionData {
  return {
    id: `session_${Date.now()}`,
    startTime: Date.now(),
    entries: [],
    totalTokens: 0,
    totalCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalInputCost: 0,
    totalOutputCost: 0,
  };
}

// ─── Store ──────────────────────────────────────────────────────────

export const useUsageStore = create<UsageState>((set, get) => ({
  session: createSession(),
  todayTokens: 0,
  todayInputTokens: 0,
  todayOutputTokens: 0,
  todayInputCost: 0,
  todayOutputCost: 0,
  todayCacheReadTokens: 0,
  todayCacheCreationTokens: 0,
  monthlyTokens: 0,
  monthlyCost: 0,
  monthlyInputTokens: 0,
  monthlyOutputTokens: 0,
  monthlyInputCost: 0,
  monthlyOutputCost: 0,
  monthlyCacheReadTokens: 0,
  monthlyCacheCreationTokens: 0,
  allTimeTokens: 0,
  allTimeCost: 0,
  allTimeInputTokens: 0,
  allTimeOutputTokens: 0,
  allTimeInputCost: 0,
  allTimeOutputCost: 0,
  allTimeCacheReadTokens: 0,
  allTimeCacheCreationTokens: 0,
  monthlyBudget: null,
  budgetAlertEnabled: true,
  budgetAlertThreshold: 80,
  sessionHistory: [],
  selectedSession: null,

  trackAPICall: ({ model, provider, inputTokens, outputTokens, cacheCreationTokens = 0, cacheReadTokens = 0, taskLabel, source = 'project', projectName = null }) => {
    const costBreakdown = calculateCost(model, provider, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

    // Store token counts exactly as the API returns them.
    // inputTokens already includes cache reads (per Anthropic docs).
    // cacheCreationTokens are separate and tracked independently.
    // Do NOT add cacheCreationTokens to inputTokens — Anthropic's dashboard doesn't.

    const entry: UsageEntry = {
      id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: Date.now(),
      model,
      provider,
      inputTokens,
      outputTokens,
      cacheCreationTokens,
      cacheReadTokens,
      totalTokens: inputTokens + outputTokens,
      cost: costBreakdown.total,
      inputCost: costBreakdown.inputCost,
      outputCost: costBreakdown.outputCost,
      taskLabel,
    };

    const sessionId = get().session.id;

    set((state) => {
      const newSessionInputCost = state.session.totalInputCost + entry.inputCost;
      const newSessionOutputCost = state.session.totalOutputCost + entry.outputCost;
      const newSession: SessionData = {
        ...state.session,
        entries: [...state.session.entries, entry],
        totalTokens: state.session.totalTokens + entry.totalTokens,
        totalCost: newSessionInputCost + newSessionOutputCost,
        totalInputTokens: state.session.totalInputTokens + entry.inputTokens,
        totalOutputTokens: state.session.totalOutputTokens + entry.outputTokens,
        totalInputCost: newSessionInputCost,
        totalOutputCost: newSessionOutputCost,
      };

      const newTodayInputCost = state.todayInputCost + entry.inputCost;
      const newTodayOutputCost = state.todayOutputCost + entry.outputCost;
      const newTodayTokens = state.todayTokens + entry.totalTokens;
      const newTodayInputTokens = state.todayInputTokens + entry.inputTokens;
      const newTodayOutputTokens = state.todayOutputTokens + entry.outputTokens;
      const newTodayCacheRead = state.todayCacheReadTokens + entry.cacheReadTokens;
      const newTodayCacheCreation = state.todayCacheCreationTokens + entry.cacheCreationTokens;

      const newMonthlyInputCost = state.monthlyInputCost + entry.inputCost;
      const newMonthlyOutputCost = state.monthlyOutputCost + entry.outputCost;
      const newMonthlyTokens = state.monthlyTokens + entry.totalTokens;
      const newMonthlyCost = newMonthlyInputCost + newMonthlyOutputCost;
      const newMonthlyInputTokens = state.monthlyInputTokens + entry.inputTokens;
      const newMonthlyOutputTokens = state.monthlyOutputTokens + entry.outputTokens;
      const newMonthlyCacheRead = state.monthlyCacheReadTokens + entry.cacheReadTokens;
      const newMonthlyCacheCreation = state.monthlyCacheCreationTokens + entry.cacheCreationTokens;
      const newAllTimeInputCost = state.allTimeInputCost + entry.inputCost;
      const newAllTimeOutputCost = state.allTimeOutputCost + entry.outputCost;
      const newAllTimeTokens = state.allTimeTokens + entry.totalTokens;
      const newAllTimeCost = newAllTimeInputCost + newAllTimeOutputCost;
      const newAllTimeInputTokens = state.allTimeInputTokens + entry.inputTokens;
      const newAllTimeOutputTokens = state.allTimeOutputTokens + entry.outputTokens;
      const newAllTimeCacheRead = state.allTimeCacheReadTokens + entry.cacheReadTokens;
      const newAllTimeCacheCreation = state.allTimeCacheCreationTokens + entry.cacheCreationTokens;

      // Persist to SQLite (fire-and-forget) — include session_id for history
      dbService.recordUsage({
        provider: entry.provider,
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheCreationTokens: entry.cacheCreationTokens,
        cacheReadTokens: entry.cacheReadTokens,
        totalTokens: entry.totalTokens,
        cost: entry.cost,
        inputCost: entry.inputCost,
        outputCost: entry.outputCost,
        taskLabel: entry.taskLabel || null,
        timestamp: entry.timestamp,
        sessionId,
        source,
        projectName,
      }).catch((e) => {
        console.error("Failed to record usage to DB:", e);
      });

      // Check budget alert
      if (
        state.budgetAlertEnabled &&
        state.monthlyBudget !== null &&
        newMonthlyCost >= state.monthlyBudget * (state.budgetAlertThreshold / 100) &&
        state.monthlyCost < state.monthlyBudget * (state.budgetAlertThreshold / 100)
      ) {
        console.warn(
          `[Omnirun] Budget alert: Monthly cost $${newMonthlyCost.toFixed(2)} ` +
          `reached ${state.budgetAlertThreshold}% of $${state.monthlyBudget} budget`
        );
      }

      return {
        session: newSession,
        todayTokens: newTodayTokens,
        todayInputTokens: newTodayInputTokens,
        todayOutputTokens: newTodayOutputTokens,
        todayInputCost: newTodayInputCost,
        todayOutputCost: newTodayOutputCost,
        todayCacheReadTokens: newTodayCacheRead,
        todayCacheCreationTokens: newTodayCacheCreation,
        monthlyTokens: newMonthlyTokens,
        monthlyCost: newMonthlyCost,
        monthlyInputTokens: newMonthlyInputTokens,
        monthlyOutputTokens: newMonthlyOutputTokens,
        monthlyInputCost: newMonthlyInputCost,
        monthlyOutputCost: newMonthlyOutputCost,
        monthlyCacheReadTokens: newMonthlyCacheRead,
        monthlyCacheCreationTokens: newMonthlyCacheCreation,
        allTimeTokens: newAllTimeTokens,
        allTimeCost: newAllTimeCost,
        allTimeInputTokens: newAllTimeInputTokens,
        allTimeOutputTokens: newAllTimeOutputTokens,
        allTimeInputCost: newAllTimeInputCost,
        allTimeOutputCost: newAllTimeOutputCost,
        allTimeCacheReadTokens: newAllTimeCacheRead,
        allTimeCacheCreationTokens: newAllTimeCacheCreation,
      };
    });

    return entry;
  },

  setMonthlyBudget: (budget) => {
    set({ monthlyBudget: budget });
    const s = get();
    dbService.saveBudgetSettings(budget, s.budgetAlertEnabled, s.budgetAlertThreshold).catch((e) => {
      console.error("Failed to save budget to DB:", e);
    });
  },

  setBudgetAlertEnabled: (enabled) => {
    set({ budgetAlertEnabled: enabled });
    const s = get();
    dbService.saveBudgetSettings(s.monthlyBudget, enabled, s.budgetAlertThreshold).catch((e) => {
      console.error("Failed to save budget to DB:", e);
    });
  },

  setBudgetAlertThreshold: (threshold) => {
    set({ budgetAlertThreshold: threshold });
    const s = get();
    dbService.saveBudgetSettings(s.monthlyBudget, s.budgetAlertEnabled, threshold).catch((e) => {
      console.error("Failed to save budget to DB:", e);
    });
  },

  resetSession: () => {
    const state = get();
    // Save current session summary to SQLite before resetting
    if (state.session.entries.length > 0) {
      const totalCacheRead = state.session.entries.reduce((sum, e) => sum + (e.cacheReadTokens ?? 0), 0);
      const totalCacheCreation = state.session.entries.reduce((sum, e) => sum + (e.cacheCreationTokens ?? 0), 0);
      dbService.saveUsageSession({
        id: state.session.id,
        startTime: state.session.startTime,
        endTime: Date.now(),
        totalTokens: state.session.totalTokens,
        totalCost: state.session.totalCost,
        totalInputTokens: state.session.totalInputTokens,
        totalOutputTokens: state.session.totalOutputTokens,
        totalInputCost: state.session.totalInputCost,
        totalOutputCost: state.session.totalOutputCost,
        totalCacheReadTokens: totalCacheRead,
        totalCacheCreationTokens: totalCacheCreation,
        entryCount: state.session.entries.length,
        models: [...new Set(state.session.entries.map(e => e.model))],
        providers: [...new Set(state.session.entries.map(e => e.provider))],
      }).catch((e) => {
        console.error("Failed to save session to DB:", e);
      });
    }
    set({ session: createSession() });
  },

  clearAllData: () => {
    dbService.clearAllUsage().catch((e) => {
      console.error("Failed to clear usage data from DB:", e);
    });
    set({
      session: createSession(),
      todayTokens: 0,
      todayInputTokens: 0,
      todayOutputTokens: 0,
      todayInputCost: 0,
      todayOutputCost: 0,
      todayCacheReadTokens: 0,
      todayCacheCreationTokens: 0,
      monthlyTokens: 0,
      monthlyCost: 0,
      monthlyInputTokens: 0,
      monthlyOutputTokens: 0,
      monthlyInputCost: 0,
      monthlyOutputCost: 0,
      monthlyCacheReadTokens: 0,
      monthlyCacheCreationTokens: 0,
      allTimeTokens: 0,
      allTimeCost: 0,
      allTimeInputTokens: 0,
      allTimeOutputTokens: 0,
      allTimeInputCost: 0,
      allTimeOutputCost: 0,
      allTimeCacheReadTokens: 0,
      allTimeCacheCreationTokens: 0,
      monthlyBudget: null,
      budgetAlertEnabled: true,
      budgetAlertThreshold: 80,
      sessionHistory: [],
      selectedSession: null,
    });
  },

  // Load aggregates and budget from SQLite on app startup
  loadFromDB: async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    // Run each query independently so one failure doesn't zero out everything
    const [monthly, allTime, budgetSettings, todaySessions] = await Promise.all([
      dbService.getMonthlyUsage().catch((e) => {
        console.error("Failed to load monthly usage:", e);
        return null;
      }),
      dbService.getAllTimeUsage().catch((e) => {
        console.error("Failed to load all-time usage:", e);
        return null;
      }),
      dbService.getBudgetSettings().catch((e) => {
        console.error("Failed to load budget settings:", e);
        return null;
      }),
      dbService.getSessionHistory({ fromDate: todayStart.getTime(), toDate: Date.now() }).catch((e) => {
        console.error("Failed to load today sessions:", e);
        return [] as Awaited<ReturnType<typeof dbService.getSessionHistory>>;
      }),
    ]);

    // Sum today's sessions from DB
    const today = todaySessions.reduce(
      (acc, s) => ({
        tokens: acc.tokens + s.totalTokens,
        inputTokens: acc.inputTokens + (s.totalInputTokens ?? 0),
        outputTokens: acc.outputTokens + (s.totalOutputTokens ?? 0),
        inputCost: acc.inputCost + (s.totalInputCost ?? 0),
        outputCost: acc.outputCost + (s.totalOutputCost ?? 0),
        cacheReadTokens: acc.cacheReadTokens + (s.totalCacheReadTokens ?? 0),
        cacheCreationTokens: acc.cacheCreationTokens + (s.totalCacheCreationTokens ?? 0),
      }),
      { tokens: 0, inputTokens: 0, outputTokens: 0, inputCost: 0, outputCost: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
    );

    const updates: Record<string, any> = {};

    // Today (from session history)
    updates.todayTokens = today.tokens;
    updates.todayInputTokens = today.inputTokens;
    updates.todayOutputTokens = today.outputTokens;
    updates.todayInputCost = today.inputCost;
    updates.todayOutputCost = today.outputCost;
    updates.todayCacheReadTokens = today.cacheReadTokens;
    updates.todayCacheCreationTokens = today.cacheCreationTokens;

    // Monthly (only if query succeeded)
    if (monthly) {
      updates.monthlyTokens = monthly.tokens;
      updates.monthlyCost = monthly.cost;
      updates.monthlyInputTokens = monthly.inputTokens;
      updates.monthlyOutputTokens = monthly.outputTokens;
      updates.monthlyInputCost = monthly.inputCost;
      updates.monthlyOutputCost = monthly.outputCost;
      updates.monthlyCacheReadTokens = monthly.cacheReadTokens ?? 0;
      updates.monthlyCacheCreationTokens = monthly.cacheCreationTokens ?? 0;
    }

    // All time (only if query succeeded)
    if (allTime) {
      updates.allTimeTokens = allTime.tokens;
      updates.allTimeCost = allTime.cost;
      updates.allTimeInputTokens = allTime.inputTokens;
      updates.allTimeOutputTokens = allTime.outputTokens;
      updates.allTimeInputCost = allTime.inputCost;
      updates.allTimeOutputCost = allTime.outputCost;
      updates.allTimeCacheReadTokens = allTime.cacheReadTokens ?? 0;
      updates.allTimeCacheCreationTokens = allTime.cacheCreationTokens ?? 0;
    }

    // Budget settings
    if (budgetSettings) {
      Object.assign(updates, budgetSettings);
    }

    set(updates);
  },

  // ─── Session History ─────────────────────────────────────────────

  loadSessionHistory: async (options) => {
    try {
      const sessions = await dbService.getSessionHistory(options);
      set({ sessionHistory: sessions });
    } catch (e) {
      console.error("Failed to load session history:", e);
    }
  },

  loadSessionDetail: async (sessionId: string) => {
    try {
      const detail = await dbService.getSessionDetail(sessionId);
      set({ selectedSession: detail });
    } catch (e) {
      console.error("Failed to load session detail:", e);
    }
  },

  clearSelectedSession: () => {
    set({ selectedSession: null });
  },
}));