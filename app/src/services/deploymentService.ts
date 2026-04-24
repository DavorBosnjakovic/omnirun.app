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
    let provider: ConnectionProvider | null =
      savedTarget?.provider ?? opts.provider ?? pickDefaultProvider(projectId);
    if (!provider) {
      throw new Error(
        'No deploy provider connected. Connect Vercel, Netlify, or Cloudflare in Settings > Project Connections.'
      );
    }
    if (!DEPLOY_PROVIDERS.includes(provider)) {
      throw new Error(`Provider "${provider}" does not support direct deploy.`);
    }

    // 1b. Validate the chosen provider is still connected.
    //     If the saved target points to a disconnected provider, clear it
    //     and fall back to the next available provider instead of failing.
    const connStore = useConnectionsStore.getState();
    const projectConns = connStore.projectConnections[projectId] || {};
    const isConnected =
      projectConns[provider]?.status === 'connected' ||
      connStore.getConnection(provider)?.status === 'connected';
    if (!isConnected) {
      // Clear stale saved target
      if (savedTarget?.provider === provider && typeof targetStore.clearTarget === 'function') {
        targetStore.clearTarget(projectId);
      }
      // Try to find another connected provider
      const fallback = pickDefaultProvider(projectId);
      if (!fallback) {
        throw new Error(
          `${provider.charAt(0).toUpperCase() + provider.slice(1)} is no longer connected and no other deploy provider is available. Please connect one in Settings > Project Connections.`
        );
      }
      provider = fallback;
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

    // 5. Poll build status until READY or ERROR.
    //    Vercel/Netlify return a deployment ID we can poll.
    //    Cloudflare returns a deployment with a status field.
    emit({ stage: 'building', message: 'Build queued…', percent: 70 });

    const finalDeployment = await pollBuildStatus(
      provider,
      projectId,
      deployment,
      (statusMessage, percent) => {
        emit({ stage: 'building', message: statusMessage, percent });
      }
    );

    // 6. Extract URL — prefer custom domain from saved target or from
    //    deployment response; fall back to provider's auto-generated URL.
    const url = extractDeployUrl(provider, finalDeployment, savedTarget);
    if (!url) {
      throw new Error('Deploy succeeded but no URL was returned by the provider.');
    }

    // 7. Record successful deploy for the target (and pick up a new domain
    //    if the deployment response exposed one we hadn't seen before).
    if (savedTarget) {
      targetStore.markDeployed(projectId);
      if (finalDeployment?.customDomain && finalDeployment.customDomain !== savedTarget.domain) {
        targetStore.setDomain(projectId, finalDeployment.customDomain);
      }
    }

    emit({
      stage: 'live',
      message: 'Your site is live!',
      percent: 100,
      url,
      deployment: finalDeployment,
    });

    return { provider, url, deployment: finalDeployment };
  } catch (err: any) {
    const message = err?.message || 'Deploy failed';
    emit({ stage: 'failed', message, error: message });
    throw err;
  }
}

/**
 * Return the first deploy-capable provider that is connected for this project,
 * or null if none.
 *
 * Checks BOTH project-scoped and global connections, since hosting providers
 * (Vercel, Netlify, Cloudflare) are global-scoped.
 */
export function pickDefaultProvider(projectId: string): ConnectionProvider | null {
  const store = useConnectionsStore.getState();
  const projectConns = store.projectConnections[projectId] || {};
  for (const p of DEPLOY_PROVIDERS) {
    // Check project-scoped connection first, then global
    if (
      projectConns[p]?.status === 'connected' ||
      store.getConnection(p)?.status === 'connected'
    ) {
      return p;
    }
  }
  return null;
}

/**
 * List every deploy provider currently connected for this project.
 * Useful for showing a chooser in the UI when more than one is connected.
 *
 * Checks BOTH project-scoped and global connections.
 */
export function listConnectedDeployProviders(projectId: string): ConnectionProvider[] {
  const store = useConnectionsStore.getState();
  const projectConns = store.projectConnections[projectId] || {};
  return DEPLOY_PROVIDERS.filter(
    (p) =>
      projectConns[p]?.status === 'connected' ||
      store.getConnection(p)?.status === 'connected'
  );
}

// --------------- Internals ---------------

/** Max time to wait for a build before giving up (5 minutes). */
const BUILD_TIMEOUT_MS = 5 * 60 * 1000;
/** How often to check build status (3 seconds). */
const POLL_INTERVAL_MS = 3000;

