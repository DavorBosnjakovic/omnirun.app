// ============================================================
// Deployment Service — Provider dispatcher
// ============================================================
// One entry point for all deploys. Routes to the right provider's
// deploy_folder action and emits progress events for the UI.
//
// Usage from UI or tools:
//   const result = await deployProject({
//     projectId: 'abc',
//     projectPath: '/path/to/project',
//     projectName: 'my-bakery',
//     provider: 'vercel',             // optional — auto-picked if omitted
//     onProgress: (ev) => console.log(ev),
//   });
// ============================================================

import { executeProjectProviderAction } from './connections/connectionManager';
import { useConnectionsStore } from '../stores/connectionsStore';
import { useDeployTargetStore } from '../stores/deployTargetStore';
import type { ConnectionProvider } from './connections/types';

// Providers that support deploy_folder.
// Add new ones here as they get implemented.
const DEPLOY_PROVIDERS: ConnectionProvider[] = ['vercel', 'netlify', 'cloudflare'];

export type DeployStage =
  | 'starting'
  | 'reading_files'
  | 'uploading'
  | 'building'
  | 'live'
  | 'failed';

export interface DeployProgress {
  stage: DeployStage;
  message: string;
  /** 0–100, best-effort. Some stages don't report granular progress. */
  percent?: number;
  /** Populated on 'live' stage. */
  url?: string;
  /** Populated on 'failed' stage. */
  error?: string;
  /** Provider-specific deployment object (final result). */
  deployment?: any;
}

export interface DeployOptions {
  projectId: string;
  projectPath: string;
  projectName: string;
  /** If omitted, picks the first connected deploy provider. */
  provider?: ConnectionProvider;
  /** Cloudflare Pages requires this; Vercel/Netlify don't. */
  cloudflareAccountId?: string;
  /** Progress callback for the UI. */
  onProgress?: (ev: DeployProgress) => void;
}

export interface DeployResult {
  provider: ConnectionProvider;
  url: string;
  deployment: any;
}

// --------------- Public API ---------------

/**
 * Deploy a project to the specified (or auto-picked) provider.
 * Throws on failure; the onProgress callback receives a 'failed' event first.
 */
export async function deployProject(opts: DeployOptions): Promise<DeployResult> {
  const { projectId, projectPath, projectName, onProgress } = opts;
  const emit = (ev: DeployProgress) => onProgress?.(ev);
  const targetStore = useDeployTargetStore.getState();
  const savedTarget = targetStore.getTarget(projectId);

  try {
    // 1. Pick provider — saved target wins, then explicit opt, then auto-pick.
    const provider =
      savedTarget?.provider ?? opts.provider ?? pickDefaultProvider(projectId);
    if (!provider) {
      throw new Error(
        'No deploy provider connected. Connect Vercel, Netlify, or Cloudflare in Settings > Project Connections.'
      );
    }
    if (!DEPLOY_PROVIDERS.includes(provider)) {
      throw new Error(`Provider "${provider}" does not support direct deploy.`);
    }

    emit({ stage: 'starting', message: `Deploying to ${provider}…`, percent: 0 });

    // 2. Reading files is done inside the connection's deploy_folder
    //    (via the Tauri command). We emit the stage event for UX only.
    emit({ stage: 'reading_files', message: 'Reading project files…', percent: 10 });

    // 3. Build provider-specific params, folding in the saved target.
    const params = buildDeployParams(provider, opts, savedTarget);

    // 4. Call deploy_folder. This does: read → upload → deploy.
    emit({ stage: 'uploading', message: 'Uploading files…', percent: 30 });

    // Install a global progress callback the connection's deploy_folder calls
    // on every file upload. Lets us show "12 / 47 files" in the modal.
    (globalThis as any).__omnirunUploadProgress = (done: number, total: number) => {
      // Map upload progress into the 30-70% range of overall percent.
      const uploadPercent = total > 0 ? 30 + Math.round((done / total) * 40) : 30;
      emit({
        stage: 'uploading',
        message: `Uploading ${done} / ${total} files…`,
        percent: uploadPercent,
      });
    };

    let deployment: any;
    try {
      deployment = await executeProjectProviderAction(
        projectId,
        provider,
        'deploy_folder',
        params
      );
    } finally {
      (globalThis as any).__omnirunUploadProgress = undefined;
    }

    // 5. Build is provider-side. For Vercel we could poll get_deployment, but
    //    most deploys go READY within a few seconds for static sites, and the
    //    deploy_folder call already returns after submission. We report
    //    'building' once and then 'live' with the URL.
    emit({ stage: 'building', message: 'Building on the server…', percent: 70 });

    // 6. Extract URL — prefer custom domain from saved target or from
    //    deployment response; fall back to provider's auto-generated URL.
    const url = extractDeployUrl(provider, deployment, savedTarget);
    if (!url) {
      throw new Error('Deploy succeeded but no URL was returned by the provider.');
    }

    // 7. Record successful deploy for the target (and pick up a new domain
    //    if the deployment response exposed one we hadn't seen before).
    if (savedTarget) {
      targetStore.markDeployed(projectId);
      if (deployment?.customDomain && deployment.customDomain !== savedTarget.domain) {
        targetStore.setDomain(projectId, deployment.customDomain);
      }
    }

    emit({
      stage: 'live',
      message: 'Your site is live!',
      percent: 100,
      url,
      deployment,
    });

    return { provider, url, deployment };
  } catch (err: any) {
    const message = err?.message || 'Deploy failed';
    emit({ stage: 'failed', message, error: message });
    throw err;
  }
}

