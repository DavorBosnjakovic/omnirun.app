// ============================================================
// Assistant Store
// ============================================================
// Manages state for the Assistant section:
// - Connected personal integration accounts (email, calendar, messaging, etc.)
// - Assistant chat messages (separate from project chat)
// - Loading / error states
// - Plan-gating for account limits
//
// Source of truth for accounts: Supabase assistant_email_accounts
// Local cache: SQLite assistant_accounts_cache (via dbService)
// Zustand is the in-memory layer — same pattern as the rest of the app.

import { create } from 'zustand';
import { dbService, type AssistantAccount } from '../services/dbService';
import { getSupabase } from '../services/supabaseClient';

// ─── Plan limits ─────────────────────────────────────────────
// Mirrors the pricing spec. Enforced locally — server validates too.

export const EMAIL_ACCOUNT_LIMITS: Record<string, number> = {
  starter: 1,
  pro: 2,
  business: 5,
  enterprise: Infinity,
};

export function getEmailAccountLimit(plan: string): number {
  return EMAIL_ACCOUNT_LIMITS[plan.toLowerCase()] ?? 1;
}

export const INTEGRATION_LIMITS: Record<string, number> = {
  starter: 3,
  pro: 5,
  business: Infinity,
  enterprise: Infinity,
};

export function getIntegrationLimit(plan: string): number {
  return INTEGRATION_LIMITS[plan.toLowerCase()] ?? 3;
}

// ─── Message types (same shape as chatStore for consistency) ──

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// ─── Provider definitions ─────────────────────────────────────
// The UI reads this list to know what to show in the accounts panel
// and connect modal. Add new providers here as they get built.

export type ProviderType = 'email' | 'calendar' | 'messaging' | 'dev' | 'knowledge' | 'tasks' | 'monitor';
export type ProviderCategory = 'Email' | 'Calendar' | 'Messaging' | 'Development' | 'Productivity' | 'Monitoring';

export interface ProviderDefinition {
  id: string;
  label: string;
  providerType: ProviderType;
  category: ProviderCategory;
  description: string;
  available: boolean;       // false = not yet built, hidden from UI
  oauthBased: boolean;      // true = needs OAuth credentials, false = no OAuth (e.g. website watcher)
  sharesAuthWith?: string;  // e.g. 'gmail' for google_calendar — uses same OAuth app credentials
}

export const ASSISTANT_PROVIDERS: ProviderDefinition[] = [
  // ── Email ──
  {
    id: 'gmail',
    label: 'Gmail',
    providerType: 'email',
    category: 'Email',
    description: 'Read, summarize, and reply to emails',
    available: true,
    oauthBased: true,
  },
  {
    id: 'outlook',
    label: 'Outlook',
    providerType: 'email',
    category: 'Email',
    description: 'Read, summarize, and reply to emails',
    available: true,
    oauthBased: true,
  },

  // ── Calendar ──
  {
    id: 'google_calendar',
    label: 'Google Calendar',
    providerType: 'calendar',
    category: 'Calendar',
    description: 'Events, scheduling, morning briefs',
    available: true,
    oauthBased: true,
    sharesAuthWith: 'gmail',
  },
  {
    id: 'outlook_calendar',
    label: 'Outlook Calendar',
    providerType: 'calendar',
    category: 'Calendar',
    description: 'Events, scheduling, morning briefs',
    available: true,
    oauthBased: true,
    sharesAuthWith: 'outlook',
  },

  // ── Messaging ──
  {
    id: 'slack',
    label: 'Slack',
    providerType: 'messaging',
    category: 'Messaging',
    description: 'Surface important messages, reply via chat',
    available: true,
    oauthBased: true,
  },
  {
    id: 'discord',
    label: 'Discord',
    providerType: 'messaging',
    category: 'Messaging',
    description: 'Server updates, missed messages',
    available: true,
    oauthBased: true,
  },

  // ── Development ──
  {
    id: 'github',
    label: 'GitHub',
    providerType: 'dev',
    category: 'Development',
    description: 'PRs, issues, repo activity',
    available: true,
    oauthBased: true,
  },

  // ── Productivity ──
  {
    id: 'notion',
    label: 'Notion',
    providerType: 'knowledge',
    category: 'Productivity',
    description: 'Search and reference your notes and docs',
    available: true,
    oauthBased: true,
  },
  {
    id: 'todoist',
    label: 'Todoist',
    providerType: 'tasks',
    category: 'Productivity',
    description: 'Sync tasks, manage your to-do list',
    available: true,
    oauthBased: true,
  },

  // ── Monitoring ──
  {
    id: 'website_watcher',
    label: 'Website Watcher',
    providerType: 'monitor',
    category: 'Monitoring',
    description: 'Track changes on any webpage',
    available: true,
    oauthBased: false,
  },
];

// ─── Store shape ──────────────────────────────────────────────

interface AssistantState {
  // Connected accounts (loaded from SQLite cache, synced from Supabase)
  accounts: AssistantAccount[];
  accountsLoading: boolean;
  accountsError: string | null;

  // Active chat messages for the Assistant section
  messages: AssistantMessage[];
  isLoading: boolean;

  // Which account detail modal is open (null = closed)
  editingAccountId: string | null;

  // Connect modal state
  connectModalOpen: boolean;
  connectingProvider: string | null; // provider id currently in OAuth flow

  // Actions
  loadAccounts: (userId: string) => Promise<void>;
  syncAccountsFromSupabase: (userId: string) => Promise<void>;
  addAccount: (account: AssistantAccount) => Promise<void>;
  removeAccount: (id: string, userId: string) => Promise<void>;
  updateAccountLabel: (id: string, label: string) => Promise<void>;

