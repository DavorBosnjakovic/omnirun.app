import { create } from "zustand";
import { dbService } from "../services/dbService";

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

interface UsageState {
  // Current session
  session: SessionData;

  // Computed aggregates
  monthlyTokens: number;
  monthlyCost: number;
  monthlyInputTokens: number;
  monthlyOutputTokens: number;
  monthlyInputCost: number;
  monthlyOutputCost: number;
  allTimeTokens: number;
  allTimeCost: number;
  allTimeInputTokens: number;
  allTimeOutputTokens: number;
  allTimeInputCost: number;
  allTimeOutputCost: number;

  // Budget
  monthlyBudget: number | null;
  budgetAlertEnabled: boolean;
  budgetAlertThreshold: number; // percentage (0-100), default 80

  // Actions
  trackAPICall: (params: {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens?: number;
    cacheReadTokens?: number;
    taskLabel?: string;
  }) => UsageEntry;
  setMonthlyBudget: (budget: number | null) => void;
  setBudgetAlertEnabled: (enabled: boolean) => void;
  setBudgetAlertThreshold: (threshold: number) => void;
  resetSession: () => void;
  clearAllData: () => void;
  // New: load from SQLite on startup
  loadFromDB: () => Promise<void>;
}

// ─── Pricing (per 1M tokens) ────────────────────────────────────────

interface ModelPricing {
  input: number;
  output: number;
  cacheCreation?: number;
  cacheRead?: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude
  "claude-opus": { input: 15, output: 75, cacheCreation: 18.75, cacheRead: 1.50 },
  "claude-sonnet": { input: 3, output: 15, cacheCreation: 3.75, cacheRead: 0.30 },
  "claude-haiku": { input: 0.25, output: 1.25, cacheCreation: 0.30, cacheRead: 0.03 },
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

function calculateCost(
  model: string,
  provider: string,
  inputTokens: number,
  outputTokens: number,
  cacheCreationTokens: number,
  cacheReadTokens: number
): CostBreakdown {
  const pricing = getPricing(model, provider);

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheCreateCost = pricing.cacheCreation
    ? (cacheCreationTokens / 1_000_000) * pricing.cacheCreation
    : 0;
  const cacheReadCost = pricing.cacheRead
    ? (cacheReadTokens / 1_000_000) * pricing.cacheRead
    : 0;

  // Cache costs are part of input cost (they're input token variants)
  const totalInputCost = inputCost + cacheCreateCost + cacheReadCost;
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
  monthlyTokens: 0,
  monthlyCost: 0,
  monthlyInputTokens: 0,
  monthlyOutputTokens: 0,
  monthlyInputCost: 0,
  monthlyOutputCost: 0,
  allTimeTokens: 0,
  allTimeCost: 0,
  allTimeInputTokens: 0,
  allTimeOutputTokens: 0,
  allTimeInputCost: 0,
  allTimeOutputCost: 0,
  monthlyBudget: null,
  budgetAlertEnabled: true,
  budgetAlertThreshold: 80,

  trackAPICall: ({ model, provider, inputTokens, outputTokens, cacheCreationTokens = 0, cacheReadTokens = 0, taskLabel }) => {
    const costBreakdown = calculateCost(model, provider, inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

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

    set((state) => {
      const newSession: SessionData = {
        ...state.session,
        entries: [...state.session.entries, entry],
        totalTokens: state.session.totalTokens + entry.totalTokens,
        totalCost: state.session.totalCost + entry.cost,
        totalInputTokens: state.session.totalInputTokens + entry.inputTokens,
        totalOutputTokens: state.session.totalOutputTokens + entry.outputTokens,
        totalInputCost: state.session.totalInputCost + entry.inputCost,
        totalOutputCost: state.session.totalOutputCost + entry.outputCost,
      };

      const newMonthlyTokens = state.monthlyTokens + entry.totalTokens;
      const newMonthlyCost = state.monthlyCost + entry.cost;
      const newMonthlyInputTokens = state.monthlyInputTokens + entry.inputTokens;
      const newMonthlyOutputTokens = state.monthlyOutputTokens + entry.outputTokens;
      const newMonthlyInputCost = state.monthlyInputCost + entry.inputCost;
      const newMonthlyOutputCost = state.monthlyOutputCost + entry.outputCost;
      const newAllTimeTokens = state.allTimeTokens + entry.totalTokens;
      const newAllTimeCost = state.allTimeCost + entry.cost;
      const newAllTimeInputTokens = state.allTimeInputTokens + entry.inputTokens;
      const newAllTimeOutputTokens = state.allTimeOutputTokens + entry.outputTokens;
      const newAllTimeInputCost = state.allTimeInputCost + entry.inputCost;
      const newAllTimeOutputCost = state.allTimeOutputCost + entry.outputCost;

      // Persist to SQLite (fire-and-forget)
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
          `[Mydevify] Budget alert: Monthly cost $${newMonthlyCost.toFixed(2)} ` +
          `reached ${state.budgetAlertThreshold}% of $${state.monthlyBudget} budget`
        );
      }

      return {
        session: newSession,
        monthlyTokens: newMonthlyTokens,
        monthlyCost: newMonthlyCost,
        monthlyInputTokens: newMonthlyInputTokens,
        monthlyOutputTokens: newMonthlyOutputTokens,
        monthlyInputCost: newMonthlyInputCost,
        monthlyOutputCost: newMonthlyOutputCost,
        allTimeTokens: newAllTimeTokens,
        allTimeCost: newAllTimeCost,
        allTimeInputTokens: newAllTimeInputTokens,
        allTimeOutputTokens: newAllTimeOutputTokens,
        allTimeInputCost: newAllTimeInputCost,
        allTimeOutputCost: newAllTimeOutputCost,
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
      dbService.saveUsageSession({
        id: state.session.id,
        startTime: state.session.startTime,
        totalTokens: state.session.totalTokens,
        totalCost: state.session.totalCost,
        entryCount: state.session.entries.length,
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
      monthlyTokens: 0,
      monthlyCost: 0,
      monthlyInputTokens: 0,
      monthlyOutputTokens: 0,
      monthlyInputCost: 0,
      monthlyOutputCost: 0,
      allTimeTokens: 0,
      allTimeCost: 0,
      allTimeInputTokens: 0,
      allTimeOutputTokens: 0,
      allTimeInputCost: 0,
      allTimeOutputCost: 0,
      monthlyBudget: null,
      budgetAlertEnabled: true,
      budgetAlertThreshold: 80,
    });
  },

  // Load aggregates and budget from SQLite on app startup
  loadFromDB: async () => {
    try {
      const [monthly, allTime, budgetSettings] = await Promise.all([
        dbService.getMonthlyUsage(),
        dbService.getAllTimeUsage(),
        dbService.getBudgetSettings(),
      ]);

      set({
        monthlyTokens: monthly.tokens,
        monthlyCost: monthly.cost,
        monthlyInputTokens: monthly.inputTokens,
        monthlyOutputTokens: monthly.outputTokens,
        monthlyInputCost: monthly.inputCost,
        monthlyOutputCost: monthly.outputCost,
        allTimeTokens: allTime.tokens,
        allTimeCost: allTime.cost,
        allTimeInputTokens: allTime.inputTokens,
        allTimeOutputTokens: allTime.outputTokens,
        allTimeInputCost: allTime.inputCost,
        allTimeOutputCost: allTime.outputCost,
        ...budgetSettings,
      });
    } catch (e) {
      console.error("Failed to load usage from DB:", e);
    }
  },
}));