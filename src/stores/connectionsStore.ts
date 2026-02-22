// ============================================================
// Connections Store - Zustand state management
// ============================================================
// Manages connection state for all providers.
// Tokens stored in SQLite (upgrade to OS keychain in Phase 2).

import { create } from 'zustand';
import type { Connection, ConnectionProvider, ConnectionStatus, AccountInfo } from '../services/connections/types';
import { PROVIDERS } from '../services/connections/types';
import { dbService } from '../services/dbService';

// --------------- Helpers ---------------

function maskToken(token: string): string {
  if (token.length <= 8) return '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
  return token.slice(0, 4) + '\u2022\u2022\u2022\u2022' + token.slice(-4);
}

// --------------- Store Interface ---------------

interface ConnectionsState {
  connections: Partial<Record<ConnectionProvider, Connection>>;

  // Actions
  setConnecting: (provider: ConnectionProvider) => void;
  setConnected: (provider: ConnectionProvider, token: string, accountInfo: AccountInfo) => void;
  setError: (provider: ConnectionProvider, error: string) => void;
  disconnect: (provider: ConnectionProvider) => void;
  updateAccountInfo: (provider: ConnectionProvider, info: AccountInfo) => void;

  // Queries
  getConnection: (provider: ConnectionProvider) => Connection | undefined;
  getStatus: (provider: ConnectionProvider) => ConnectionStatus;
  isConnected: (provider: ConnectionProvider) => boolean;
  getConnectedProviders: () => ConnectionProvider[];
  getToken: (provider: ConnectionProvider) => string | undefined;

  // New: load from SQLite on startup
  loadFromDB: () => Promise<void>;
}

// --------------- Store ---------------

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: {},

  setConnecting: (provider) => {
    set((state) => {
      const updated = {
        ...state.connections,
        [provider]: {
          ...state.connections[provider],
          provider,
          status: 'connecting' as ConnectionStatus,
          error: undefined,
        },
      };
      // Persist to SQLite (fire-and-forget)
      const conn = updated[provider]!;
      dbService.saveConnection({
        provider,
        token: conn.token || '',
        tokenLabel: conn.tokenLabel || null,
        status: 'connecting',
        accountInfo: conn.accountInfo || null,
        connectedAt: conn.connectedAt || null,
        lastTestedAt: conn.lastTestedAt || null,
        error: null,
      }).catch((e) => console.warn('Failed to save connection to DB:', e));
      return { connections: updated };
    });
  },

  setConnected: (provider, token, accountInfo) => {
    set((state) => {
      const now = Date.now();
      const updated = {
        ...state.connections,
        [provider]: {
          provider,
          status: 'connected' as ConnectionStatus,
          token,
          tokenLabel: maskToken(token),
          accountInfo,
          connectedAt: state.connections[provider]?.connectedAt || now,
          lastTestedAt: now,
          error: undefined,
        },
      };
      // Persist to SQLite (fire-and-forget)
      dbService.saveConnection({
        provider,
        token,
        tokenLabel: maskToken(token),
        status: 'connected',
        accountInfo,
        connectedAt: state.connections[provider]?.connectedAt || now,
        lastTestedAt: now,
        error: null,
      }).catch((e) => console.warn('Failed to save connection to DB:', e));
      return { connections: updated };
    });
  },

  setError: (provider, error) => {
    set((state) => {
      const updated = {
        ...state.connections,
        [provider]: {
          ...state.connections[provider],
          provider,
          status: 'error' as ConnectionStatus,
          error,
        },
      };
      // Persist to SQLite (fire-and-forget)
      dbService.updateConnectionStatus(provider, 'error', error)
        .catch((e) => console.warn('Failed to update connection status in DB:', e));
      return { connections: updated };
    });
  },

  disconnect: (provider) => {
    set((state) => {
      const updated = { ...state.connections };
      delete updated[provider];
      // Delete from SQLite (fire-and-forget)
      dbService.deleteConnection(provider)
        .catch((e) => console.warn('Failed to delete connection from DB:', e));
      return { connections: updated };
    });
  },

  updateAccountInfo: (provider, info) => {
    set((state) => {
      const existing = state.connections[provider];
      if (!existing) return state;
      const updated = {
        ...state.connections,
        [provider]: {
          ...existing,
          accountInfo: { ...existing.accountInfo, ...info },
        },
      };
      // Persist to SQLite (fire-and-forget)
      const conn = updated[provider]!;
      dbService.saveConnection({
        provider,
        token: conn.token || '',
        tokenLabel: conn.tokenLabel || null,
        status: conn.status || 'disconnected',
        accountInfo: conn.accountInfo || null,
        connectedAt: conn.connectedAt || null,
        lastTestedAt: conn.lastTestedAt || null,
        error: conn.error || null,
      }).catch((e) => console.warn('Failed to save connection to DB:', e));
      return { connections: updated };
    });
  },

  // Queries
  getConnection: (provider) => get().connections[provider],

  getStatus: (provider) => get().connections[provider]?.status || 'disconnected',

  isConnected: (provider) => get().connections[provider]?.status === 'connected',

  getConnectedProviders: () => {
    const conns = get().connections;
    return Object.keys(conns).filter(
      (k) => conns[k as ConnectionProvider]?.status === 'connected'
    ) as ConnectionProvider[];
  },

  getToken: (provider) => {
    const conn = get().connections[provider];
    return conn?.status === 'connected' ? conn.token : undefined;
  },

  // Load connections from SQLite on app startup
  loadFromDB: async () => {
    try {
      const rows = await dbService.getConnections();
      const connections: Partial<Record<ConnectionProvider, Connection>> = {};
      for (const [provider, conn] of Object.entries(rows)) {
        const c = conn as any;
        // Reset 'connecting' status to 'disconnected' on app start
        connections[provider as ConnectionProvider] = {
          provider: provider as ConnectionProvider,
          status: c.status === 'connecting' ? 'disconnected' : c.status,
          token: c.token,
          tokenLabel: c.tokenLabel,
          accountInfo: c.accountInfo,
          connectedAt: c.connectedAt,
          lastTestedAt: c.lastTestedAt,
          error: c.error,
        };
      }
      set({ connections });
    } catch (e) {
      console.error('Failed to load connections from DB:', e);
    }
  },
}));