/**
 * Return the first deploy-capable provider that is connected for this project,
 * or null if none.
 */
export function pickDefaultProvider(projectId: string): ConnectionProvider | null {
  const store = useConnectionsStore.getState();
  const projectConns = store.projectConnections[projectId] || {};
  for (const p of DEPLOY_PROVIDERS) {
    if (projectConns[p]?.status === 'connected') {
      return p;
    }
  }
  return null;
}

/**
 * List every deploy provider currently connected for this project.
 * Useful for showing a chooser in the UI when more than one is connected.
 */
export function listConnectedDeployProviders(projectId: string): ConnectionProvider[] {
  const store = useConnectionsStore.getState();
  const projectConns = store.projectConnections[projectId] || {};
  return DEPLOY_PROVIDERS.filter((p) => projectConns[p]?.status === 'connected');
}

// --------------- Internals ---------------

function buildDeployParams(
  provider: ConnectionProvider,
  opts: DeployOptions,
  savedTarget: ReturnType<typeof useDeployTargetStore.getState>['targets'][string] | null
): Record<string, any> {
  switch (provider) {
    case 'vercel':
      return {
        projectPath: opts.projectPath,
        // Name is used only when creating a new project on Vercel.
        // When vercelProjectId is provided, Vercel links the deploy
        // to that project and the name param is ignored.
        name: savedTarget?.remoteProjectName || opts.projectName,
        vercelProjectId: savedTarget?.remoteProjectId,
        target: 'production',
      };

    case 'netlify':
      return {
        projectPath: opts.projectPath,
        // Netlify: siteId (when set) deploys to an existing site;
        // siteName is only used when creating a new site.
        siteId: savedTarget?.remoteProjectId,
        siteName: savedTarget?.remoteProjectName || opts.projectName,
      };

    case 'cloudflare': {
      const accountId = opts.cloudflareAccountId ?? savedTarget?.cloudflareAccountId;
      if (!accountId) {
        throw new Error(
          'Cloudflare Pages deploy requires an account ID. Set a deploy target or pass cloudflareAccountId.'
        );
      }
      return {
        projectPath: opts.projectPath,
        projectName: savedTarget?.remoteProjectName || opts.projectName,
        accountId,
        branch: 'main',
      };
    }

    default:
      return { projectPath: opts.projectPath, name: opts.projectName };
  }
}

function extractDeployUrl(
  provider: ConnectionProvider,
  deployment: any,
  savedTarget: ReturnType<typeof useDeployTargetStore.getState>['targets'][string] | null
): string | null {
  if (!deployment) return null;

  // 1. Prefer a custom domain surfaced by the provider's deploy response.
  //    (vercel.ts populates deployment.customDomain when deploying to an
  //    existing project that has a verified custom domain.)
  if (deployment.customDomain) {
    return ensureHttps(deployment.customDomain);
  }

  // 2. Fall back to the domain saved in the target, if any.
  if (savedTarget?.domain) {
    return ensureHttps(savedTarget.domain);
  }

  // 3. Otherwise, use the provider's auto-generated URL.
  switch (provider) {
    case 'vercel':
      return deployment.url ? ensureHttps(deployment.url) : null;

    case 'netlify':
      return deployment.deploy_ssl_url || deployment.ssl_url || deployment.url || null;

    case 'cloudflare':
      return deployment.url || null;

    default:
      return deployment.url || null;
  }
}

function ensureHttps(urlOrHost: string): string {
  return urlOrHost.startsWith('http') ? urlOrHost : `https://${urlOrHost}`;
}