// ============================================================
// oauthCredentialService.ts
// ============================================================
// Stores and retrieves OAuth client credentials (client_id,
// client_secret) per provider using localStorage.
//
// Follows the same storage pattern as AI provider keys
// (ai-providers in localStorage). When those are migrated
// to SQLite, migrate these too.
//
// These are stored on-device only — never sent to Supabase.

// ─── Storage key ──────────────────────────────────────────────

const STORAGE_KEY = 'oauth-credentials';

// ─── Types ────────────────────────────────────────────────────

export interface OAuthCredentials {
  clientId: string;
  clientSecret: string;
}

type CredentialStore = Record<string, OAuthCredentials>;

// ─── Internal helpers ─────────────────────────────────────────

function loadStore(): CredentialStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CredentialStore;
  } catch {
    return {};
  }
}

function persistStore(store: CredentialStore): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

// ─── Public API ───────────────────────────────────────────────

/**
 * Get stored OAuth credentials for a provider.
 * Returns null if none saved.
 */
export function getOAuthCredentials(
  provider: string
): OAuthCredentials | null {
  const store = loadStore();
  const creds = store[provider];
  if (creds?.clientId && creds?.clientSecret) return creds;
  return null;
}

/**
 * Save OAuth credentials for a provider.
 * Overwrites if already exists.
 */
export function saveOAuthCredentials(
  provider: string,
  credentials: OAuthCredentials
): void {
  const store = loadStore();
  store[provider] = credentials;
  persistStore(store);
}

/**
 * Delete stored credentials for a provider.
 */
export function deleteOAuthCredentials(provider: string): void {
  const store = loadStore();
  delete store[provider];
  persistStore(store);
}

/**
 * Resolve credentials for a provider.
 * Checks localStorage first, then falls back to env vars.
 * Returns null if neither source has credentials.
 */
export function resolveOAuthCredentials(
  provider: string
): OAuthCredentials | null {
  // 1. Check localStorage
  const stored = getOAuthCredentials(provider);
  if (stored) return stored;

  // 2. Fall back to env vars per provider
  const envMap: Record<string, { id: string; secret: string }> = {
    gmail:            { id: 'VITE_GMAIL_CLIENT_ID',     secret: 'VITE_GMAIL_CLIENT_SECRET' },
    outlook:          { id: 'VITE_OUTLOOK_CLIENT_ID',   secret: 'VITE_OUTLOOK_CLIENT_SECRET' },
    google_calendar:  { id: 'VITE_GMAIL_CLIENT_ID',     secret: 'VITE_GMAIL_CLIENT_SECRET' },       // shares with Gmail
    outlook_calendar: { id: 'VITE_OUTLOOK_CLIENT_ID',   secret: 'VITE_OUTLOOK_CLIENT_SECRET' },     // shares with Outlook
    slack:            { id: 'VITE_SLACK_CLIENT_ID',     secret: 'VITE_SLACK_CLIENT_SECRET' },
    discord:          { id: 'VITE_DISCORD_CLIENT_ID',   secret: 'VITE_DISCORD_CLIENT_SECRET' },
    github:           { id: 'VITE_GITHUB_CLIENT_ID',    secret: 'VITE_GITHUB_CLIENT_SECRET' },
    notion:           { id: 'VITE_NOTION_CLIENT_ID',    secret: 'VITE_NOTION_CLIENT_SECRET' },
    todoist:          { id: 'VITE_TODOIST_CLIENT_ID',   secret: 'VITE_TODOIST_CLIENT_SECRET' },
  };

  const envKeys = envMap[provider];
  if (envKeys) {
    const clientId = (import.meta as any).env?.[envKeys.id];
    const clientSecret = (import.meta as any).env?.[envKeys.secret];
    if (clientId && clientSecret) return { clientId, clientSecret };
  }

  return null;
}