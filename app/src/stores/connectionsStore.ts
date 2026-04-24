// ============================================================
// Connections Store - Zustand state management
// ============================================================
// Global connections: one credential per provider (GitHub, Stripe, etc.)
// Project connections: one credential per project per provider (Supabase, etc.)

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
  // ── Global connections (one per provider) ──
  connections: Partial<Record<ConnectionProvider, Connection>>;

  setConnecting: (provider: ConnectionProvider) => void;
  setConnected: (provider: ConnectionProvider, token: string, accountInfo: AccountInfo) => void;
  setError: (provider: ConnectionProvider, error: string) => void;
  disconnect: (provider: ConnectionProvider) => void;
  updateAccountInfo: (provider: ConnectionProvider, info: AccountInfo) => void;

  getConnection: (provider: ConnectionProvider) => Connection | undefined;
  getStatus: (provider: ConnectionProvider) => ConnectionStatus;
  isConnected: (provider: ConnectionProvider) => boolean;
  getConnectedProviders: () => ConnectionProvider[];
  getToken: (provider: ConnectionProvider) => string | undefined;

  loadFromDB: () => Promise<void>;

  // ── Project-scoped connections (one per project+provider pair) ──
  // Shape: { [projectId]: { [provider]: Connection } }
  projectConnections: Record<string, Partial<Record<ConnectionProvider, Connection>>>;

  setProjectConnecting: (projectId: string, provider: ConnectionProvider) => void;
  setProjectConnected: (projectId: string, provider: ConnectionProvider, token: string, accountInfo: AccountInfo) => void;
  setProjectError: (projectId: string, provider: ConnectionProvider, error: string) => void;
  disconnectProject: (projectId: string, provider: ConnectionProvider) => void;

  getProjectConnection: (projectId: string, provider: ConnectionProvider) => Connection | undefined;
  getProjectStatus: (projectId: string, provider: ConnectionProvider) => ConnectionStatus;
  isProjectConnected: (projectId: string, provider: ConnectionProvider) => boolean;
  getProjectToken: (projectId: string, provider: ConnectionProvider) => string | undefined;

  loadProjectConnectionsFromDB: (projectId: string) => Promise<void>;
}

// --------------- Store ---------------

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: {},
  projectConnections: {},

  // ════════════════════════════════════════
  // GLOBAL CONNECTIONS
  // ════════════════════════════════════════

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
      dbService.updateConnectionStatus(provider, 'error', error)
        .catch((e) => console.warn('Failed to update connection status in DB:', e));
      return { connections: updated };
    });
  },

  disconnect: (provider) => {
    set((state) => {
      const updated = { ...state.connections };
      delete updated[provider];
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

  loadFromDB: async () => {
    try {
      const rows = await dbService.getConnections();
      const connections: Partial<Record<ConnectionProvider, Connection>> = {};
      for (const [provider, conn] of Object.entries(rows)) {
        const c = conn as any;
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

  // ════════════════════════════════════════
  // PROJECT-SCOPED CONNECTIONS
  // ════════════════════════════════════════

  setProjectConnecting: (projectId, provider) => {
    set((state) => {
      const projectSlice = state.projectConnections[projectId] || {};
      const updated = {
        ...state.projectConnections,
        [projectId]: {
          ...projectSlice,
          [provider]: {
            ...projectSlice[provider],
            provider,
            status: 'connecting' as ConnectionStatus,
            error: undefined,
          },
        },
      };
      const conn = updated[projectId][provider]!;
      dbService.saveProjectConnection({
        projectId,
        provider,
        token: conn.token || '',
        tokenLabel: conn.tokenLabel || null,
        status: 'connecting',
        accountInfo: conn.accountInfo || null,
        connectedAt: conn.connectedAt || null,
        lastTestedAt: conn.lastTestedAt || null,
        error: null,
      }).catch((e) => console.warn('Failed to save project connection to DB:', e));
      return { projectConnections: updated };
    });
  },

  setProjectConnected: (projectId, provider, token, accountInfo) => {
    set((state) => {
      const now = Date.now();
      const projectSlice = state.projectConnections[projectId] || {};
      const updated = {
        ...state.projectConnections,
        [projectId]: {
          ...projectSlice,
          [provider]: {
            provider,
            status: 'connected' as ConnectionStatus,
            token,
            tokenLabel: maskToken(token),
            accountInfo,
            connectedAt: projectSlice[provider]?.connectedAt || now,
            lastTestedAt: now,
            error: undefined,
          },
        },
      };
      dbService.saveProjectConnection({
        projectId,
        provider,
        token,
        tokenLabel: maskToken(token),
        status: 'connected',
        accountInfo,
        connectedAt: projectSlice[provider]?.connectedAt || now,
        lastTestedAt: now,
        error: null,
      }).catch((e) => console.warn('Failed to save project connection to DB:', e));
      return { projectConnections: updated };
    });
  },

  setProjectError: (projectId, provider, error) => {
    set((state) => {
      const projectSlice = state.projectConnections[projectId] || {};
      const updated = {
        ...state.projectConnections,
        [projectId]: {
          ...projectSlice,
          [provider]: {
            ...projectSlice[provider],
            provider,
            status: 'error' as ConnectionStatus,
            error,
          },
        },
      };
      dbService.updateProjectConnectionStatus(projectId, provider, 'error', error)
        .catch((e) => console.warn('Failed to update project connection status in DB:', e));
      return { projectConnections: updated };
    });
  },

  disconnectProject: (projectId, provider) => {
    set((state) => {
      const projectSlice = { ...(state.projectConnections[projectId] || {}) };
      delete projectSlice[provider];
      const updated = {
        ...state.projectConnections,
        [projectId]: projectSlice,
      };
      dbService.deleteProjectConnection(projectId, provider)
        .catch((e) => console.warn('Failed to delete project connection from DB:', e));
      return { projectConnections: updated };
    });
  },

  getProjectConnection: (projectId, provider) =>
    get().projectConnections[projectId]?.[provider],

  getProjectStatus: (projectId, provider) =>
    get().projectConnections[projectId]?.[provider]?.status || 'disconnected',

  isProjectConnected: (projectId, provider) =>
    get().projectConnections[projectId]?.[provider]?.status === 'connected',

  getProjectToken: (projectId, provider) => {
    const conn = get().projectConnections[projectId]?.[provider];
    return conn?.status === 'connected' ? conn.token : undefined;
  },

  loadProjectConnectionsFromDB: async (projectId) => {
    try {
      const rows = await dbService.getProjectConnections(projectId);
      const projectSlice: Partial<Record<ConnectionProvider, Connection>> = {};
      for (const [provider, conn] of Object.entries(rows)) {
        const c = conn as any;
        projectSlice[provider as ConnectionProvider] = {
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
      set((state) => ({
        projectConnections: {
          ...state.projectConnections,
          [projectId]: projectSlice,
        },
      }));
    } catch (e) {
      console.error('Failed to load project connections from DB:', e);
    }
  },
}));