  addMessage: (message: AssistantMessage) => void;
  setMessages: (messages: AssistantMessage[]) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;

  openConnectModal: (provider?: string) => void;
  closeConnectModal: () => void;
  setEditingAccount: (id: string | null) => void;
}

// ─── Store ────────────────────────────────────────────────────

export const useAssistantStore = create<AssistantState>((set, get) => ({
  accounts: [],
  accountsLoading: false,
  accountsError: null,
  messages: [],
  isLoading: false,
  editingAccountId: null,
  connectModalOpen: false,
  connectingProvider: null,

  // ── Load accounts from local SQLite cache ──────────────────
  // Fast path — used on section open. No network call.
  loadAccounts: async (userId: string) => {
    set({ accountsLoading: true, accountsError: null });
    try {
      const accounts = await dbService.getAssistantAccounts(userId);
      set({ accounts, accountsLoading: false });
    } catch (err: any) {
      console.error('[AssistantStore] Failed to load accounts from cache:', err);
      set({ accountsError: 'Failed to load accounts', accountsLoading: false });
    }
  },

  // ── Sync from Supabase → local cache ──────────────────────
  // Called after loadAccounts to get fresh data from the server.
  // Updates the cache and refreshes in-memory state.
  syncAccountsFromSupabase: async (userId: string) => {
    try {
      const { data, error } = await getSupabase()
        .from('assistant_email_accounts')
        .select('id, user_id, provider, provider_type, email, display_name, account_label, is_active, connected_at')
        .eq('user_id', userId)
        .eq('is_active', true);

      if (error) throw error;
      if (!data) return;

      // Rebuild cache for this user
      await dbService.clearAssistantAccountsForUser(userId);

      const accounts: AssistantAccount[] = [];
      for (const row of data) {
        const account: AssistantAccount = {
          id: row.id,
          userId: row.user_id,
          provider: row.provider,
          providerType: row.provider_type ?? 'email',
          email: row.email,
          displayName: row.display_name ?? null,
          accountLabel: row.account_label ?? null,
          isActive: row.is_active ?? true,
          connectedAt: row.connected_at ?? null,
          syncedAt: new Date().toISOString(),
        };
        await dbService.upsertAssistantAccount(account);
        accounts.push(account);
      }

      set({ accounts });
    } catch (err: any) {
      // Non-fatal — user still sees cached data
      console.error('[AssistantStore] Supabase sync failed (using cached data):', err);
    }
  },

  // ── Add a newly connected account ─────────────────────────
  // Called after a successful OAuth flow. Saves to both SQLite and
  // updates in-memory state immediately so UI reflects the change.
  addAccount: async (account: AssistantAccount) => {
    await dbService.upsertAssistantAccount(account);
    set((state) => ({
      accounts: [...state.accounts.filter((a) => a.id !== account.id), account],
    }));
  },

  // ── Remove an account ──────────────────────────────────────
  // Deletes from SQLite cache. Caller is responsible for also
  // deleting from Supabase (done in the UI component via supabase client).
  removeAccount: async (id: string, userId: string) => {
    await dbService.deleteAssistantAccount(id);
    set((state) => ({
      accounts: state.accounts.filter((a) => a.id !== id),
    }));
  },

  // ── Update account label ───────────────────────────────────
  updateAccountLabel: async (id: string, label: string) => {
    await dbService.updateAssistantAccountLabel(id, label);
    set((state) => ({
      accounts: state.accounts.map((a) =>
        a.id === id ? { ...a, accountLabel: label } : a
      ),
    }));
  },

  // ── Chat messages ──────────────────────────────────────────
  addMessage: (message) =>
    set((state) => ({ messages: [...state.messages, message] })),

  setMessages: (messages) => set({ messages }),

  clearMessages: () => set({ messages: [] }),

  setLoading: (loading) => set({ isLoading: loading }),

  // ── Modal controls ─────────────────────────────────────────
  openConnectModal: (provider) =>
    set({ connectModalOpen: true, connectingProvider: provider ?? null }),

  closeConnectModal: () =>
    set({ connectModalOpen: false, connectingProvider: null }),

  setEditingAccount: (id) => set({ editingAccountId: id }),
}));

// ─── Selectors ────────────────────────────────────────────────
// Use these in components instead of raw store access where possible.

export function selectEmailAccounts(accounts: AssistantAccount[]): AssistantAccount[] {
  return accounts.filter((a) => a.providerType === 'email' && a.isActive);
}

export function selectCanAddEmailAccount(
  accounts: AssistantAccount[],
  plan: string
): boolean {
  const emailCount = selectEmailAccounts(accounts).length;
  const limit = getEmailAccountLimit(plan);
  return emailCount < limit;
}

export function selectEmailAccountsRemaining(
  accounts: AssistantAccount[],
  plan: string
): number {
  const emailCount = selectEmailAccounts(accounts).length;
  const limit = getEmailAccountLimit(plan);
  if (limit === Infinity) return Infinity;
  return Math.max(0, limit - emailCount);
}

export function selectAccountsByType(
  accounts: AssistantAccount[],
  providerType: ProviderType
): AssistantAccount[] {
  const providerIds = ASSISTANT_PROVIDERS
    .filter((p) => p.providerType === providerType)
    .map((p) => p.id);
  return accounts.filter((a) => a.isActive && providerIds.includes(a.provider));
}

export function selectTotalActiveAccounts(accounts: AssistantAccount[]): number {
  return accounts.filter((a) => a.isActive).length;
}

export function selectCanAddIntegration(
  accounts: AssistantAccount[],
  plan: string
): boolean {
  const total = selectTotalActiveAccounts(accounts);
  const limit = getIntegrationLimit(plan);
  return total < limit;
}