// ============================================================
// Notification Store
// ============================================================
// Manages in-app notifications from watching agents (Discord,
// Slack, Gmail, GitHub, etc.) that surface in the Topbar dropdown
// and the Assistant section.
//
// Source of truth: Supabase assistant_notifications table
// Local cache: SQLite notifications_cache (via dbService)
// Realtime: Supabase Realtime subscription for new inserts
//
// Both desktop and mobile apps subscribe to the same Supabase
// table, so marking as read on one device syncs to the other.

import { create } from 'zustand';
import { dbService } from '../services/dbService';
import { getSupabase } from '../services/supabaseClient';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────

export interface AppNotification {
  id: string;
  userId: string;
  source: string;           // 'discord', 'slack', 'gmail', 'github', etc.
  title: string;            // short summary shown in dropdown
  body: string | null;      // longer detail shown in Assistant chat
  sourceMeta: Record<string, any>; // flexible: channel name, sender, thread id, etc.
  isRead: boolean;
  createdAt: string;        // ISO string
}

// ─── Store shape ─────────────────────────────────────────────

interface NotificationState {
  notifications: AppNotification[];
  loading: boolean;
  error: string | null;

  // Derived (convenience)
  unreadCount: number;

  // Actions
  loadNotifications: (userId: string) => Promise<void>;
  syncFromSupabase: (userId: string) => Promise<void>;
  subscribeRealtime: (userId: string) => void;
  unsubscribeRealtime: () => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: (userId: string) => Promise<void>;
  clearAll: (userId: string) => Promise<void>;
}

// ─── Realtime channel ref ────────────────────────────────────

let realtimeChannel: RealtimeChannel | null = null;

// ─── Helper: Supabase row → AppNotification ──────────────────

function rowToNotification(row: any): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    source: row.source,
    title: row.title,
    body: row.body ?? null,
    sourceMeta: row.source_meta ?? {},
    isRead: row.is_read ?? false,
    createdAt: row.created_at,
  };
}

// ─── Store ────────────────────────────────────────────────────

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  loading: false,
  error: null,
  unreadCount: 0,

  // ── Load from local SQLite cache (fast, no network) ────────
  loadNotifications: async (userId: string) => {
    set({ loading: true, error: null });
    try {
      const cached = await dbService.getUnreadNotifications(userId);
      set({
        notifications: cached,
        unreadCount: cached.filter((n) => !n.isRead).length,
        loading: false,
      });
    } catch (err: any) {
      console.error('[NotificationStore] Failed to load from cache:', err);
      set({ error: 'Failed to load notifications', loading: false });
    }
  },

  // ── Sync from Supabase → SQLite cache ──────────────────────
  // Fetches unread notifications from the server and rebuilds cache.
  syncFromSupabase: async (userId: string) => {
    try {
      const { data, error } = await getSupabase()
        .from('assistant_notifications')
        .select('*')
        .eq('user_id', userId)
        .eq('is_read', false)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      if (!data) return;

      const notifications: AppNotification[] = data.map(rowToNotification);

      // Rebuild local cache
      await dbService.clearNotificationsForUser(userId);
      for (const n of notifications) {
        await dbService.cacheNotification(n);
      }

      set({
        notifications,
        unreadCount: notifications.length,
      });
    } catch (err: any) {
      // Non-fatal — user still sees cached data
      console.error('[NotificationStore] Supabase sync failed:', err);
    }
  },

  // ── Subscribe to Supabase Realtime for new notifications ───
  // Listens for INSERT events on assistant_notifications for this user.
  // When a watching agent creates a new notification, it appears instantly.
  subscribeRealtime: (userId: string) => {
    // Clean up any existing subscription
    get().unsubscribeRealtime();

    const channel = getSupabase()
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'assistant_notifications',
          filter: `user_id=eq.${userId}`,
        },
        async (payload) => {
          const newNotification = rowToNotification(payload.new);

          // Cache locally
          try {
            await dbService.cacheNotification(newNotification);
          } catch (err) {
            console.error('[NotificationStore] Failed to cache new notification:', err);
          }

          // Add to in-memory state (newest first)
          set((state) => {
            const updated = [newNotification, ...state.notifications];
            return {
              notifications: updated,
              unreadCount: updated.filter((n) => !n.isRead).length,
            };
          });
        }
      )
      .subscribe();

    realtimeChannel = channel;
  },

  // ── Unsubscribe from Realtime ──────────────────────────────
  unsubscribeRealtime: () => {
    if (realtimeChannel) {
      getSupabase().removeChannel(realtimeChannel);
      realtimeChannel = null;
    }
  },

  // ── Mark a single notification as read ─────────────────────
  // Updates Supabase (source of truth) + removes from local cache + state.
  markAsRead: async (id: string) => {
    try {
      // Update Supabase
      await getSupabase()
        .from('assistant_notifications')
        .update({ is_read: true })
        .eq('id', id);

      // Remove from local cache
      await dbService.deleteNotification(id);

      // Update in-memory state
      set((state) => {
        const updated = state.notifications.filter((n) => n.id !== id);
        return {
          notifications: updated,
          unreadCount: updated.filter((n) => !n.isRead).length,
        };
      });
    } catch (err: any) {
      console.error('[NotificationStore] Failed to mark as read:', err);
    }
  },

  // ── Mark all as read ───────────────────────────────────────
  markAllAsRead: async (userId: string) => {
    try {
      // Update all unread in Supabase
      await getSupabase()
        .from('assistant_notifications')
        .update({ is_read: true })
        .eq('user_id', userId)
        .eq('is_read', false);

      // Clear local cache
      await dbService.clearNotificationsForUser(userId);

      set({ notifications: [], unreadCount: 0 });
    } catch (err: any) {
      console.error('[NotificationStore] Failed to mark all as read:', err);
    }
  },

  // ── Clear everything (used on logout) ──────────────────────
  clearAll: async (userId: string) => {
    get().unsubscribeRealtime();
    await dbService.clearNotificationsForUser(userId);
    set({ notifications: [], unreadCount: 0, loading: false, error: null });
  },
}));

// ─── Selectors ────────────────────────────────────────────────

/** Get the N most recent unread notifications (for the Topbar dropdown) */
export function selectTopNotifications(
  notifications: AppNotification[],
  limit: number = 3
): AppNotification[] {
  return notifications
    .filter((n) => !n.isRead)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

/** Get the source display label */
export function getSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    discord: 'Discord',
    slack: 'Slack',
    gmail: 'Gmail',
    outlook: 'Outlook',
    github: 'GitHub',
    google_calendar: 'Calendar',
    outlook_calendar: 'Calendar',
    website_watcher: 'Website',
    notion: 'Notion',
    todoist: 'Todoist',
    team: 'Team',
  };
  return labels[source] ?? source;
}