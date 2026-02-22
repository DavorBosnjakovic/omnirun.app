// ============================================================
// Auth Store — Zustand state for authentication & profile
// ============================================================
// Manages user session, profile data, and admin status.
// Profile data (plan, isAdmin, subscriptionStatus) is used
// locally to gate features — no server roundtrip needed
// after initial fetch.

import { create } from 'zustand';
import * as authService from '../services/authService';
import type { UserProfile } from '../services/authService';
import type { Session, Subscription } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────

interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
}

interface AuthState {
  // User & session
  user: AuthUser | null;
  session: Session | null;
  profile: UserProfile | null;

  // Status flags
  isAuthenticated: boolean;
  isLoading: boolean;
  authError: string | null;

  // Derived from profile (convenience accessors)
  isAdmin: boolean;
  plan: 'starter' | 'pro' | 'business' | 'enterprise';
  subscriptionStatus: string | null;

  // Actions
  initialize: () => Promise<void>;
  login: (email: string, password: string) => Promise<{ error: string | null }>;
  signup: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>;
  sendMagicLink: (email: string) => Promise<{ error: string | null }>;
  logout: () => Promise<void>;
  fetchProfile: () => Promise<void>;
  setProfile: (profile: UserProfile) => void;
  clearError: () => void;
  cleanup: () => void;
}

// ─── Store ───────────────────────────────────────────────────

// Keep the auth listener subscription reference so we can unsubscribe
let authSubscription: Subscription | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  // Initial state
  user: null,
  session: null,
  profile: null,
  isAuthenticated: false,
  isLoading: false,
  authError: null,
  isAdmin: false,
  plan: 'starter',
  subscriptionStatus: null,

  /**
   * Initialize auth on app startup.
   * Tries to restore session from SQLite-stored tokens.
   * If successful, fetches the user profile from Supabase.
   */
  initialize: async () => {
    set({ isLoading: true, authError: null });

    try {
      // 1. Try restoring session from SQLite
      const session = await authService.restoreSession();

      if (session?.user) {
        const user: AuthUser = {
          id: session.user.id,
          email: session.user.email || '',
          displayName: session.user.user_metadata?.display_name || null,
        };

        set({
          user,
          session,
          isAuthenticated: true,
        });

        // 2. Fetch profile from Supabase (plan, admin, subscription)
        await get().fetchProfile();
      } else {
        set({ isAuthenticated: false, user: null, session: null });
      }

      // 3. Set up auth state listener for token refreshes
      if (authSubscription) {
        authSubscription.unsubscribe();
      }

      authSubscription = authService.onAuthStateChange((event, newSession) => {
        if (event === 'SIGNED_OUT') {
          set({
            user: null,
            session: null,
            profile: null,
            isAuthenticated: false,
            isAdmin: false,
            plan: 'starter',
            subscriptionStatus: null,
          });
        } else if (event === 'TOKEN_REFRESHED' && newSession) {
          set({ session: newSession });
        }
      });
    } catch (err) {
      console.error('[AuthStore] Initialization error:', err);
      set({ isAuthenticated: false });
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Email + password login
   */
  login: async (email, password) => {
    set({ isLoading: true, authError: null });

    const { session, error } = await authService.signIn(email, password);

    if (error || !session) {
      set({ isLoading: false, authError: error || 'Login failed' });
      return { error: error || 'Login failed' };
    }

    const user: AuthUser = {
      id: session.user.id,
      email: session.user.email || '',
      displayName: session.user.user_metadata?.display_name || null,
    };

    set({
      user,
      session,
      isAuthenticated: true,
      isLoading: false,
      authError: null,
    });

    // Fetch profile in background
    get().fetchProfile();

    return { error: null };
  },

  /**
   * Email + password signup
   */
  signup: async (email, password, displayName) => {
    set({ isLoading: true, authError: null });

    const { session, error } = await authService.signUp(email, password, displayName);

    if (error) {
      set({ isLoading: false, authError: error });
      return { error };
    }

    // If email confirmation is required, session will be null
    if (!session) {
      set({ isLoading: false });
      return { error: null }; // Caller should show "check your email" message
    }

    const user: AuthUser = {
      id: session.user.id,
      email: session.user.email || '',
      displayName: session.user.user_metadata?.display_name || displayName,
    };

    set({
      user,
      session,
      isAuthenticated: true,
      isLoading: false,
      authError: null,
    });

    get().fetchProfile();

    return { error: null };
  },

  /**
   * Send magic link email
   */
  sendMagicLink: async (email) => {
    set({ isLoading: true, authError: null });

    const { error } = await authService.signInWithMagicLink(email);

    set({ isLoading: false, authError: error });
    return { error };
  },

  /**
   * Logout — clears session, tokens, and profile
   */
  logout: async () => {
    await authService.signOut();
    set({
      user: null,
      session: null,
      profile: null,
      isAuthenticated: false,
      isAdmin: false,
      plan: 'starter',
      subscriptionStatus: null,
      authError: null,
    });
  },

  /**
   * Fetch profile from Supabase and update local state.
   * Called after login/signup and on app startup.
   */
  fetchProfile: async () => {
    try {
      const profile = await authService.getProfile();
      if (profile) {
        set({
          profile,
          isAdmin: profile.is_admin || false,
          plan: profile.plan || 'starter',
          subscriptionStatus: profile.subscription_status,
        });
      }
    } catch (err) {
      console.error('[AuthStore] Failed to fetch profile:', err);
    }
  },

  /**
   * Manually set profile (e.g. after a Stripe webhook updates it)
   */
  setProfile: (profile) => {
    set({
      profile,
      isAdmin: profile.is_admin || false,
      plan: profile.plan || 'starter',
      subscriptionStatus: profile.subscription_status,
    });
  },

  clearError: () => set({ authError: null }),

  /**
   * Cleanup auth listener on app unmount
   */
  cleanup: () => {
    if (authSubscription) {
      authSubscription.unsubscribe();
      authSubscription = null;
    }
  },
}));