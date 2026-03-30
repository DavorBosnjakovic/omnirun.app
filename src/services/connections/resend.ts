// ============================================================
// Resend — Modern Transactional Email
// ============================================================
// Auth: API key via "Authorization: Bearer re_XXXXXX" header
// Base URL: https://api.resend.com
// Docs: https://resend.com/docs/api-reference
// Note: Proxied through Rust (resend_api command) to bypass CORS.

import { invoke } from '@tauri-apps/api/core';
import type { ConnectionService, AccountInfo } from './types';

interface ProxyResponse {
  status: number;
  body: string;
}

async function resendFetch(path: string, apiKey: string, options: RequestInit = {}): Promise<any> {
  const method = (options.method || 'GET').toUpperCase();
  const body = options.body ? String(options.body) : undefined;

  const res = await invoke<ProxyResponse>('resend_api', {
    path,
    token: apiKey,
    method,
    body,
  });

  if (res.status === 204) return { success: true };

  const data = JSON.parse(res.body);

  if (res.status < 200 || res.status >= 300) {
    throw new Error(data.message || `Resend API error ${res.status}`);
  }

  return data;
}

// --------------- Actions ---------------

async function sendEmail(token: string, params: any): Promise<any> {
  const body: any = {
    from: params.from,
    to: Array.isArray(params.to) ? params.to : [params.to],
    subject: params.subject,
  };
  if (params.html) body.html = params.html;
  if (params.text) body.text = params.text;
  if (params.reply_to) body.reply_to = params.reply_to;
  if (params.cc) body.cc = Array.isArray(params.cc) ? params.cc : [params.cc];
  if (params.bcc) body.bcc = Array.isArray(params.bcc) ? params.bcc : [params.bcc];
  if (params.tags) body.tags = params.tags;
  if (params.scheduled_at) body.scheduled_at = params.scheduled_at;
  const result = await resendFetch('/emails', token, { method: 'POST', body: JSON.stringify(body) });
  return { id: result.id, message: 'Email sent successfully' };
}

async function getEmail(token: string, params: any): Promise<any> {
  const email = await resendFetch(`/emails/${params.email_id}`, token);
  return {
    id: email.id, from: email.from, to: email.to,
    subject: email.subject, createdAt: email.created_at, lastEvent: email.last_event,
  };
}

async function listDomains(token: string): Promise<any> {
  const data = await resendFetch('/domains', token);
  return (data.data || []).map((d: any) => ({
    id: d.id, name: d.name, status: d.status,
    region: d.region, createdAt: d.created_at, records: d.records,
  }));
}

async function addDomain(token: string, params: any): Promise<any> {
  const body: any = { name: params.domain };
  if (params.region) body.region = params.region;
  const domain = await resendFetch('/domains', token, { method: 'POST', body: JSON.stringify(body) });
  return {
    id: domain.id, name: domain.name, status: domain.status, records: domain.records,
    message: 'Domain added. Configure the DNS records shown to verify ownership.',
  };
}

async function verifyDomain(token: string, params: any): Promise<any> {
  const result = await resendFetch(`/domains/${params.domain_id}/verify`, token, { method: 'POST' });
  return { id: result.id || params.domain_id, status: result.status || 'verification_requested' };
}

// --------------- Service Export ---------------

export const resendService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const data = await resendFetch('/domains', token);
    const domains = data.data || [];
    const verified = domains.filter((d: any) => d.status === 'verified').length;
    return {
      name: 'Resend Account',
      extra: { verifiedDomainCount: verified, totalDomains: domains.length },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string): Promise<any> {
    switch (action) {
      case 'send_email': return sendEmail(token, params);
      case 'get_email': return getEmail(token, params);
      case 'list_domains': return listDomains(token);
      case 'add_domain': return addDomain(token, params);
      case 'verify_domain': return verifyDomain(token, params);
      default: throw new Error(`Unknown Resend action: ${action}`);
    }
  },
};