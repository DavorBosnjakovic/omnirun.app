// ============================================================
// Supabase Client — singleton instance for all cloud operations
// ============================================================
// Uses the public anon key (safe for client-side).
// RLS protects all data server-side.
//
// IMPORTANT: Update these values after creating your Supabase project.
// These are NOT secret — the anon key is designed for client-side use.

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ─── Configuration ──────────────────────────────────────────
// TODO: Replace with your actual Supabase project values
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY';

// ─── Client Instance ────────────────────────────────────────

let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    supabaseInstance = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // We manage token persistence ourselves (SQLite),
        // so disable the default localStorage-based persistence
        persistSession: false,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return supabaseInstance;
}

export { SUPABASE_URL, SUPABASE_ANON_KEY };