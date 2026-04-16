// ============================================================
// deployStore.ts — Global deploy state
// ============================================================
// Shared between: topbar Deploy button, DeployModal, DeployPage.
// Any component can trigger a deploy; all of them see the same
// progress events.
// ============================================================

import { create } from 'zustand';
import { deployProject, type DeployProgress } from '../services/deploymentService';
import type { ConnectionProvider } from '../services/connections/types';

export type DeployStage =
  | 'idle'
  | 'starting'
  | 'reading_files'
  | 'uploading'
  | 'building'
  | 'live'
  | 'failed';

interface DeployState {
  // State
  open: boolean;            // is the deploy modal visible?
  stage: DeployStage;
  message: string;
  percent: number;
  url: string | null;
  /** Provider's inspector/dashboard URL for this deployment, if returned. */
  dashboardUrl: string | null;
  error: string | null;
  provider: ConnectionProvider | null;

  // Actions
  startDeploy: (opts: {
    projectId: string;
    projectPath: string;
    projectName: string;
    provider?: ConnectionProvider;
    cloudflareAccountId?: string;
  }) => Promise<void>;

  /** Close the modal and reset to idle (only allowed once deploy finished or failed). */
  close: () => void;

  /** Force-open the modal (used by the topbar button before a deploy starts). */
  openModal: () => void;
}

export const useDeployStore = create<DeployState>((set, get) => ({
  open: false,
  stage: 'idle',
  message: '',
  percent: 0,
  url: null,
  dashboardUrl: null,
  error: null,
  provider: null,

  openModal: () => set({ open: true }),

  close: () => {
    const { stage } = get();
    // Don't allow closing mid-deploy — avoids accidental dismissal.
    if (stage === 'live' || stage === 'failed' || stage === 'idle') {
      set({
        open: false,
        stage: 'idle',
        message: '',
        percent: 0,
        url: null,
        dashboardUrl: null,
        error: null,
        provider: null,
      });
    }
  },

  startDeploy: async (opts) => {
    set({
      open: true,
      stage: 'starting',
      message: 'Starting…',
      percent: 0,
      url: null,
      dashboardUrl: null,
      error: null,
      provider: opts.provider ?? null,
    });

    try {
      await deployProject({
        ...opts,
        onProgress: (ev: DeployProgress) => {
          // Vercel returns inspectorUrl (sometimes `inspect`) on the
          // deployment; Netlify returns admin_url; CF Pages doesn't
          // provide one directly, so we leave null and let UI build it.
          const dep: any = ev.deployment || {};
          const ddashboard =
            dep.inspectorUrl ||
            dep.inspect ||
            dep.admin_url ||
            null;

          set({
            stage: ev.stage,
            message: ev.message,
            percent: ev.percent ?? get().percent,
            url: ev.url ?? get().url,
            dashboardUrl: ddashboard ?? get().dashboardUrl,
            error: ev.error ?? null,
          });
        },
      });
    } catch (err: any) {
      const message = err?.message || 'Deploy failed';
      set({ stage: 'failed', error: message, message });
    }
  },
}));