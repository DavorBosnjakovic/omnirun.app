// ============================================================
// Team Store — Zustand state for team features
// ============================================================
// Manages team data, members, invitations, activity log,
// shared API key policy, and project locking.
//
// Shared key encryption uses AES-GCM via the Web Crypto API.
// The encryption key is derived from the team ID + owner ID,
// which means only someone with access to the team row in
// Supabase (i.e. a team member) can decrypt the keys.
// This is "good enough" encryption — the real security layer
// is Supabase RLS, which restricts row access to team members.

import { create } from 'zustand';
import { getSupabase } from '../services/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─── Module-level refs for intervals and subscriptions ──────
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let idleCheckInterval: ReturnType<typeof setInterval> | null = null;
let lastActivityTimestamp: number = Date.now();
let activeLockedProject: string | null = null;
let locksChannel: RealtimeChannel | null = null;

const HEARTBEAT_MS = 60_000;        // 60 seconds
const IDLE_TIMEOUT_MS = 15 * 60_000; // 15 minutes
const IDLE_CHECK_MS = 60_000;        // check every 60 seconds

// ─── Types ───────────────────────────────────────────────────

export interface Team {
  id: string;
  name: string;
  owner_id: string;
  plan: string;
  api_key_policy: 'shared' | 'individual';
  max_seats: number;
  encrypted_api_keys: string | null;
  shared_keys_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: 'owner' | 'member';
  joined_at: string;
  // Joined from profiles
  email?: string;
  display_name?: string;
  avatar_url?: string;
}

export interface TeamInvitation {
  id: string;
  team_id: string;
  invited_by: string;
  email: string;
  status: 'pending' | 'accepted' | 'expired';
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export interface ActivityLogEntry {
  id: string;
  team_id: string;
  user_id: string;
  action: string;
  project_name: string | null;
  metadata: Record<string, any>;
  created_at: string;
  // Joined from profiles
  display_name?: string;
  email?: string;
}

export interface ProjectLock {
  id: string;
  team_id: string;
  project_name: string;
  locked_by: string;
  locked_at: string;
  last_heartbeat: string;
  // Joined from profiles (populated by fetchLocks)
  locked_by_name?: string;
}

export interface SharedProviderConfig {
  providerId: string;
  apiKey: string;
  selectedModel: string;
}

interface TeamState {
  // Data
  team: Team | null;
  members: TeamMember[];
  invitations: TeamInvitation[];
  activityLog: ActivityLogEntry[];
  sharedKeys: SharedProviderConfig[] | null;
  projectLocks: ProjectLock[];

  // Status
  isLoading: boolean;
  error: string | null;
  isOwner: boolean;
  hasTeam: boolean;

  // Actions — data fetching
  fetchTeam: (userId: string) => Promise<void>;
  fetchMembers: () => Promise<void>;
  fetchInvitations: () => Promise<void>;
  fetchActivityLog: () => Promise<void>;

  // Actions — team management
  updateTeamName: (name: string) => Promise<{ error: string | null }>;
  removeMember: (memberId: string) => Promise<{ error: string | null }>;
  sendInvitation: (email: string, invitedBy: string) => Promise<{ error: string | null }>;
  cancelInvitation: (invitationId: string) => Promise<{ error: string | null }>;
  resendInvitation: (invitationId: string) => Promise<{ error: string | null }>;
  acceptInvitation: (token: string) => Promise<{ error: string | null; teamId?: string }>;

  // Actions — API key policy
  setApiKeyPolicy: (policy: 'shared' | 'individual', ownerKeys?: SharedProviderConfig[]) => Promise<{ error: string | null }>;
  fetchSharedKeys: () => Promise<SharedProviderConfig[] | null>;

  // Actions — project locking
  lockProject: (projectName: string) => Promise<{ error: string | null }>;
  unlockProject: (projectName: string) => Promise<void>;
  unlockAllMyLocks: () => Promise<void>;
  forceUnlock: (projectName: string) => Promise<{ error: string | null }>;
  fetchLocks: () => Promise<void>;
  subscribeToLocks: () => void;
  unsubscribeFromLocks: () => void;
  startHeartbeat: (projectName: string) => void;
  stopHeartbeat: () => void;
  trackActivity: () => void;
  startIdleTimer: () => void;
  stopIdleTimer: () => void;
  getLockedByName: (projectName: string) => string | null;
  isProjectLocked: (projectName: string) => boolean;
  isProjectLockedByMe: (projectName: string, userId: string) => boolean;

