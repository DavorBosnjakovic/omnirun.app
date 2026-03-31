// ============================================================
// Env Service — Auto-generate .env from connected services
// ============================================================
// Writes .env via Rust's write_file (bypasses AI's sensitive file block).
// The AI CANNOT touch .env — this service is the only path.
//
// Supports: Supabase (project-scoped), Resend, Stripe, SendGrid (global).
// Vercel doesn't need local .env — env vars are pushed via API.
//
// Data model:
//   Each Omnirun project has at most ONE connection per provider.
//   Multiple Omnirun projects can share the same external project/account.
//   For Supabase: the user picks which Supabase project to link at connection
//   time, stored in accountInfo.extra.selectedProjectRef.

import { invoke } from '@tauri-apps/api/core';
import { useConnectionsStore } from '../stores/connectionsStore';
import { executeProjectProviderAction } from './connections/connectionManager';
import type { ConnectionProvider } from './connections/types';

// --------------- Types ---------------

interface EnvEntry {
  key: string;
  value: string;
  comment?: string; // shown above the line as # comment
}

export interface EnvGenerationResult {
  success: boolean;
  entries: EnvEntry[];
  written: boolean;        // false if dry-run or nothing to write
  skippedKeys: string[];   // keys that already existed and were not overwritten
  error?: string;
}

// --------------- Core ---------------

/**
 * Generate and write .env file from connected services.
 *
 * @param omnirunProjectId  Omnirun project ID (to look up project-scoped connections)
 * @param projectPath       Filesystem path to the project root (where .env goes)
 * @param options.overwrite  Overwrite existing keys (default: false — merge only)
 * @param options.dryRun     If true, return entries without writing (default: false)
 * @param options.framework  Frontend framework hint for var prefix (auto-detected if omitted)
 */
