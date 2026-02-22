// ============================================================
// Auth Service — Supabase authentication operations
// ============================================================
// All auth operations go through this service.
// The handle_new_user() trigger in Supabase auto-creates a
// profiles row on signup — we don't need to create it manually.
//
// Privacy: No chat content, project files, or API keys are
// ever sent to Supabase. Only auth + subscription metadata.

import { Session, AuthChangeEvent, Subscription } from '@supabase/supabase-js';
import { getSupabase } from './supabaseClient';
import { dbService } from './dbService';

// ─── Types ───────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string;
  display_name: string | null;
  plan: 'starter' | 'pro' | 'business' | 'enterprise';
  subscription_status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'unpaid' | 'paused' | 'incomplete' | 'incomplete_expired';
  is_admin: boolean;
  is_banned: boolean;
  trial_started_at: string | null;
  trial_ends_at: string | null;
  stripe_customer_id: string | null;
  created_at: string;
  last_active_at: string | null;
}

// ─── Sign Up ────────────────────────────────────────────────

export async function signUp(
  email: string,
  password: string,
  displayName: string
): Promise<{ session: Session | null; error: string | null }> {
  const supabase = getSupabase();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName,
      },
    },
  });

  if (error) {
    return { session: null, error: error.message };
  }

  if (data.session) {
    await persistSession(data.session);
  }

  return { session: data.session, error: null };
}

// ─── Sign In (Email + Password) ─────────────────────────────

export async function signIn(
  email: string,
  password: string
): Promise<{ session: Session | null; error: string | null }> {
  const supabase = getSupabase();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return { session: null, error: error.message };
  }

  if (data.session) {
    await persistSession(data.session);
  }

  return { session: data.session, error: null };
}

// ─── Sign In (Magic Link) ───────────────────────────────────

export async function signInWithMagicLink(
  email: string
): Promise<{ error: string | null }> {
  const supabase = getSupabase();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      // For desktop app, the magic link callback needs special handling.
      // The user will get an email with a link that includes the tokens
      // as URL params. We'll need to handle the deep link or ask the
      // user to paste the link/code. For MVP, email+password is primary.
      shouldCreateUser: true,
    },
  });

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

// ─── Sign Out ───────────────────────────────────────────────

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  await supabase.auth.signOut();
  await dbService.clearAuthTokens();
}

// ─── Session Management ─────────────────────────────────────

export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function refreshSession(): Promise<Session | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.refreshSession();

  if (error) {
    console.warn('[Auth] Failed to refresh session:', error.message);
    return null;
  }

  if (data.session) {
    await persistSession(data.session);
  }

  return data.session;
}

/**
 * Restore session from SQLite-stored tokens on app startup.
 * Returns a valid session or null if tokens are missing/expired.
 */
export async function restoreSession(): Promise<Session | null> {
  try {
    const tokens = await dbService.loadAuthTokens();
    if (!tokens) return null;

    const supabase = getSupabase();

    // Use the stored refresh token to get a new session
    const { data, error } = await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });

    if (error) {
      console.warn('[Auth] Failed to restore session:', error.message);
      await dbService.clearAuthTokens();
      return null;
    }

    if (data.session) {
      // Persist the potentially refreshed tokens
      await persistSession(data.session);
      return data.session;
    }

    return null;
  } catch (err) {
    console.error('[Auth] Error restoring session:', err);
    return null;
  }
}

// ─── Auth State Listener ────────────────────────────────────

export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): Subscription {
  const supabase = getSupabase();
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    // Auto-persist on token refresh
    if (session && (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN')) {
      persistSession(session).catch(console.error);
    }
    if (event === 'SIGNED_OUT') {
      dbService.clearAuthTokens().catch(console.error);
    }
    callback(event, session);
  });
  return data.subscription;
}

// ─── Profile Operations ─────────────────────────────────────

export async function getProfile(): Promise<UserProfile | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return null;

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('[Auth] Failed to fetch profile:', error.message);
    return null;
  }

  return data as UserProfile;
}

export async function updateProfile(
  updates: { display_name?: string }
): Promise<{ error: string | null }> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) return { error: 'Not authenticated' };

  const { error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id);

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

// ─── Internal Helpers ───────────────────────────────────────

async function persistSession(session: Session): Promise<void> {
  try {
    await dbService.saveAuthTokens({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at ?? null,
    });
  } catch (err) {
    console.error('[Auth] Failed to persist session tokens:', err);
  }
}