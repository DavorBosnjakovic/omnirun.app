// ============================================================
// Connection Manager - Orchestrates all connection operations
// ============================================================
// Central entry point for connecting, testing, and using services.
// Follows meta-tool pattern: one execute() per service.

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

// --------------- Public API ---------------

/**
 * Connect to a provider by testing the token and storing it.
 * Returns account info on success, throws on failure.
 */
export async function connectProvider(
  provider: ConnectionProvider,
  token: string
): Promise<AccountInfo> {
  const store = useConnectionsStore.getState();
  const service = services[provider];

  if (!service) {
    throw new Error(`Service not implemented: ${provider}`);
  }

  // Set connecting state
  store.setConnecting(provider);

  try {
    // Test the token by fetching account info
    const accountInfo = await service.testConnection(token);

    // Success - store the connection
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
 * Disconnect from a provider.
 */
export function disconnectProvider(provider: ConnectionProvider): void {
  const store = useConnectionsStore.getState();
  store.disconnect(provider);
  console.log(`✗ Disconnected from ${PROVIDERS[provider].name}`);
}

/**
 * Re-test an existing connection (e.g. on app startup).
 * Silently updates status without throwing.
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
  } catch {
    store.setError(provider, 'Token expired or invalid');
    return false;
  }
}

/**
 * Re-test all connected providers (call on app startup).
 */
export async function retestAllConnections(): Promise<void> {
  const store = useConnectionsStore.getState();
  const connected = store.getConnectedProviders();

  // Test in parallel, don't block on failures
  await Promise.allSettled(
    connected.map((p) => retestConnection(p))
  );
}

/**
 * Execute an action on a connected provider (meta-tool pattern).
 * This is what the AI calls: execute('vercel', 'deploy', { ... })
 */
export async function executeProviderAction(
  provider: ConnectionProvider,
  action: string,
  params: Record<string, any> = {}
): Promise<any> {
  const store = useConnectionsStore.getState();
  const token = store.getToken(provider);
  const service = services[provider];

  if (!service) {
    throw new Error(`Service not implemented: ${provider}`);
  }

  if (!token) {
    throw new Error(
      `Not connected to ${PROVIDERS[provider].name}. Please connect in Settings > Connections.`
    );
  }

  try {
    return await service.execute(action, params, token);
  } catch (error: any) {
    // If it's an auth error, mark connection as expired
    if (error?.status === 401 || error?.status === 403) {
      store.setError(provider, 'Token expired or revoked');
    }
    throw error;
  }
}

/**
 * Get the service instance for a provider (for direct use).
 */
export function getService(provider: ConnectionProvider): ConnectionService | undefined {
  return services[provider];
}

/**
 * Check if a provider has an implemented service.
 */
export function isServiceAvailable(provider: ConnectionProvider): boolean {
  return !!services[provider];
}