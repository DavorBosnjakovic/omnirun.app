// ============================================================
// Bunny.net — CDN, Edge Storage, DNS
// ============================================================
// Auth: API key via AccessKey header
// Base URL: https://api.bunny.net
// Storage: https://{region}.storage.bunnycdn.com
// Docs: https://docs.bunny.net/reference/bunnynet-api-overview

import type { ConnectionService, AccountInfo } from './types';
import { fetch } from '@tauri-apps/plugin-http';

const BASE_URL = 'https://api.bunny.net';

const STORAGE_REGIONS: Record<string, string> = {
  de: 'storage.bunnycdn.com',
  ny: 'ny.storage.bunnycdn.com',
  la: 'la.storage.bunnycdn.com',
  sg: 'sg.storage.bunnycdn.com',
  syd: 'syd.storage.bunnycdn.com',
  uk: 'uk.storage.bunnycdn.com',
  se: 'se.storage.bunnycdn.com',
  br: 'br.storage.bunnycdn.com',
  jh: 'jh.storage.bunnycdn.com',
};

async function bunnyFetch(path: string, apiKey: string, options: RequestInit = {}): Promise<any> {
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      AccessKey: apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bunny API error ${res.status}: ${text}`);
  }
  if (res.status === 204 || !res.headers.get('content-type')?.includes('application/json')) {
    return { success: true };
  }
  return res.json();
}

// --------------- Actions ---------------

async function listPullZones(token: string): Promise<any> {
  const data = await bunnyFetch('/pullzone', token);
  const zones = data.Items || data;
  return zones.map((z: any) => ({
    id: z.Id,
    name: z.Name,
    hostname: z.Hostnames?.[0]?.Value || `${z.Name}.b-cdn.net`,
    originUrl: z.OriginUrl,
    enabled: z.Enabled,
    monthlyBandwidth: z.MonthlyBandwidthUsed,
  }));
}

async function createPullZone(token: string, params: any): Promise<any> {
  const body: any = { Name: params.name, OriginUrl: params.origin_url };
  if (params.type) body.Type = params.type === 'premium' ? 1 : 0;
  if (params.storage_zone_id) body.StorageZoneId = params.storage_zone_id;
  const zone = await bunnyFetch('/pullzone', token, { method: 'POST', body: JSON.stringify(body) });
  return { id: zone.Id, name: zone.Name, hostname: `${zone.Name}.b-cdn.net`, originUrl: zone.OriginUrl };
}

async function purgeCache(token: string, params: any): Promise<any> {
  if (params.url) {
    await bunnyFetch('/purge', token, { method: 'POST', body: JSON.stringify({ url: params.url }) });
    return { purged: params.url };
  }
  await bunnyFetch(`/pullzone/${params.pull_zone_id}/purgeCache`, token, { method: 'POST' });
  return { purged: `entire zone ${params.pull_zone_id}` };
}

async function listStorageZones(token: string): Promise<any> {
  const data = await bunnyFetch('/storagezone', token);
  const zones = data.Items || data;
  return zones.map((z: any) => ({
    id: z.Id, name: z.Name, region: z.Region,
    filesStored: z.FilesStored, storageUsed: z.StorageUsed,
    pullZones: z.PullZones?.map((pz: any) => pz.Name) || [],
  }));
}

async function listFiles(token: string, params: any): Promise<any> {
  const { storage_zone, path = '/', region = 'de' } = params;
  const host = STORAGE_REGIONS[region] || STORAGE_REGIONS.de;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const storagePassword = params.storage_password || token;
  const files = await bunnyFetch(`https://${host}/${storage_zone}${cleanPath}`, storagePassword);
  return (Array.isArray(files) ? files : []).map((f: any) => ({
    name: f.ObjectName, path: f.Path, isDirectory: f.IsDirectory,
    size: f.Length, lastChanged: f.LastChanged,
  }));
}

async function uploadFile(token: string, params: any): Promise<any> {
  const { storage_zone, path, content, region = 'de' } = params;
  const host = STORAGE_REGIONS[region] || STORAGE_REGIONS.de;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const storagePassword = params.storage_password || token;
  await fetch(`https://${host}/${storage_zone}${cleanPath}`, {
    method: 'PUT',
    headers: { AccessKey: storagePassword, 'Content-Type': 'application/octet-stream' },
    body: content,
  });
  return { uploaded: `${storage_zone}${cleanPath}` };
}

async function deleteFile(token: string, params: any): Promise<any> {
  const { storage_zone, path, region = 'de' } = params;
  const host = STORAGE_REGIONS[region] || STORAGE_REGIONS.de;
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const storagePassword = params.storage_password || token;
  await fetch(`https://${host}/${storage_zone}${cleanPath}`, {
    method: 'DELETE',
    headers: { AccessKey: storagePassword },
  });
  return { deleted: `${storage_zone}${cleanPath}` };
}

async function listDnsZones(token: string): Promise<any> {
  const data = await bunnyFetch('/dnszone', token);
  const zones = data.Items || data;
  return zones.map((z: any) => ({ id: z.Id, domain: z.Domain, records: z.Records?.length || 0 }));
}

async function createDnsRecord(token: string, params: any): Promise<any> {
  const { zone_id, type, name, value, ttl = 300, priority } = params;
  const typeMap: Record<string, number> = { A: 0, AAAA: 1, CNAME: 2, TXT: 3, MX: 4, NS: 6, SRV: 8, CAA: 9 };
  const body: any = { Type: typeMap[type.toUpperCase()] ?? 0, Name: name || '', Value: value, Ttl: ttl };
  if (priority !== undefined) body.Priority = priority;
  const record = await bunnyFetch(`/dnszone/${zone_id}/records`, token, { method: 'PUT', body: JSON.stringify(body) });
  return { id: record.Id, type, name, value, ttl };
}

async function deleteDnsRecord(token: string, params: any): Promise<any> {
  await bunnyFetch(`/dnszone/${params.zone_id}/records/${params.record_id}`, token, { method: 'DELETE' });
  return { deleted: params.record_id };
}

// --------------- Service Export ---------------

export const bunnyService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const data = await bunnyFetch('/pullzone?page=1&perPage=1', token);
    const storageData = await bunnyFetch('/storagezone?page=1&perPage=1', token);
    const pullZoneCount = data.TotalItems || 0;
    const storageZoneCount = storageData.TotalItems || 0;
    return {
      name: 'Bunny.net Account',
      extra: { pullZoneCount, storageZoneCount },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string): Promise<any> {
    switch (action) {
      case 'list_pull_zones': return listPullZones(token);
      case 'create_pull_zone': return createPullZone(token, params);
      case 'purge_cache': return purgeCache(token, params);
      case 'list_storage_zones': return listStorageZones(token);
      case 'list_files': return listFiles(token, params);
      case 'upload_file': return uploadFile(token, params);
      case 'delete_file': return deleteFile(token, params);
      case 'list_dns_zones': return listDnsZones(token);
      case 'create_dns_record': return createDnsRecord(token, params);
      case 'delete_dns_record': return deleteDnsRecord(token, params);
      default: throw new Error(`Unknown Bunny action: ${action}`);
    }
  },
};