/**
 * Poll the provider's deployment status until the build is READY or fails.
 * Emits human-readable status updates via the onStatus callback.
 * Returns the final deployment object (with readyState = READY).
 * Throws if the build errors, is canceled, or times out.
 */
async function pollBuildStatus(
  provider: ConnectionProvider,
  projectId: string,
  deployment: any,
  onStatus: (message: string, percent: number) => void
): Promise<any> {
  const startTime = Date.now();
  let lastState = '';

  while (Date.now() - startTime < BUILD_TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);

    try {
      const status = await fetchDeploymentStatus(provider, projectId, deployment);
      const state = status.state;
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      // Don't spam identical updates.
      if (state !== lastState) {
        lastState = state;
      }

      switch (state) {
        case 'READY':
          // Build succeeded — merge any new fields into deployment.
          return { ...deployment, ...status.raw };

        case 'ERROR':
        case 'FAILED': {
          const errMsg = status.errorMessage || 'Build failed on the server.';
          throw new Error(errMsg);
        }

        case 'CANCELED':
        case 'CANCELLED':
          throw new Error('Deployment was canceled.');

        case 'BUILDING':
          onStatus(`Building… (${elapsed}s)`, 75);
          break;

        case 'INITIALIZING':
          onStatus(`Initializing build… (${elapsed}s)`, 72);
          break;

        case 'QUEUED':
          onStatus(`Queued for build… (${elapsed}s)`, 70);
          break;

        default:
          onStatus(`${state || 'Processing'}… (${elapsed}s)`, 73);
          break;
      }
    } catch (err: any) {
      // If this is a build/deploy error (not a network issue), rethrow it.
      const msg = err.message || '';
      const isNetworkError =
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('ECONNREFUSED') ||
        msg.includes('timeout') ||
        msg.includes('aborted');
      if (!isNetworkError) {
        throw err;
      }
      // Network/polling error — log and retry.
      console.warn('pollBuildStatus: transient error, retrying…', msg);
    }
  }

  // Timeout — build is taking too long.
  throw new Error(
    `Build timed out after ${BUILD_TIMEOUT_MS / 60000} minutes. Check the provider dashboard for details.`
  );
}

/**
 * Fetch current deployment state from the provider.
 * Returns a normalized { state, errorMessage, raw } object.
 */
async function fetchDeploymentStatus(
  provider: ConnectionProvider,
  projectId: string,
  deployment: any
): Promise<{ state: string; errorMessage?: string; raw: any }> {
  switch (provider) {
    case 'vercel': {
      // Vercel: GET /v13/deployments/{id} → { readyState, ready, ... }
      const deploymentId = deployment.id || deployment.uid;
      if (!deploymentId) return { state: 'READY', raw: deployment };

      const res = await executeProjectProviderAction(
        projectId, 'vercel', 'get_deployment', { deploymentId }
      );

      const state = (res?.readyState || res?.state || 'QUEUED').toUpperCase();

      // Extract the most useful error info Vercel provides.
      // readyStateReason has the build error; errorMessage is a fallback.
      let errorMessage: string | undefined;
      if (state === 'ERROR') {
        // Vercel sometimes nests the error in different fields.
        const reason = res?.readyStateReason;
        if (typeof reason === 'string') {
          errorMessage = reason;
        } else if (reason?.message) {
          errorMessage = reason.message;
        }
        if (!errorMessage) {
          errorMessage = res?.errorMessage || res?.error?.message;
        }
        // Include the build error code if present.
        const code = res?.errorCode || reason?.code;
        if (code && errorMessage) {
          errorMessage = `[${code}] ${errorMessage}`;
        }
        if (!errorMessage) {
          errorMessage = 'Build failed. Check the Vercel dashboard for details.';
        }

        // Fetch build logs for the real error details (e.g. which module is missing).
        try {
          const buildErrors = await fetchVercelBuildErrors(projectId, deploymentId);
          if (buildErrors) {
            errorMessage += '\n\nBuild log:\n' + buildErrors;
          }
        } catch {
          // Non-fatal — we already have the basic error.
        }
      }

      return { state, errorMessage, raw: res };
    }

    case 'netlify': {
      // Netlify: GET /sites/{siteId}/deploys → latest deploy state
      const siteId = deployment.site_id || deployment.siteId;
      const deployId = deployment.id;
      if (!siteId || !deployId) return { state: 'READY', raw: deployment };

      // Netlify doesn't have a get-single-deploy by ID in our service,
      // so list deploys and find ours.
      const deploys = await executeProjectProviderAction(
        projectId, 'netlify', 'list_deploys', { siteId }
      );
      const rawDeploys = Array.isArray(deploys) ? deploys : (deploys?.deploys ?? deploys?.result ?? deploys?.data ?? []);
      const arr = Array.isArray(rawDeploys) ? rawDeploys : [];
      const ours = arr.find((d: any) => d.id === deployId) || arr[0];

      if (!ours) return { state: 'READY', raw: deployment };

      const stateMap: Record<string, string> = {
        ready: 'READY',
        error: 'ERROR',
        building: 'BUILDING',
        enqueued: 'QUEUED',
        uploading: 'BUILDING',
        processing: 'BUILDING',
      };
      const state = stateMap[ours.state?.toLowerCase()] || ours.state?.toUpperCase() || 'BUILDING';
      const errorMessage = state === 'ERROR'
        ? (ours.error_message || 'Build failed on Netlify.')
        : undefined;

      return { state, errorMessage, raw: ours };
    }

    case 'cloudflare': {
      // Cloudflare Pages deployments don't have a poll endpoint in our service.
      // The create_pages_deployment call is synchronous — if it returned,
      // the deploy is either processing or done. We treat it as READY.
      return { state: 'READY', raw: deployment };
    }

    default:
      return { state: 'READY', raw: deployment };
  }
}

