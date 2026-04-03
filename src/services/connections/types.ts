// ============================================================
// Connection Types - Omnirun Connections Hub
// ============================================================

// --------------- Provider Registry ---------------

export type ConnectionProvider =
  // MVP
  | 'github'
  | 'vercel'
  | 'netlify'
  | 'supabase'
  | 'stripe'
  | 'sendgrid'
  | 'namecheap'
  | 'cloudflare'
  | 'bunny'
  | 'godaddy'
  | 'resend'
  | 'porkbun'
  // Phase 2
  | 'railway'
  | 'render'
  | 'firebase'
  | 'planetscale'
  | 'paypal';

export type ConnectionCategory =
  | 'hosting'
  | 'database'
  | 'version-control'
  | 'payments'
  | 'email'
  | 'domains'
  | 'storage';

export type AuthMethod = 'api-key' | 'personal-token' | 'oauth';

// --------------- Connection State ---------------

export type ConnectionStatus =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error'
  | 'expired';

export interface Connection {
  provider: ConnectionProvider;
  status: ConnectionStatus;
  token: string;              // API key or access token
  tokenLabel?: string;        // e.g. "sk-...abc" (masked for display)
  accountInfo?: AccountInfo;  // fetched after successful connection
  connectedAt?: number;       // timestamp
  lastTestedAt?: number;      // last successful test
  error?: string;             // error message if status === 'error'
}

export interface AccountInfo {
  id?: string;
  name?: string;
  email?: string;
  avatar?: string;
  plan?: string;
  // Provider-specific extras
  extra?: Record<string, any>;
}

// --------------- Provider Metadata ---------------
// Static info about each provider (for UI rendering)

export interface ProviderMeta {
  id: ConnectionProvider;
  name: string;
  description: string;
  category: ConnectionCategory;
  authMethod: AuthMethod;
  tokenName: string;          // what to call the credential ("API Key", "Personal Access Token", etc.)
  tokenHelpUrl: string;       // link to where user gets their token
  tokenPlaceholder: string;   // input placeholder
  icon: string;               // Lucide icon name
  docsUrl: string;
  features: string[];         // what we automate
  /**
   * 'global'  — one credential shared across all projects (GitHub, Stripe, Vercel, etc.)
   * 'project' — each project has its own credential (Supabase, Firebase, PlanetScale, etc.)
   */
  scope: 'global' | 'project';
}