export async function generateEnvFile(
  omnirunProjectId: string,
  projectPath: string,
  options: {
    overwrite?: boolean;
    dryRun?: boolean;
    framework?: 'vite' | 'next' | 'cra' | 'plain';
  } = {}
): Promise<EnvGenerationResult> {
  const { overwrite = false, dryRun = false } = options;
  const framework = options.framework ?? await detectFramework(projectPath);
  const store = useConnectionsStore.getState();
  const entries: EnvEntry[] = [];
  const errors: string[] = [];

  // Determine env var prefix based on framework
  const publicPrefix = getPublicPrefix(framework);

  // ── Supabase (project-scoped) ──
  // Each Omnirun project connects to exactly one Supabase project.
  // The selected project ref is stored in accountInfo.extra.selectedProjectRef
  // at connection time (set by the connection UI when user picks a project).
  if (store.isProjectConnected(omnirunProjectId, 'supabase')) {
    try {
      const supaEntries = await getSupabaseEntries(omnirunProjectId, publicPrefix);
      entries.push(...supaEntries);
    } catch (e: any) {
      errors.push(`Supabase: ${e.message}`);
    }
  }

  // ── Resend (global — one account, all projects share it) ──
  if (store.isConnected('resend')) {
    const token = store.getToken('resend');
    if (token) {
      entries.push({
        key: 'RESEND_API_KEY',
        value: token,
        comment: 'Resend — transactional email',
      });
    }
  }

  // ── Stripe (global) ──
  if (store.isConnected('stripe')) {
    const token = store.getToken('stripe');
    if (token) {
      // The connected token is the secret key (sk_live_... or sk_test_...)
      entries.push({
        key: 'STRIPE_SECRET_KEY',
        value: token,
        comment: 'Stripe — server-side only, never expose to client',
      });

      // Publishable key placeholder — user fills this in
      const isTest = token.startsWith('sk_test_');
      entries.push({
        key: `${publicPrefix}STRIPE_PUBLISHABLE_KEY`,
        value: '',
        comment: `Stripe publishable key (${isTest ? 'test' : 'live'} mode) — get from https://dashboard.stripe.com/apikeys`,
      });
    }
  }

  // ── SendGrid (global) ──
  if (store.isConnected('sendgrid')) {
    const token = store.getToken('sendgrid');
    if (token) {
      entries.push({
        key: 'SENDGRID_API_KEY',
        value: token,
        comment: 'SendGrid — transactional email',
      });
    }
  }

  // Nothing to generate
  if (entries.length === 0) {
    return {
      success: errors.length === 0,
      entries: [],
      written: false,
      skippedKeys: [],
      error: errors.length > 0
        ? errors.join('; ')
        : 'No connected services that need .env variables.',
    };
  }

  if (dryRun) {
    return { success: true, entries, written: false, skippedKeys: [] };
  }

  // ── Read existing .env (merge, don't clobber) ──
  const envPath = normalizeEnvPath(projectPath);
  let existing: Record<string, string> = {};
  try {
    const raw = await invoke<string>('read_file', { path: envPath });
    existing = parseEnvFile(raw);
  } catch {
    // File doesn't exist yet — that's fine
  }

  // Merge
  const skippedKeys: string[] = [];
  const merged = { ...existing };

  for (const entry of entries) {
    if (entry.key in merged && !overwrite) {
      skippedKeys.push(entry.key);
      continue;
    }
    merged[entry.key] = entry.value;
  }

  // ── Write .env ──
  const content = serializeEnvFile(entries, merged, existing, overwrite);
  try {
    await invoke('write_file', { path: envPath, content });
  } catch (e: any) {
    return {
      success: false,
      entries,
      written: false,
      skippedKeys,
      error: `Failed to write .env: ${e.message || e}`,
    };
  }

  return {
    success: true,
    entries,
    written: true,
    skippedKeys,
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

/**
 * Check which connected services can contribute env vars.
 * Useful for UI to show what will be generated before writing.
 */
export function getAvailableEnvProviders(omnirunProjectId: string): {
  provider: ConnectionProvider;
  label: string;
  keys: string[];
}[] {
  const store = useConnectionsStore.getState();
  const result: { provider: ConnectionProvider; label: string; keys: string[] }[] = [];

  if (store.isProjectConnected(omnirunProjectId, 'supabase')) {
    result.push({
      provider: 'supabase',
      label: 'Supabase',
      keys: ['SUPABASE_URL', 'SUPABASE_ANON_KEY'],
    });
  }
  if (store.isConnected('resend')) {
    result.push({ provider: 'resend', label: 'Resend', keys: ['RESEND_API_KEY'] });
  }
  if (store.isConnected('stripe')) {
    result.push({
      provider: 'stripe',
      label: 'Stripe',
      keys: ['STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY'],
    });
  }
  if (store.isConnected('sendgrid')) {
    result.push({ provider: 'sendgrid', label: 'SendGrid', keys: ['SENDGRID_API_KEY'] });
  }

  return result;
}

// --------------- Supabase ---------------

async function getSupabaseEntries(
  omnirunProjectId: string,
  publicPrefix: string
): Promise<EnvEntry[]> {
  const store = useConnectionsStore.getState();
  const conn = store.getProjectConnection(omnirunProjectId, 'supabase');

  // The selected Supabase project ref was stored at connection time
  const ref = conn?.accountInfo?.extra?.selectedProjectRef;
  if (!ref) {
    throw new Error(
      'No Supabase project selected for this connection. Reconnect and pick a project.'
    );
  }

  // Fetch API keys from Supabase Management API
  const keys = await executeProjectProviderAction(
    omnirunProjectId,
    'supabase',
    'get_api_keys',
    { projectRef: ref }
  );

  const anonKey = Array.isArray(keys)
    ? keys.find((k: any) => k.name === 'anon')?.api_key
    : null;

  const entries: EnvEntry[] = [];

  entries.push({
    key: `${publicPrefix}SUPABASE_URL`,
    value: `https://${ref}.supabase.co`,
    comment: 'Supabase — project URL',
  });

  if (anonKey) {
    entries.push({
      key: `${publicPrefix}SUPABASE_ANON_KEY`,
      value: anonKey,
      comment: 'Supabase — public anon key (safe for client-side)',
    });
  }

  return entries;
}

// --------------- Framework Detection ---------------

function getPublicPrefix(framework: string): string {
  switch (framework) {
    case 'vite':    return 'VITE_';
    case 'next':    return 'NEXT_PUBLIC_';
    case 'cra':     return 'REACT_APP_';
    case 'plain':   return '';
    default:        return 'VITE_';
  }
}

/**
 * Auto-detect framework from project's package.json.
 */
export async function detectFramework(
  projectPath: string
): Promise<'vite' | 'next' | 'cra' | 'plain'> {
  try {
    const sep = projectPath.includes('/') ? '/' : '\\';
    const pkgRaw = await invoke<string>('read_file', {
      path: `${projectPath}${sep}package.json`,
    });
    const pkg = JSON.parse(pkgRaw);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps['next'])              return 'next';
    if (deps['react-scripts'])     return 'cra';
    if (deps['vite'])              return 'vite';

    return 'plain';
  } catch {
    return 'plain';
  }
}

// --------------- .env File I/O ---------------

function normalizeEnvPath(projectPath: string): string {
  const sep = projectPath.includes('/') ? '/' : '\\';
  return `${projectPath}${sep}.env`;
}

function parseEnvFile(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

/**
 * Serialize .env content preserving existing structure and adding new entries.
 * Groups new entries with their comments at the bottom.
 */
function serializeEnvFile(
  newEntries: EnvEntry[],
  merged: Record<string, string>,
  existing: Record<string, string>,
  overwrite: boolean
): string {
  const lines: string[] = [];

  // Keep existing keys in their original order (with updated values if overwrite)
  const existingKeys = new Set(Object.keys(existing));
  for (const key of existingKeys) {
    lines.push(`${key}=${merged[key]}`);
  }

  // New entries that aren't already in the file
  const trulyNew = newEntries.filter((e) => !existingKeys.has(e.key));

  if (existingKeys.size > 0 && trulyNew.length > 0) {
    lines.push('');
    lines.push('# ── Generated by Omnirun ──');
  }

  for (const entry of trulyNew) {
    if (entry.comment) {
      lines.push(`# ${entry.comment}`);
    }
    lines.push(`${entry.key}=${entry.value}`);
  }

  return lines.join('\n') + '\n';
}