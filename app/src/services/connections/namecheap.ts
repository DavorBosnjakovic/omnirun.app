// ============================================================
// Namecheap Connection Service
// ============================================================
// API docs: https://www.namecheap.com/support/api/methods/
// Token: API Key + API User from https://www.namecheap.com/support/api/intro/
// Note: Namecheap uses XML API. Token format: "apiUser:apiKey"
// Base URL: https://api.namecheap.com/xml.response

import type { ConnectionService, AccountInfo } from './types';
import { fetch } from '@tauri-apps/plugin-http';

const BASE = 'https://api.namecheap.com/xml.response';

/**
 * Namecheap is XML-based, so we parse responses to JSON.
 * Token format expected: "apiUser|apiKey|clientIP"
 * e.g. "myuser|abc123key|1.2.3.4"
 */
function parseToken(token: string): { apiUser: string; apiKey: string; clientIP: string } {
  const parts = token.split('|');
  if (parts.length < 3) {
    throw new Error('Namecheap token format: apiUser|apiKey|yourPublicIP');
  }
  return { apiUser: parts[0], apiKey: parts[1], clientIP: parts[2] };
}

function buildUrl(command: string, token: string, extraParams: Record<string, string> = {}): string {
  const { apiUser, apiKey, clientIP } = parseToken(token);
  const params = new URLSearchParams({
    ApiUser: apiUser,
    ApiKey: apiKey,
    UserName: apiUser,
    ClientIp: clientIP,
    Command: command,
    ...extraParams,
  });
  return `${BASE}?${params}`;
}

/** Simple XML text extraction (no full parser needed for Namecheap) */
function extractXmlValue(xml: string, tag: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'));
  return match ? match[1] : '';
}

function checkXmlError(xml: string): void {
  if (xml.includes('Status="ERROR"')) {
    const errorMsg = extractXmlValue(xml, 'Error') || 'Namecheap API error';
    throw new Error(errorMsg);
  }
}

async function ncFetch(command: string, token: string, extraParams: Record<string, string> = {}): Promise<string> {
  const url = buildUrl(command, token, extraParams);
  const res = await fetch(url);
  const xml = await res.text();
  checkXmlError(xml);
  return xml;
}

const actions: Record<string, (params: any, token: string) => Promise<any>> = {
  async list_domains(params, token) {
    const xml = await ncFetch('namecheap.domains.getList', token);
    // Parse domain list from XML
    const domains: any[] = [];
    const domainMatches = xml.matchAll(/<Domain\s([^>]+)\/>/g);
    for (const match of domainMatches) {
      const attrs = match[1];
      domains.push({
        name: attrs.match(/Name="([^"]+)"/)?.[1],
        expires: attrs.match(/Expires="([^"]+)"/)?.[1],
        isExpired: attrs.match(/IsExpired="([^"]+)"/)?.[1] === 'true',
        autoRenew: attrs.match(/AutoRenew="([^"]+)"/)?.[1] === 'true',
      });
    }
    return domains;
  },

  async get_dns(params, token) {
    const { domain } = params;
    const [sld, tld] = domain.split('.');
    const xml = await ncFetch('namecheap.domains.dns.getHosts', token, { SLD: sld, TLD: tld });
    // Parse host records
    const records: any[] = [];
    const hostMatches = xml.matchAll(/<host\s([^>]+)\/>/gi);
    for (const match of hostMatches) {
      const attrs = match[1];
      records.push({
        hostId: attrs.match(/HostId="([^"]+)"/)?.[1],
        name: attrs.match(/Name="([^"]+)"/)?.[1],
        type: attrs.match(/Type="([^"]+)"/)?.[1],
        address: attrs.match(/Address="([^"]+)"/)?.[1],
        ttl: attrs.match(/TTL="([^"]+)"/)?.[1],
      });
    }
    return records;
  },

  async set_dns(params, token) {
    const { domain, records } = params;
    const [sld, tld] = domain.split('.');
    // records: [{ type: 'A', name: '@', address: '1.2.3.4', ttl: 300 }, ...]
    const extra: Record<string, string> = { SLD: sld, TLD: tld };
    records.forEach((r: any, i: number) => {
      extra[`RecordType${i + 1}`] = r.type;
      extra[`HostName${i + 1}`] = r.name;
      extra[`Address${i + 1}`] = r.address;
      extra[`TTL${i + 1}`] = String(r.ttl || 300);
    });
    return ncFetch('namecheap.domains.dns.setHosts', token, extra);
  },

  async check_availability(params, token) {
    const { domains } = params; // comma-separated domain list
    const xml = await ncFetch('namecheap.domains.check', token, { DomainList: domains });
    const results: any[] = [];
    const matches = xml.matchAll(/<DomainCheckResult\s([^>]+)\/>/g);
    for (const match of matches) {
      const attrs = match[1];
      results.push({
        domain: attrs.match(/Domain="([^"]+)"/)?.[1],
        available: attrs.match(/Available="([^"]+)"/)?.[1] === 'true',
      });
    }
    return results;
  },

  async set_nameservers(params, token) {
    const { domain, nameservers } = params;
    const [sld, tld] = domain.split('.');
    return ncFetch('namecheap.domains.dns.setCustom', token, {
      SLD: sld,
      TLD: tld,
      Nameservers: nameservers.join(','),
    });
  },
};

export const namecheapService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const { apiUser } = parseToken(token);
    // Test by listing domains
    const xml = await ncFetch('namecheap.domains.getList', token);
    const domainCount = (xml.match(/<Domain\s/g) || []).length;

    return {
      id: apiUser,
      name: apiUser,
      extra: {
        domainCount,
      },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string) {
    const handler = actions[action];
    if (!handler) {
      throw new Error(`Unknown Namecheap action: "${action}". Available: ${Object.keys(actions).join(', ')}`);
    }
    return handler(params, token);
  },
};