// Full provider registry
export const PROVIDERS: Record<ConnectionProvider, ProviderMeta> = {
  github: {
    id: 'github',
    name: 'GitHub',
    description: 'Version control, repos, commits',
    category: 'version-control',
    authMethod: 'personal-token',
    tokenName: 'Personal Access Token',
    tokenHelpUrl: 'https://github.com/settings/tokens?type=beta',
    tokenPlaceholder: 'github_pat_...',
    icon: 'Github',
    docsUrl: 'https://docs.github.com/en/rest',
    features: ['Push/pull code', 'Create repos', 'Manage branches', 'Create PRs'],
    scope: 'global',
  },
  vercel: {
    id: 'vercel',
    name: 'Vercel',
    description: 'Deploy, domains, SSL, previews',
    category: 'hosting',
    authMethod: 'personal-token',
    tokenName: 'Access Token',
    tokenHelpUrl: 'https://vercel.com/account/tokens',
    tokenPlaceholder: 'Bearer ...',
    icon: 'Triangle',
    docsUrl: 'https://vercel.com/docs/rest-api',
    features: ['Deploy projects', 'Manage domains', 'SSL certificates', 'Environment variables', 'Preview deploys'],
    scope: 'global',
  },
  netlify: {
    id: 'netlify',
    name: 'Netlify',
    description: 'Deploy, domains, forms, functions',
    category: 'hosting',
    authMethod: 'personal-token',
    tokenName: 'Personal Access Token',
    tokenHelpUrl: 'https://app.netlify.com/user/applications#personal-access-tokens',
    tokenPlaceholder: 'nfp_...',
    icon: 'Globe',
    docsUrl: 'https://docs.netlify.com/api/get-started/',
    features: ['Deploy sites', 'Manage domains', 'SSL certificates', 'Form submissions', 'Functions'],
    scope: 'global',
  },
  supabase: {
    id: 'supabase',
    name: 'Supabase',
    description: 'Database, auth, storage, functions',
    category: 'database',
    authMethod: 'personal-token',
    tokenName: 'Access Token',
    tokenHelpUrl: 'https://supabase.com/dashboard/account/tokens',
    tokenPlaceholder: 'sbp_...',
    icon: 'Database',
    docsUrl: 'https://supabase.com/docs/reference/api/introduction',
    features: ['Create tables', 'Manage auth', 'File storage', 'Edge functions', 'Database migrations'],
    scope: 'project',
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe',
    description: 'Payments, subscriptions, invoices',
    category: 'payments',
    authMethod: 'api-key',
    tokenName: 'Secret Key',
    tokenHelpUrl: 'https://dashboard.stripe.com/apikeys',
    tokenPlaceholder: 'sk_live_... or sk_test_...',
    icon: 'CreditCard',
    docsUrl: 'https://stripe.com/docs/api',
    features: ['Products & prices', 'Checkout sessions', 'Subscriptions', 'Customer management'],
    scope: 'global',
  },
  sendgrid: {
    id: 'sendgrid',
    name: 'SendGrid',
    description: 'Transactional email, templates',
    category: 'email',
    authMethod: 'api-key',
    tokenName: 'API Key',
    tokenHelpUrl: 'https://app.sendgrid.com/settings/api_keys',
    tokenPlaceholder: 'SG....',
    icon: 'Mail',
    docsUrl: 'https://docs.sendgrid.com/api-reference',
    features: ['Send emails', 'Email templates', 'Contact lists', 'Delivery tracking'],
    scope: 'global',
  },
  namecheap: {
    id: 'namecheap',
    name: 'Namecheap',
    description: 'Domains, DNS records',
    category: 'domains',
    authMethod: 'api-key',
    tokenName: 'API Key',
    tokenHelpUrl: 'https://ap.www.namecheap.com/settings/tools/apiaccess/',
    tokenPlaceholder: 'Your Namecheap API key',
    icon: 'Globe2',
    docsUrl: 'https://www.namecheap.com/support/api/methods/',
    features: ['DNS records', 'Domain management', 'Nameserver config'],
    scope: 'global',
  },
  cloudflare: {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'DNS, CDN, security, pages',
    category: 'domains',
    authMethod: 'api-key',
    tokenName: 'API Token',
    tokenHelpUrl: 'https://dash.cloudflare.com/profile/api-tokens',
    tokenPlaceholder: 'Your Cloudflare API token',
    icon: 'Shield',
    docsUrl: 'https://developers.cloudflare.com/api/',
    features: ['DNS records', 'CDN config', 'Security rules', 'Pages deployment'],
    scope: 'global',
  },
  bunny: {
    id: 'bunny',
    name: 'Bunny.net',
    description: 'CDN, edge storage, DNS',
    category: 'storage',
    authMethod: 'api-key',
    tokenName: 'Account API Key',
    tokenHelpUrl: 'https://dash.bunny.net/account/settings',
    tokenPlaceholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    icon: 'Rabbit',
    docsUrl: 'https://docs.bunny.net',
    features: ['CDN pull zones', 'Edge storage', 'DNS zones', 'Cache purge', 'File management'],
    scope: 'global',
  },
  godaddy: {
    id: 'godaddy',
    name: 'GoDaddy',
    description: 'Domains, DNS records',
    category: 'domains',
    authMethod: 'api-key',
    tokenName: 'API Key:Secret',
    tokenHelpUrl: 'https://developer.godaddy.com/keys',
    tokenPlaceholder: 'key:secret',
    icon: 'Globe2',
    docsUrl: 'https://developer.godaddy.com/doc',
    features: ['Domain management', 'DNS records', 'Domain details'],
    scope: 'global',
  },
  resend: {
    id: 'resend',
    name: 'Resend',
    description: 'Modern transactional email',
    category: 'email',
    authMethod: 'api-key',
    tokenName: 'API Key',
    tokenHelpUrl: 'https://resend.com/api-keys',
    tokenPlaceholder: 're_...',
    icon: 'Send',
    docsUrl: 'https://resend.com/docs/api-reference',
    features: ['Send emails', 'Domain verification', 'Delivery tracking'],
    scope: 'global',
  },
  porkbun: {
    id: 'porkbun',
    name: 'Porkbun',
    description: 'Domains, DNS records',
    category: 'domains',
    authMethod: 'api-key',
    tokenName: 'API Key:Secret Key',
    tokenHelpUrl: 'https://porkbun.com/account/api',
    tokenPlaceholder: 'pk1_xxx:sk1_xxx',
    icon: 'Landmark',
    docsUrl: 'https://porkbun.com/api/json/v3/documentation',
    features: ['Domain management', 'DNS records', 'DNS editing'],
    scope: 'global',
  },
  // Phase 2 stubs
  railway: {
    id: 'railway',
    name: 'Railway',
    description: 'Deploy, databases, env variables',
    category: 'hosting',
    authMethod: 'personal-token',
    tokenName: 'API Token',
    tokenHelpUrl: 'https://railway.app/account/tokens',
    tokenPlaceholder: 'Your Railway token',
    icon: 'Train',
    docsUrl: 'https://docs.railway.app/reference/public-api',
    features: ['Deploy services', 'Manage databases', 'Environment variables'],
    scope: 'global',
  },
  render: {
    id: 'render',
    name: 'Render',
    description: 'Deploy, databases, cron jobs',
    category: 'hosting',
    authMethod: 'api-key',
    tokenName: 'API Key',
    tokenHelpUrl: 'https://dashboard.render.com/u/settings#api-keys',
    tokenPlaceholder: 'rnd_...',
    icon: 'Server',
    docsUrl: 'https://api-docs.render.com/',
    features: ['Deploy services', 'Managed databases', 'Cron jobs'],
    scope: 'global',
  },
  firebase: {
    id: 'firebase',
    name: 'Firebase',
    description: 'Firestore, auth, storage',
    category: 'database',
    authMethod: 'api-key',
    tokenName: 'Service Account Key',
    tokenHelpUrl: 'https://console.firebase.google.com/project/_/settings/serviceaccounts/adminsdk',
    tokenPlaceholder: 'Paste JSON key or token',
    icon: 'Flame',
    docsUrl: 'https://firebase.google.com/docs/reference/rest',
    features: ['Firestore database', 'Authentication', 'File storage', 'Cloud functions'],
    scope: 'project',
  },
  planetscale: {
    id: 'planetscale',
    name: 'PlanetScale',
    description: 'MySQL databases, branches',
    category: 'database',
    authMethod: 'personal-token',
    tokenName: 'Service Token',
    tokenHelpUrl: 'https://app.planetscale.com/~/settings/service-tokens',
    tokenPlaceholder: 'pscale_tkn_...',
    icon: 'Database',
    docsUrl: 'https://api-docs.planetscale.com/',
    features: ['Create databases', 'Database branches', 'Deploy requests', 'Schema management'],
    scope: 'project',
  },
  paypal: {
    id: 'paypal',
    name: 'PayPal',
    description: 'Payments, subscriptions',
    category: 'payments',
    authMethod: 'api-key',
    tokenName: 'Client ID + Secret',
    tokenHelpUrl: 'https://developer.paypal.com/dashboard/applications/',
    tokenPlaceholder: 'Client ID',
    icon: 'Wallet',
    docsUrl: 'https://developer.paypal.com/docs/api/overview/',
    features: ['Payments', 'Subscriptions', 'Invoices'],
    scope: 'global',
  },
};