/**
 * Strip ANSI escape codes (colors, formatting) from a string.
 * Vercel build logs are full of these and they waste tokens + confuse the AI.
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]|\x1B\].*?\x07/g, '').replace(/\[[\d;]*m/g, '');
}

/**
 * Fetch Vercel build events and extract error lines.
 * Returns a trimmed string of the most relevant error output,
 * or null if no useful errors found.
 */
async function fetchVercelBuildErrors(
  projectId: string,
  deploymentId: string
): Promise<string | null> {
  const events: any[] = await executeProjectProviderAction(
    projectId, 'vercel', 'get_build_logs', { deploymentId }
  );

  if (!Array.isArray(events) || events.length === 0) return null;

  // Collect lines that look like errors.
  // Vercel events have: { type, created, payload: { text, ... } }
  // or sometimes just { text: '...' }.
  const errorLines: string[] = [];
  const allLines: string[] = [];

  for (const ev of events) {
    let text =
      ev?.payload?.text ||
      ev?.payload?.message ||
      ev?.text ||
      ev?.message ||
      '';
    if (!text) continue;

    // Strip ANSI color codes — they bloat the message and confuse the AI.
    text = stripAnsi(text).trim();
    if (!text) continue;

    allLines.push(text);

    // Match lines that contain error indicators.
    const lower = text.toLowerCase();
    if (
      lower.includes('error') ||
      lower.includes('failed') ||
      lower.includes('module not found') ||
      lower.includes('cannot find') ||
      lower.includes('not found') ||
      lower.includes('syntaxerror') ||
      lower.includes('typeerror') ||
      lower.includes('referenceerror') ||
      ev?.type === 'error' ||
      ev?.type === 'stderr'
    ) {
      errorLines.push(text);
    }
  }

  if (errorLines.length > 0) {
    // Deduplicate and return up to 15 error lines.
    const unique = [...new Set(errorLines)];
    return unique.slice(-15).join('\n');
  }

  // If no explicit error lines found, return the last 10 lines
  // of output — the error is usually at the end.
  if (allLines.length > 0) {
    return allLines.slice(-10).join('\n');
  }

  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
      // Try: explicit opt → saved target → global connection account info
      let accountId = opts.cloudflareAccountId ?? savedTarget?.cloudflareAccountId;
      if (!accountId) {
        const cfConn = useConnectionsStore.getState().getConnection('cloudflare');
        accountId =
          cfConn?.accountInfo?.extra?.accountId ||
          cfConn?.accountInfo?.extra?.organizations?.[0]?.id ||
          cfConn?.accountInfo?.id;
      }
      if (!accountId) {
        throw new Error(
          'Cloudflare Pages deploy requires an account ID. Could not determine it from your connection. Please reconnect Cloudflare.'
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