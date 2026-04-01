// ============================================================
// Cloudflare Connection Service
// ============================================================
// API docs: https://developers.cloudflare.com/api/
// Token: API Token from https://dash.cloudflare.com/profile/api-tokens
// Base URL: https://api.cloudflare.com/client/v4

import type { ConnectionService, AccountInfo } from './types';

const BASE = 'https://api.cloudflare.com/client/v4';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'omnirun/1.0.0',
  };
}

async function cfFetch(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(token), ...options.headers },
  });
  const body = await res.json();
  if (!body.success) {
    const msg = body.errors?.[0]?.message || `Cloudflare API error: ${res.status}`;
    const err: any = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body.result;
}

const actions: Record<string, (params: any, token: string) => Promise<any>> = {
  async list_zones(params, token) {
    return cfFetch('/zones', token);
  },

  async get_zone(params, token) {
    const { zoneId } = params;
    return cfFetch(`/zones/${zoneId}`, token);
  },

  async list_dns_records(params, token) {
    const { zoneId } = params;
    return cfFetch(`/zones/${zoneId}/dns_records`, token);
  },

  async create_dns_record(params, token) {
    const { zoneId, type, name, content, ttl = 1, proxied = true } = params;
    return cfFetch(`/zones/${zoneId}/dns_records`, token, {
      method: 'POST',
      body: JSON.stringify({ type, name, content, ttl, proxied }),
    });
  },

  async update_dns_record(params, token) {
    const { zoneId, recordId, type, name, content, ttl = 1, proxied = true } = params;
    return cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, token, {
      method: 'PUT',
      body: JSON.stringify({ type, name, content, ttl, proxied }),
    });
  },

  async delete_dns_record(params, token) {
    const { zoneId, recordId } = params;
    return cfFetch(`/zones/${zoneId}/dns_records/${recordId}`, token, { method: 'DELETE' });
  },

  // Purge cache
  async purge_cache(params, token) {
    const { zoneId, purge_everything = true } = params;
    return cfFetch(`/zones/${zoneId}/purge_cache`, token, {
      method: 'POST',
      body: JSON.stringify({ purge_everything }),
    });
  },

  // Pages projects
  async list_pages_projects(params, token) {
    const { accountId } = params;
    return cfFetch(`/accounts/${accountId}/pages/projects`, token);
  },
};

export const cloudflareService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const verify = await cfFetch('/user/tokens/verify', token);
    const user = await cfFetch('/user', token);
    return {
      id: user.id,
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
      email: user.email,
      extra: {
        tokenStatus: verify.status,
        organizations: user.organizations,
      },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string) {
    const handler = actions[action];
    if (!handler) {
      throw new Error(`Unknown Cloudflare action: "${action}". Available: ${Object.keys(actions).join(', ')}`);
    }
    return handler(params, token);
  },
};