// Which providers are available in MVP
export const MVP_PROVIDERS: ConnectionProvider[] = [
  'github', 'vercel', 'netlify', 'supabase', 'stripe', 'sendgrid', 'namecheap', 'cloudflare',
  'bunny', 'godaddy', 'resend', 'porkbun',
];

// Providers that are scoped per-project (each project has its own credential)
export const PROJECT_SCOPED_PROVIDERS: ConnectionProvider[] = MVP_PROVIDERS.filter(
  (p) => PROVIDERS[p].scope === 'project'
);

// Category display order and labels
export const CATEGORIES: { id: ConnectionCategory; label: string }[] = [
  { id: 'hosting', label: 'Hosting & Deployment' },
  { id: 'version-control', label: 'Version Control' },
  { id: 'database', label: 'Database' },
  { id: 'payments', label: 'Payments' },
  { id: 'domains', label: 'Domains & DNS' },
  { id: 'email', label: 'Email' },
  { id: 'storage', label: 'CDN & Storage' },
];

// --------------- Service Interface ---------------
// Every connection service implements this

export interface ConnectionService {
  /** Test the token and return account info */
  testConnection(token: string): Promise<AccountInfo>;

  /** Provider-specific actions (meta-tool pattern) */
  execute(action: string, params: Record<string, any>, token: string): Promise<any>;
}