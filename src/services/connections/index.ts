// ============================================================
// Connections - Barrel Export
// ============================================================

// Types
export type {
  ConnectionProvider,
  ConnectionCategory,
  ConnectionStatus,
  Connection,
  AccountInfo,
  ProviderMeta,
  ConnectionService,
} from './types';

export { PROVIDERS, MVP_PROVIDERS, CATEGORIES } from './types';

// Services
export { githubService } from './github';
export { vercelService } from './vercel';
export { supabaseService } from './supabase';
export { stripeService } from './stripe';
export { netlifyService } from './netlify';
export { sendgridService } from './sendgrid';
export { cloudflareService } from './cloudflare';
export { namecheapService } from './namecheap';
export { bunnyService } from './bunny';
export { godaddyService } from './godaddy';
export { resendService } from './resend';
export { porkbunService } from './porkbun';

// Manager (main entry point)
export {
  connectProvider,
  disconnectProvider,
  retestConnection,
  retestAllConnections,
  executeProviderAction,
  getService,
  isServiceAvailable,
} from './connectionManager';