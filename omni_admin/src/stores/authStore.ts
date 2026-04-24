import { create } from "zustand";
import type { User, Session } from "@supabase/supabase-js";
import { getSupabase } from "../lib/supabase";
import type { Profile } from "../types";

interface AuthState {
  // State
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  isAdmin: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  checkSession: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  session: null,
  profile: null,
  isAdmin: false,
  isLoading: true,
  error: null,

  // Called on app startup - restores session from storage if present,
  // fetches profile, sets isAdmin. Sets isLoading = false when done.
  checkSession: async () => {
    const supabase = getSupabase();

    try {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error("checkSession error:", error);
        set({ isLoading: false });
        return;
      }

      if (!session) {
        set({
          user: null,
          session: null,
          profile: null,
          isAdmin: false,
          isLoading: false,
        });
        return;
      }

      // Session exists - fetch profile
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", session.user.id)
        .single();

      if (profileError) {
        console.error("Failed to fetch profile:", profileError);
        set({
          user: session.user,
          session,
          profile: null,
          isAdmin: false,
          isLoading: false,
        });
        return;
      }

      set({
        user: session.user,
        session,
        profile: profile as Profile,
        isAdmin: !!profile?.is_admin,
        isLoading: false,
      });
    } catch (err) {
      console.error("checkSession exception:", err);
      set({ isLoading: false });
    }

    // Subscribe to auth state changes (refresh, sign out from elsewhere, etc.)
    supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!newSession) {
        set({
          user: null,
          session: null,
          profile: null,
          isAdmin: false,
        });
        return;
      }
      // Session refreshed - re-fetch profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", newSession.user.id)
        .single();

      set({
        user: newSession.user,
        session: newSession,
        profile: profile as Profile,
        isAdmin: !!profile?.is_admin,
      });
    });
  },

  signIn: async (email, password) => {
    const supabase = getSupabase();
    set({ error: null });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      set({ error: error.message });
      return { ok: false, error: error.message };
    }

    if (!data.session) {
      const msg = "No session returned from login.";
      set({ error: msg });
      return { ok: false, error: msg };
    }

    // Fetch profile to determine admin status
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", data.session.user.id)
      .single();

    if (profileError) {
      const msg = "Signed in but couldn't load profile.";
      set({ error: msg });
      return { ok: false, error: msg };
    }

    set({
      user: data.session.user,
      session: data.session,
      profile: profile as Profile,
      isAdmin: !!profile?.is_admin,
      error: null,
    });

    return { ok: true };
  },

  signOut: async () => {
    const supabase = getSupabase();
    await supabase.auth.signOut();
    set({
      user: null,
      session: null,
      profile: null,
      isAdmin: false,
      error: null,
    });
  },

  refreshProfile: async () => {
    const supabase = getSupabase();
    const { user } = get();
    if (!user) return;

    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .single();

    if (profile) {
      set({
        profile: profile as Profile,
        isAdmin: !!profile.is_admin,
      });
    }
  },
}));