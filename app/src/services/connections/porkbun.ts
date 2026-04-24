// ============================================================
// Porkbun — Domain Registration & DNS Management
// ============================================================
// Auth: API key + Secret Key in JSON body (POST everything)
// Base URL: https://api.porkbun.com/api/json/v3
// Docs: https://porkbun.com/api/json/v3/documentation

import type { ConnectionService, AccountInfo } from './types';
import { fetch } from '@tauri-apps/plugin-http';

const BASE_URL = 'https://api.porkbun.com/api/json/v3';

async function porkbunFetch(path: string, apiKey: string, bodyData: Record<string, any> = {}): Promise<any> {
  const [key, secret] = apiKey.split(':');
  if (!key || !secret) throw new Error('Porkbun token must be in format "apikey:secretapikey"');
  const body = { apikey: key, secretapikey: secret, ...bodyData };
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.status !== 'SUCCESS') throw new Error(data.message || `Porkbun API error: ${data.status}`);
  return data;
}

// --------------- Actions ---------------

async function listDomains(token: string): Promise<any> {
  const data = await porkbunFetch('/domain/listAll', token);
  return (data.domains || []).map((d: any) => ({
    domain: d.domain, status: d.status, tld: d.tld,
    createDate: d.createDate, expireDate: d.expireDate,
    autoRenew: d.autoRenew === 1, whoisPrivacy: d.whoisPrivacy === 1, locked: d.locked === 1,
  }));
}

async function getDomain(token: string, params: any): Promise<any> {
  const data = await porkbunFetch('/domain/listAll', token);
  const domain = (data.domains || []).find((d: any) => d.domain === params.domain);
  if (!domain) throw new Error(`Domain "${params.domain}" not found in account`);
  return {
    domain: domain.domain, status: domain.status, tld: domain.tld,
    createDate: domain.createDate, expireDate: domain.expireDate,
    autoRenew: domain.autoRenew === 1, whoisPrivacy: domain.whoisPrivacy === 1,
  };
}

async function getDnsRecords(token: string, params: any): Promise<any> {
  const { domain, type, subdomain } = params;
  let path = `/dns/retrieve/${domain}`;
  if (type && subdomain) path = `/dns/retrieveByNameType/${domain}/${type}/${subdomain}`;
  else if (type) path = `/dns/retrieveByNameType/${domain}/${type}`;
  const data = await porkbunFetch(path, token);
  return (data.records || []).map((r: any) => ({
    id: r.id, name: r.name, type: r.type, content: r.content,
    ttl: r.ttl, priority: r.prio, notes: r.notes,
  }));
}

async function createDnsRecord(token: string, params: any): Promise<any> {
  const { domain, type, name = '', content, ttl = 600, priority } = params;
  const body: Record<string, any> = { type: type.toUpperCase(), name, content, ttl: String(ttl) };
  if (priority !== undefined) body.prio = String(priority);
  const data = await porkbunFetch(`/dns/create/${domain}`, token, body);
  return { id: data.id, type: type.toUpperCase(), name: name || '@', content, ttl };
}

async function editDnsRecord(token: string, params: any): Promise<any> {
  const { domain, record_id, type, name = '', content, ttl = 600, priority } = params;
  const body: Record<string, any> = { type: type.toUpperCase(), name, content, ttl: String(ttl) };
  if (priority !== undefined) body.prio = String(priority);
  await porkbunFetch(`/dns/edit/${domain}/${record_id}`, token, body);
  return { updated: record_id, type: type.toUpperCase(), name: name || '@', content };
}

async function deleteDnsRecord(token: string, params: any): Promise<any> {
  await porkbunFetch(`/dns/delete/${params.domain}/${params.record_id}`, token);
  return { deleted: params.record_id };
}

// --------------- Service Export ---------------

export const porkbunService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const [key, secret] = token.split(':');
    if (!key || !secret) throw new Error('Token must be "apikey:secretapikey"');
    const res = await fetch(`${BASE_URL}/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: key, secretapikey: secret }),
    });
    const data = await res.json();
    if (data.status !== 'SUCCESS') throw new Error(data.message || 'Authentication failed');
    // Try to get domain count
    let domainCount = 0;
    try {
      const domainData = await porkbunFetch('/domain/listAll', token);
      domainCount = domainData.domains?.length || 0;
    } catch {
      // ping succeeded but domain list may fail — still connected
    }
    return {
      name: 'Porkbun Account',
      extra: { domainCount, ip: data.yourIp },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string): Promise<any> {
    switch (action) {
      case 'list_domains': return listDomains(token);
      case 'get_domain': return getDomain(token, params);
      case 'get_dns_records': return getDnsRecords(token, params);
      case 'create_dns_record': return createDnsRecord(token, params);
      case 'edit_dns_record': return editDnsRecord(token, params);
      case 'delete_dns_record': return deleteDnsRecord(token, params);
      default: throw new Error(`Unknown Porkbun action: ${action}`);
    }
  },
};