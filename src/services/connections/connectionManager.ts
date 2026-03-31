// ============================================================
// Connection Manager - Orchestrates all connection operations
// ============================================================

import type { ConnectionProvider, AccountInfo, ConnectionService } from './types';
import { PROVIDERS } from './types';
import { useConnectionsStore } from '../../stores/connectionsStore';

// Service imports
import { githubService } from './github';
import { vercelService } from './vercel';
import { supabaseService } from './supabase';
import { stripeService } from './stripe';
import { netlifyService } from './netlify';
import { sendgridService } from './sendgrid';
import { cloudflareService } from './cloudflare';
import { namecheapService } from './namecheap';
import { bunnyService } from './bunny';
import { godaddyService } from './godaddy';
import { resendService } from './resend';
import { porkbunService } from './porkbun';

// --------------- Service Registry ---------------

const services: Partial<Record<ConnectionProvider, ConnectionService>> = {
  github: githubService,
  vercel: vercelService,
  supabase: supabaseService,
  stripe: stripeService,
  netlify: netlifyService,
  sendgrid: sendgridService,
  cloudflare: cloudflareService,
  namecheap: namecheapService,
  bunny: bunnyService,
  godaddy: godaddyService,
  resend: resendService,
  porkbun: porkbunService,
};

// ════════════════════════════════════════
// GLOBAL CONNECTIONS
// ════════════════════════════════════════

/**
 * Connect to a provider by testing the token and storing it.
 * For global-scoped providers only.
 */
export async function connectProvider(
  provider: ConnectionProvider,
  token: string
): Promise<AccountInfo> {
  const store = useConnectionsStore.getState();
  const service = services[provider];

  if (!service) throw new Error(`Service not implemented: ${provider}`);

  store.setConnecting(provider);

  try {
    const accountInfo = await service.testConnection(token);
    store.setConnected(provider, token, accountInfo);
    console.log(`✓ Connected to ${PROVIDERS[provider].name} as ${accountInfo.name || accountInfo.email || 'unknown'}`);
    return accountInfo;
  } catch (error: any) {
    const message = error?.message || 'Connection failed';
    store.setError(provider, message);
    throw error;
  }
}

/**
 * Disconnect from a global-scoped provider.
 */
export function disconnectProvider(provider: ConnectionProvider): void {
  useConnectionsStore.getState().disconnect(provider);
  console.log(`✗ Disconnected from ${PROVIDERS[provider].name}`);
}

/**
 * Re-test an existing global connection. Silently updates status without throwing.
 */
export async function retestConnection(provider: ConnectionProvider): Promise<boolean> {
  const store = useConnectionsStore.getState();
  const conn = store.getConnection(provider);
  const service = services[provider];

  if (!conn?.token || !service) return false;

  try {
    const accountInfo = await service.testConnection(conn.token);
    store.setConnected(provider, conn.token, accountInfo);
    return true;
  } catch (error: any) {
    // Don't wipe a send-only key — "restricted" means the key is valid
    // but lacks permission for this endpoint. Keep it connected.
    if (error?.message?.includes('restricted')) {
      return true;
    }
    store.setError(provider, 'Token expired or invalid');
    return false;
  }
}

/**
 * Re-test all connected global providers (call on app startup).
 */
export async function retestAllConnections(): Promise<void> {
  const store = useConnectionsStore.getState();
  const connected = store.getConnectedProviders();
  await Promise.allSettled(connected.map((p) => retestConnection(p)));
}

/**
 * Execute an action on a connected global provider (meta-tool pattern).
 */
export async function executeProviderAction(
  provider: ConnectionProvider,
  action: string,
  params: Record<string, any> = {}
): Promise<any> {
  const store = useConnectionsStore.getState();
  const token = store.getToken(provider);
  const service = services[provider];

  if (!service) throw new Error(`Service not implemented: ${provider}`);
  if (!token) {
    throw new Error(
      `Not connected to ${PROVIDERS[provider].name}. Please connect in Settings > Connections.`
    );
  }

  try {
    return await service.execute(action, params, token);
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      store.setError(provider, 'Token expired or revoked');
    }
    throw error;
  }
}

// ════════════════════════════════════════
// PROJECT-SCOPED CONNECTIONS
// ════════════════════════════════════════

/**
 * Connect a project-scoped provider for a specific project.
 * Each project has its own credential (e.g. its own Supabase instance).
 */
export async function connectProjectProvider(
  projectId: string,
  provider: ConnectionProvider,
  token: string
): Promise<AccountInfo> {
  const store = useConnectionsStore.getState();
  const service = services[provider];

  if (!service) throw new Error(`Service not implemented: ${provider}`);

  store.setProjectConnecting(projectId, provider);

  try {
    const accountInfo = await service.testConnection(token);
    store.setProjectConnected(projectId, provider, token, accountInfo);
    console.log(`✓ Connected project ${projectId} to ${PROVIDERS[provider].name}`);
    return accountInfo;
  } catch (error: any) {
    const message = error?.message || 'Connection failed';
    store.setProjectError(projectId, provider, message);
    throw error;
  }
}

/**
 * Disconnect a project-scoped provider for a specific project.
 */
export function disconnectProjectProvider(
  projectId: string,
  provider: ConnectionProvider
): void {
  useConnectionsStore.getState().disconnectProject(projectId, provider);
  console.log(`✗ Disconnected project ${projectId} from ${PROVIDERS[provider].name}`);
}

/**
 * Re-test a project-scoped connection. Silently updates status.
 */
export async function retestProjectConnection(
  projectId: string,
  provider: ConnectionProvider
): Promise<boolean> {
  const store = useConnectionsStore.getState();
  const conn = store.getProjectConnection(projectId, provider);
  const service = services[provider];

  if (!conn?.token || !service) return false;

  try {
    const accountInfo = await service.testConnection(conn.token);
    store.setProjectConnected(projectId, provider, conn.token, accountInfo);
    return true;
  } catch (error: any) {
    // Don't wipe a send-only key — "restricted" means the key is valid
    // but lacks permission for this endpoint. Keep it connected.
    if (error?.message?.includes('restricted')) {
      return true;
    }
    store.setProjectError(projectId, provider, 'Token expired or invalid');
    return false;
  }
}

/**
 * Execute an action using a project-scoped connection.
 * Falls back to the global connection if the project has none.
 */
export async function executeProjectProviderAction(
  projectId: string,
  provider: ConnectionProvider,
  action: string,
  params: Record<string, any> = {}
): Promise<any> {
  const store = useConnectionsStore.getState();

  // Try project-scoped token first, fall back to global
  const projectToken = store.getProjectToken(projectId, provider);
  const globalToken = store.getToken(provider);
  const token = projectToken || globalToken;
  const service = services[provider];

  if (!service) throw new Error(`Service not implemented: ${provider}`);
  if (!token) {
    throw new Error(
      `Not connected to ${PROVIDERS[provider].name} for this project. Please connect in Settings > Connections.`
    );
  }

  try {
    return await service.execute(action, params, token);
  } catch (error: any) {
    if (error?.status === 401 || error?.status === 403) {
      if (projectToken) {
        store.setProjectError(projectId, provider, 'Token expired or revoked');
      } else {
        store.setError(provider, 'Token expired or revoked');
      }
    }
    throw error;
  }
}

// --------------- Helpers ---------------

export function getService(provider: ConnectionProvider): ConnectionService | undefined {
  return services[provider];
}

export function isServiceAvailable(provider: ConnectionProvider): boolean {
  return !!services[provider];
}