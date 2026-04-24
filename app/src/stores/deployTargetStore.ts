// ============================================================
// deployTargetStore.ts — Remembers deploy target per OmniRun project
// ============================================================
// Each OmniRun project has ONE deploy target remembered here:
// which provider (vercel/netlify/cloudflare), which remote project
// on that provider, and optionally a custom domain.
//
// The first deploy sets it (via DeployTargetPicker). Subsequent
// deploys use the saved target silently. User can change it anytime
// from the gear icon in the preview toolbar or the DeployPage.
//
// Persisted to localStorage (not SQLite) — it's small, user-scoped,
// and survives reloads without needing a DB migration.
// ============================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ConnectionProvider } from '../services/connections/types';

export interface DeployTarget {
  provider: ConnectionProvider;
  /** Remote project ID on the provider (Vercel project ID, Netlify site ID, CF project name). */
  remoteProjectId: string;
  /** Human-readable project name on the provider. */
  remoteProjectName: string;
  /** Custom domain if one is attached to the remote project. */
  domain?: string;
  /** For Cloudflare Pages — required for all API calls. */
  cloudflareAccountId?: string;
  /** When this target was first set (ms since epoch). */
  createdAt: number;
  /** Last successful deploy timestamp (ms since epoch). */
  lastDeployedAt?: number;
}

interface DeployTargetState {
  /** Targets keyed by OmniRun project ID. */
  targets: Record<string, DeployTarget>;

  /** Get the saved target for a project, or null. */
  getTarget: (projectId: string) => DeployTarget | null;

  /** Save or replace the target for a project. */
  setTarget: (projectId: string, target: DeployTarget) => void;

  /** Remove the saved target (user wants to pick again from scratch). */
  clearTarget: (projectId: string) => void;

  /** Mark the target as deployed now. */
  markDeployed: (projectId: string) => void;

  /** Update just the domain field after attaching one post-creation. */
  setDomain: (projectId: string, domain: string | undefined) => void;
}

export const useDeployTargetStore = create<DeployTargetState>()(
  persist(
    (set, get) => ({
      targets: {},

      getTarget: (projectId) => get().targets[projectId] || null,

      setTarget: (projectId, target) => {
        set((state) => ({
          targets: {
            ...state.targets,
            [projectId]: target,
          },
        }));
      },

      clearTarget: (projectId) => {
        set((state) => {
          const next = { ...state.targets };
          delete next[projectId];
          return { targets: next };
        });
      },

      markDeployed: (projectId) => {
        set((state) => {
          const existing = state.targets[projectId];
          if (!existing) return state;
          return {
            targets: {
              ...state.targets,
              [projectId]: { ...existing, lastDeployedAt: Date.now() },
            },
          };
        });
      },

      setDomain: (projectId, domain) => {
        set((state) => {
          const existing = state.targets[projectId];
          if (!existing) return state;
          return {
            targets: {
              ...state.targets,
              [projectId]: { ...existing, domain },
            },
          };
        });
      },
    }),
    {
      name: 'omnirun-deploy-targets',
      storage: createJSONStorage(() => localStorage),
      version: 1,
    }
  )
);