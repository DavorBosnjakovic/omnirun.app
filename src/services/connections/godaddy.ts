// ============================================================
// GoDaddy — Domains & DNS Management
// ============================================================
// Auth: API Key + Secret via "Authorization: sso-key KEY:SECRET" header
// Base URL: https://api.godaddy.com
// Docs: https://developer.godaddy.com/doc
// Note: DNS API requires 10+ domains OR active Domain Pro Plan

import type { ConnectionService, AccountInfo } from './types';

const BASE_URL = 'https://api.godaddy.com';

async function godaddyFetch(path: string, apiKey: string, options: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `sso-key ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `GoDaddy API error ${res.status}: ${text}`;
    try { const err = JSON.parse(text); message = err.message || err.code || message; } catch {}
    throw new Error(message);
  }
  if (res.status === 204) return { success: true };
  const ct = res.headers.get('content-type');
  if (!ct?.includes('application/json')) return { success: true };
  return res.json();
}

// --------------- Actions ---------------

async function listDomains(token: string, params: any = {}): Promise<any> {
  const query = new URLSearchParams();
  if (params.status) query.set('status', params.status);
  if (params.limit) query.set('limit', String(params.limit));
  const qs = query.toString();
  const domains = await godaddyFetch(`/v1/domains${qs ? '?' + qs : ''}`, token);
  return domains.map((d: any) => ({
    domain: d.domain, status: d.status, expires: d.expires,
    renewable: d.renewable, autoRenew: d.renewAuto, privacy: d.privacy,
    locked: d.locked, nameServers: d.nameServers, createdAt: d.createdAt,
  }));
}

async function getDomain(token: string, params: any): Promise<any> {
  const d = await godaddyFetch(`/v1/domains/${params.domain}`, token);
  return {
    domain: d.domain, domainId: d.domainId, status: d.status, expires: d.expires,
    renewable: d.renewable, autoRenew: d.renewAuto, privacy: d.privacy,
    locked: d.locked, nameServers: d.nameServers,
    contacts: { registrant: d.contactRegistrant?.email, admin: d.contactAdmin?.email, tech: d.contactTech?.email },
    createdAt: d.createdAt,
  };
}

async function getDnsRecords(token: string, params: any): Promise<any> {
  let path = `/v1/domains/${params.domain}/records`;
  if (params.type) path += `/${params.type}`;
  if (params.type && params.name) path += `/${params.name}`;
  const records = await godaddyFetch(path, token);
  return records.map((r: any) => ({
    type: r.type, name: r.name, data: r.data, ttl: r.ttl,
    priority: r.priority, port: r.port, weight: r.weight,
  }));
}

async function addDnsRecord(token: string, params: any): Promise<any> {
  const { domain, type, name, data, ttl = 600, priority } = params;
  const records = [{
    type: type.toUpperCase(), name: name || '@', data, ttl,
    ...(priority !== undefined ? { priority } : {}),
  }];
  await godaddyFetch(`/v1/domains/${domain}/records`, token, {
    method: 'PATCH', body: JSON.stringify(records),
  });
  return { added: { type, name: name || '@', data, ttl } };
}

async function updateDnsRecords(token: string, params: any): Promise<any> {
  const { domain, type, name, records } = params;
  const formatted = records.map((r: any) => ({
    data: r.data, ttl: r.ttl || 600,
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
  }));
  let path = `/v1/domains/${domain}/records/${type}`;
  if (name) path += `/${name}`;
  await godaddyFetch(path, token, { method: 'PUT', body: JSON.stringify(formatted) });
  return { updated: { type, name, count: formatted.length } };
}

async function deleteDnsRecord(token: string, params: any): Promise<any> {
  const { domain, type, name, data } = params;
  if (!data) throw new Error('Must specify "data" value to identify which record to delete');
  const path = `/v1/domains/${domain}/records/${type}${name ? '/' + name : ''}`;
  const existing = await godaddyFetch(path, token);
  const filtered = existing.filter((r: any) => r.data !== data);
  if (filtered.length === existing.length) throw new Error(`No ${type} record found with data "${data}"`);
  if (filtered.length === 0) throw new Error(`Cannot delete the last ${type} record for "${name || '@'}". GoDaddy requires at least one record per type/name.`);
  await godaddyFetch(path, token, {
    method: 'PUT',
    body: JSON.stringify(filtered.map((r: any) => ({
      data: r.data, ttl: r.ttl, ...(r.priority !== undefined ? { priority: r.priority } : {}),
    }))),
  });
  return { deleted: { type, name, data } };
}

// --------------- Service Export ---------------

export const godaddyService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const domains = await godaddyFetch('/v1/domains', token);
    const count = Array.isArray(domains) ? domains.length : 0;
    return {
      name: 'GoDaddy Account',
      extra: { domainCount: count },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string): Promise<any> {
    switch (action) {
      case 'list_domains': return listDomains(token, params);
      case 'get_domain': return getDomain(token, params);
      case 'get_dns_records': return getDnsRecords(token, params);
      case 'add_dns_record': return addDnsRecord(token, params);
      case 'update_dns_records': return updateDnsRecords(token, params);
      case 'delete_dns_record': return deleteDnsRecord(token, params);
      default: throw new Error(`Unknown GoDaddy action: ${action}`);
    }
  },
};