  // Actions — utility
  clearTeam: () => void;
}

// ─── Encryption helpers ──────────────────────────────────────
// Simple AES-GCM encryption using Web Crypto API.
// The key is derived from team_id + owner_id — not a secret,
// but combined with Supabase RLS it provides defense in depth.

async function deriveKey(teamId: string, ownerId: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(`${teamId}:${ownerId}:omnirun-team-key`);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptData(data: string, teamId: string, ownerId: string): Promise<string> {
  const key = await deriveKey(teamId, ownerId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(data);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  // Combine IV + ciphertext and base64 encode
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptData(encrypted: string, teamId: string, ownerId: string): Promise<string> {
  const key = await deriveKey(teamId, ownerId);
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

// ─── Store ───────────────────────────────────────────────────

export const useTeamStore = create<TeamState>((set, get) => ({
  // Initial state
  team: null,
  members: [],
  invitations: [],
  activityLog: [],
  sharedKeys: null,
  projectLocks: [],
  isLoading: false,
  error: null,
  isOwner: false,
  hasTeam: false,

  /**
   * Fetch the team the current user belongs to (if any).
   * Looks up team_members for the user, then fetches the team row.
   */
  fetchTeam: async (userId: string) => {
    set({ isLoading: true, error: null });

    try {
      const supabase = getSupabase();

      // Find which team this user is on
      const { data: membership, error: memberError } = await supabase
        .from('team_members')
        .select('team_id, role')
        .eq('user_id', userId)
        .maybeSingle();

      if (memberError) throw memberError;

      if (!membership) {
        set({ team: null, hasTeam: false, isOwner: false, isLoading: false });
        return;
      }

      // Fetch the team
      const { data: team, error: teamError } = await supabase
        .from('teams')
        .select('*')
        .eq('id', membership.team_id)
        .single();

      if (teamError) throw teamError;

      set({
        team: team as Team,
        isOwner: membership.role === 'owner',
        hasTeam: true,
      });

      // Fetch members and activity in parallel
      const state = get();
      await Promise.all([
        state.fetchMembers(),
        state.fetchActivityLog(),
      ]);

      // If owner, also fetch invitations
      if (membership.role === 'owner') {
        await state.fetchInvitations();
      }
    } catch (err: any) {
      console.error('[TeamStore] fetchTeam error:', err);
      set({ error: err.message || 'Failed to load team' });
    } finally {
      set({ isLoading: false });
    }
  },

  /**
   * Fetch all members of the current team, joined with profile info.
   */
  fetchMembers: async () => {
    const { team } = get();
    if (!team) return;

    try {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('team_members')
        .select(`
          id,
          team_id,
          user_id,
          role,
          joined_at,
          profiles:user_id (
            email,
            display_name,
            avatar_url
          )
        `)
        .eq('team_id', team.id)
        .order('joined_at', { ascending: true });

      if (error) throw error;

      const members: TeamMember[] = (data || []).map((m: any) => ({
        id: m.id,
        team_id: m.team_id,
        user_id: m.user_id,
        role: m.role,
        joined_at: m.joined_at,
        email: m.profiles?.email || '',
        display_name: m.profiles?.display_name || '',
        avatar_url: m.profiles?.avatar_url || null,
      }));

      set({ members });
    } catch (err: any) {
      console.error('[TeamStore] fetchMembers error:', err);
    }
  },

  /**
   * Fetch pending invitations (owner only).
   */
  fetchInvitations: async () => {
    const { team } = get();
    if (!team) return;

    try {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('team_invitations')
        .select('*')
        .eq('team_id', team.id)
        .in('status', ['pending'])
        .order('created_at', { ascending: false });

      if (error) throw error;
      set({ invitations: (data || []) as TeamInvitation[] });
    } catch (err: any) {
      console.error('[TeamStore] fetchInvitations error:', err);
    }
  },

  /**
   * Fetch last 30 days of activity, joined with profile display names.
   */
  fetchActivityLog: async () => {
    const { team } = get();
    if (!team) return;

    try {
      const supabase = getSupabase();

      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const { data, error } = await supabase
        .from('team_activity_log')
        .select(`
          id,
          team_id,
          user_id,
          action,
          project_name,
          metadata,
          created_at,
          profiles:user_id (
            display_name,
            email
          )
        `)
        .eq('team_id', team.id)
        .gte('created_at', thirtyDaysAgo.toISOString())
        .order('created_at', { ascending: false });

      if (error) throw error;

      const log: ActivityLogEntry[] = (data || []).map((entry: any) => ({
        id: entry.id,
        team_id: entry.team_id,
        user_id: entry.user_id,
        action: entry.action,
        project_name: entry.project_name,
        metadata: entry.metadata || {},
        created_at: entry.created_at,
        display_name: entry.profiles?.display_name || '',
        email: entry.profiles?.email || '',
      }));

      set({ activityLog: log });
    } catch (err: any) {
      console.error('[TeamStore] fetchActivityLog error:', err);
    }
  },

  // ─── Team Management ──────────────────────────────────────

  updateTeamName: async (name: string) => {
    const { team } = get();
    if (!team) return { error: 'No team found' };

    try {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('teams')
        .update({ name, updated_at: new Date().toISOString() })
        .eq('id', team.id);

      if (error) throw error;

      set({ team: { ...team, name } });
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to update team name' };
    }
  },

  removeMember: async (memberId: string) => {
    const { team } = get();
    if (!team) return { error: 'No team found' };

    try {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('id', memberId)
        .eq('team_id', team.id);

      if (error) throw error;

      // Refresh members list
      await get().fetchMembers();
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to remove member' };
    }
  },

  sendInvitation: async (email: string, invitedBy: string) => {
    const { team, members, invitations } = get();
    if (!team) return { error: 'No team found' };

    // Check seat limit
    const totalUsed = members.length + invitations.filter((i) => i.status === 'pending').length;
    if (totalUsed >= team.max_seats) {
      return { error: `Team is full (${team.max_seats} seats). Upgrade your plan to add more members.` };
    }

    // Check if already a member
    const existingMember = members.find((m) => m.email === email);
    if (existingMember) {
      return { error: 'This person is already on your team.' };
    }

    // Check if already invited
    const existingInvite = invitations.find((i) => i.email === email && i.status === 'pending');
    if (existingInvite) {
      return { error: 'An invitation is already pending for this email.' };
    }

    try {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('team_invitations')
        .insert({
          team_id: team.id,
          invited_by: invitedBy,
          email: email.toLowerCase().trim(),
        })
        .select('id')
        .single();

      if (error) throw error;

      // Trigger invitation email via Edge Function
      // (Also triggered by database webhook on INSERT, but calling directly
      //  ensures the email sends even if the webhook isn't configured yet.)
      try {
        await supabase.functions.invoke('send-invitation-email', {
          body: { invitation_id: data.id },
        });
      } catch (emailErr) {
        console.warn('[TeamStore] Email send failed (non-fatal):', emailErr);
      }

      await get().fetchInvitations();
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to send invitation' };
    }
  },

  cancelInvitation: async (invitationId: string) => {
    const { team } = get();
    if (!team) return { error: 'No team found' };

    try {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('team_invitations')
        .update({ status: 'expired' })
        .eq('id', invitationId)
        .eq('team_id', team.id);

      if (error) throw error;

      await get().fetchInvitations();
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to cancel invitation' };
    }
  },

  resendInvitation: async (invitationId: string) => {
    const { team } = get();
    if (!team) return { error: 'No team found' };

    try {
      const supabase = getSupabase();

      // Reset expiry to 7 days from now
      const newExpiry = new Date();
      newExpiry.setDate(newExpiry.getDate() + 7);

      const { error } = await supabase
        .from('team_invitations')
        .update({
          status: 'pending',
          expires_at: newExpiry.toISOString(),
        })
        .eq('id', invitationId)
        .eq('team_id', team.id);

      if (error) throw error;

      // Re-trigger invitation email
      try {
        await supabase.functions.invoke('send-invitation-email', {
          body: { invitation_id: invitationId },
        });
      } catch (emailErr) {
        console.warn('[TeamStore] Re-send email failed (non-fatal):', emailErr);
      }

      await get().fetchInvitations();
      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to resend invitation' };
    }
  },

  /**
   * Accept a team invitation using the token from the invite link.
   * Calls the accept_invitation RPC which handles all validation,
   * member creation, activity logging, and owner notification.
   */
  acceptInvitation: async (token: string) => {
    try {
      const supabase = getSupabase();

      const { data, error } = await supabase.rpc('accept_invitation', {
        p_token: token,
      });

      if (error) throw error;

      if (!data?.success) {
        const errorMessages: Record<string, string> = {
          not_authenticated: 'You must be logged in to accept an invitation.',
          invitation_not_found: 'This invitation link is invalid.',
          invitation_expired: 'This invitation has expired. Ask the team owner to resend it.',
          invitation_accepted: 'This invitation was already accepted.',
          email_mismatch: 'This invitation was sent to a different email address.',
          already_on_team: 'You\'re already on a team. Leave your current team first.',
        };
        return { error: errorMessages[data?.error] || data?.error || 'Failed to accept invitation' };
      }

      // Reload team data now that we're a member
      const { user } = await import('../stores/authStore').then(m => ({ user: m.useAuthStore.getState().user }));
      if (user?.id) {
        await get().fetchTeam(user.id);
      }

      return { error: null, teamId: data.team_id };
    } catch (err: any) {
      console.error('[TeamStore] acceptInvitation error:', err);
      return { error: err.message || 'Failed to accept invitation' };
    }
  },

  // ─── API Key Policy ───────────────────────────────────────

  /**
   * Switch API key policy between shared and individual.
   * When switching to 'shared', ownerKeys must be provided —
   * they get encrypted and stored in Supabase.
   * When switching to 'individual', encrypted keys are deleted.
   */
  setApiKeyPolicy: async (policy, ownerKeys) => {
    const { team } = get();
    if (!team) return { error: 'No team found' };

    try {
      const supabase = getSupabase();

      if (policy === 'shared' && ownerKeys) {
        // Encrypt the owner's keys
        const plaintext = JSON.stringify(ownerKeys);
        const encrypted = await encryptData(plaintext, team.id, team.owner_id);

        const { error } = await supabase
          .from('teams')
          .update({
            api_key_policy: 'shared',
            encrypted_api_keys: encrypted,
            shared_keys_updated_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', team.id);

        if (error) throw error;

        set({
          team: { ...team, api_key_policy: 'shared', encrypted_api_keys: encrypted },
          sharedKeys: ownerKeys,
        });
      } else {
        // Switching to individual — clear encrypted keys
        const { error } = await supabase
          .from('teams')
          .update({
            api_key_policy: 'individual',
            encrypted_api_keys: null,
            shared_keys_updated_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', team.id);

        if (error) throw error;

        set({
          team: { ...team, api_key_policy: 'individual', encrypted_api_keys: null },
          sharedKeys: null,
        });
      }

      return { error: null };
    } catch (err: any) {
      console.error('[TeamStore] setApiKeyPolicy error:', err);
      return { error: err.message || 'Failed to update API key policy' };
    }
  },

  /**
   * Fetch and decrypt shared API keys (for members in shared mode).
   * Returns decrypted provider configs or null.
   */
  fetchSharedKeys: async () => {
    const { team } = get();
    if (!team || !team.encrypted_api_keys || team.api_key_policy !== 'shared') {
      return null;
    }

    try {
      const decrypted = await decryptData(team.encrypted_api_keys, team.id, team.owner_id);
      const keys = JSON.parse(decrypted) as SharedProviderConfig[];
      set({ sharedKeys: keys });
      return keys;
    } catch (err: any) {
      console.error('[TeamStore] fetchSharedKeys decryption error:', err);
      set({ sharedKeys: null });
      return null;
    }
  },

  // ─── Project Locking ────────────────────────────────────────

  /**
   * Lock a project for the current user.
   * Called from aiService on first AI message in a project.
   * Uses UPSERT — safe to call even if already locked by this user.
   */
  lockProject: async (projectName: string) => {
    const { team } = get();
    if (!team) return { error: null }; // Solo user, no locking needed

    try {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('project_locks')
        .upsert(
          {
            team_id: team.id,
            project_name: projectName,
            locked_by: (await supabase.auth.getUser()).data.user?.id,
            locked_at: new Date().toISOString(),
            last_heartbeat: new Date().toISOString(),
          },
          { onConflict: 'team_id,project_name' }
        );

      if (error) {
        // If someone else holds the lock, the RLS policy will reject
        if (error.code === '42501' || error.message?.includes('policy')) {
          return { error: 'This project is currently locked by another team member.' };
        }
        throw error;
      }

      activeLockedProject = projectName;

      // Start heartbeat + idle timer
      get().startHeartbeat(projectName);
      get().startIdleTimer();

      // Refresh local locks state
      await get().fetchLocks();

      return { error: null };
    } catch (err: any) {
      console.error('[TeamStore] lockProject error:', err);
      return { error: err.message || 'Failed to lock project' };
    }
  },

  /**
   * Unlock a project. Called on:
   * - project switch (user opens different project)
   * - app close (beforeunload)
   * - idle timeout (15 min no activity)
   */
  unlockProject: async (projectName: string) => {
    const { team } = get();
    if (!team) return;

    try {
      const supabase = getSupabase();

      await supabase
        .from('project_locks')
        .delete()
        .eq('team_id', team.id)
        .eq('project_name', projectName);

      // Clean up heartbeat + idle timer
      if (activeLockedProject === projectName) {
        get().stopHeartbeat();
        get().stopIdleTimer();
        activeLockedProject = null;
      }

      // Refresh local state (the Realtime subscription will also catch this,
      // but updating immediately makes the UI feel snappier)
      set((state) => ({
        projectLocks: state.projectLocks.filter((l) => l.project_name !== projectName),
      }));
    } catch (err) {
      console.error('[TeamStore] unlockProject error:', err);
    }
  },

  /**
   * Unlock all projects locked by the current user.
   * Called on app close / logout as a safety net.
   */
  unlockAllMyLocks: async () => {
    const { team } = get();
    if (!team) return;

    try {
      const supabase = getSupabase();
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) return;

      await supabase
        .from('project_locks')
        .delete()
        .eq('team_id', team.id)
        .eq('locked_by', userId);

      get().stopHeartbeat();
      get().stopIdleTimer();
      activeLockedProject = null;

      set({ projectLocks: [] });
    } catch (err) {
      console.error('[TeamStore] unlockAllMyLocks error:', err);
    }
  },

  /**
   * Force-unlock any project (owner only).
   * RLS policy "Lock holder or owner releases lock" allows this.
   */
  forceUnlock: async (projectName: string) => {
    const { team, isOwner } = get();
    if (!team) return { error: 'No team found' };
    if (!isOwner) return { error: 'Only the team owner can force-unlock projects.' };

    try {
      const supabase = getSupabase();

      const { error } = await supabase
        .from('project_locks')
        .delete()
        .eq('team_id', team.id)
        .eq('project_name', projectName);

      if (error) throw error;

      // Update local state immediately
      set((state) => ({
        projectLocks: state.projectLocks.filter((l) => l.project_name !== projectName),
      }));

      return { error: null };
    } catch (err: any) {
      return { error: err.message || 'Failed to force-unlock project' };
    }
  },

  /**
   * Fetch all current locks for the team, joined with profile names.
   */
  fetchLocks: async () => {
    const { team } = get();
    if (!team) return;

    try {
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from('project_locks')
        .select(`
          id,
          team_id,
          project_name,
          locked_by,
          locked_at,
          last_heartbeat,
          profiles:locked_by (
            display_name,
            email
          )
        `)
        .eq('team_id', team.id);

      if (error) throw error;

      const locks: ProjectLock[] = (data || []).map((l: any) => ({
        id: l.id,
        team_id: l.team_id,
        project_name: l.project_name,
        locked_by: l.locked_by,
        locked_at: l.locked_at,
        last_heartbeat: l.last_heartbeat,
        locked_by_name: l.profiles?.display_name || l.profiles?.email || 'A teammate',
      }));

      set({ projectLocks: locks });
    } catch (err) {
      console.error('[TeamStore] fetchLocks error:', err);
    }
  },

  /**
   * Subscribe to Supabase Realtime for lock changes.
   * Listens for INSERT (new lock) and DELETE (unlock) on project_locks.
   * Updates local state so sidebar reflects who's working where.
   */
  subscribeToLocks: () => {
    const { team } = get();
    if (!team) return;

    // Clean up existing subscription
    get().unsubscribeFromLocks();

    const channel = getSupabase()
      .channel(`locks:${team.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',  // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'project_locks',
          filter: `team_id=eq.${team.id}`,
        },
        () => {
          // Refetch all locks on any change.
          // This is simpler than parsing individual events and
          // handles edge cases (stale lock cleanup, force-unlock).
          get().fetchLocks();
        }
      )
      .subscribe();

    locksChannel = channel;
  },

  /**
   * Unsubscribe from lock Realtime channel.
   */
  unsubscribeFromLocks: () => {
    if (locksChannel) {
      getSupabase().removeChannel(locksChannel);
      locksChannel = null;
    }
  },

  /**
   * Start the 60-second heartbeat ping for the active lock.
   */
  startHeartbeat: (projectName: string) => {
    get().stopHeartbeat(); // Clear any existing

    heartbeatInterval = setInterval(async () => {
      const { team } = get();
      if (!team) return;

      try {
        await getSupabase()
          .from('project_locks')
          .update({ last_heartbeat: new Date().toISOString() })
          .eq('team_id', team.id)
          .eq('project_name', projectName);
      } catch (err) {
        console.error('[TeamStore] Heartbeat failed:', err);
      }
    }, HEARTBEAT_MS);
  },

  /**
   * Stop the heartbeat interval.
   */
  stopHeartbeat: () => {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  },

  /**
   * Record user activity (keypress, mouse move, AI message).
   * Called from global event listeners.
   */
  trackActivity: () => {
    lastActivityTimestamp = Date.now();
  },

  /**
   * Start the idle check timer.
   * Every 60 seconds, checks if the user has been idle for 15+ min.
   * If so, auto-unlocks the active project.
   */
  startIdleTimer: () => {
    get().stopIdleTimer(); // Clear any existing
    lastActivityTimestamp = Date.now();

    idleCheckInterval = setInterval(() => {
      if (!activeLockedProject) return;

      const idleMs = Date.now() - lastActivityTimestamp;
      if (idleMs >= IDLE_TIMEOUT_MS) {
        console.log(`[TeamStore] Idle for ${Math.round(idleMs / 60000)}m — auto-unlocking ${activeLockedProject}`);
        get().unlockProject(activeLockedProject);
      }
    }, IDLE_CHECK_MS);
  },

  /**
   * Stop the idle check timer.
   */
  stopIdleTimer: () => {
    if (idleCheckInterval) {
      clearInterval(idleCheckInterval);
      idleCheckInterval = null;
    }
  },

  /**
   * Get the display name of who locked a project.
   * Returns null if the project is not locked.
   */
  getLockedByName: (projectName: string) => {
    const lock = get().projectLocks.find((l) => l.project_name === projectName);
    return lock?.locked_by_name || null;
  },

  /**
   * Check if a project is currently locked by anyone.
   */
  isProjectLocked: (projectName: string) => {
    return get().projectLocks.some((l) => l.project_name === projectName);
  },

  /**
   * Check if a project is locked by a specific user.
   */
  isProjectLockedByMe: (projectName: string, userId: string) => {
    return get().projectLocks.some(
      (l) => l.project_name === projectName && l.locked_by === userId
    );
  },

  // ─── Utility ──────────────────────────────────────────────

  clearTeam: () => {
    // Clean up all intervals and subscriptions
    get().stopHeartbeat();
    get().stopIdleTimer();
    get().unsubscribeFromLocks();
    activeLockedProject = null;

    set({
      team: null,
      members: [],
      invitations: [],
      activityLog: [],
      sharedKeys: null,
      projectLocks: [],
      isLoading: false,
      error: null,
      isOwner: false,
      hasTeam: false,
    });
  },
}));