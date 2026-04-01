// ============================================================
// Netlify Connection Service
// ============================================================
// API docs: https://docs.netlify.com/api/get-started/
// Token: Personal Access Token
// Base URL: https://api.netlify.com/api/v1

import type { ConnectionService, AccountInfo } from './types';

const BASE = 'https://api.netlify.com/api/v1';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'omnirun/1.0.0',
  };
}

async function ntlFetch(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(token), ...options.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body.message || `Netlify API error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  if (res.status === 204) return null;
  return res.json();
}

const actions: Record<string, (params: any, token: string) => Promise<any>> = {
  async list_sites(params, token) {
    return ntlFetch('/sites', token);
  },

  async get_site(params, token) {
    const { siteId } = params;
    return ntlFetch(`/sites/${siteId}`, token);
  },

  async create_site(params, token) {
    const { name, custom_domain } = params;
    const body: any = {};
    if (name) body.name = name;
    if (custom_domain) body.custom_domain = custom_domain;
    return ntlFetch('/sites', token, { method: 'POST', body: JSON.stringify(body) });
  },

  // Deploy a site (zip-based)
  async deploy_site(params, token) {
    const { siteId, files } = params;
    // files: { '/index.html': 'sha1hash', ... }
    return ntlFetch(`/sites/${siteId}/deploys`, token, {
      method: 'POST',
      body: JSON.stringify({ files }),
    });
  },

  async list_deploys(params, token) {
    const { siteId } = params;
    return ntlFetch(`/sites/${siteId}/deploys`, token);
  },

  async list_forms(params, token) {
    const { siteId } = params;
    return ntlFetch(`/sites/${siteId}/forms`, token);
  },

  async list_submissions(params, token) {
    const { formId } = params;
    return ntlFetch(`/forms/${formId}/submissions`, token);
  },

  async set_env(params, token) {
    const { siteId, key, values } = params;
    // values: [{ value: '...', context: 'production' }]
    return ntlFetch(`/accounts/me/env/${key}?site_id=${siteId}`, token, {
      method: 'PUT',
      body: JSON.stringify({ key, values }),
    });
  },

  async list_env(params, token) {
    const { siteId } = params;
    return ntlFetch(`/accounts/me/env?site_id=${siteId}`, token);
  },

  async get_dns_zones(params, token) {
    return ntlFetch('/dns_zones', token);
  },
};

export const netlifyService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const user = await ntlFetch('/user', token);
    const sites = await ntlFetch('/sites', token);
    return {
      id: user.id,
      name: user.full_name || user.email,
      email: user.email,
      avatar: user.avatar_url,
      extra: {
        slug: user.slug,
        site_count: Array.isArray(sites) ? sites.length : 0,
      },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string) {
    const handler = actions[action];
    if (!handler) {
      throw new Error(`Unknown Netlify action: "${action}". Available: ${Object.keys(actions).join(', ')}`);
    }
    return handler(params, token);
  },
};