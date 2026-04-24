// ============================================================
// SendGrid Connection Service
// ============================================================
// API docs: https://docs.sendgrid.com/api-reference
// Token: API Key from https://app.sendgrid.com/settings/api_keys
// Base URL: https://api.sendgrid.com/v3

import type { ConnectionService, AccountInfo } from './types';
import { fetch } from '@tauri-apps/plugin-http';

const BASE = 'https://api.sendgrid.com/v3';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'omnirun/1.0.0',
  };
}

async function sgFetch(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(token), ...options.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body.errors?.[0]?.message || `SendGrid API error: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 202 || res.status === 204) return { success: true };
  return res.json();
}

const actions: Record<string, (params: any, token: string) => Promise<any>> = {
  async send_email(params, token) {
    const { to, from, subject, text, html } = params;
    const content = [];
    if (text) content.push({ type: 'text/plain', value: text });
    if (html) content.push({ type: 'text/html', value: html });
    return sgFetch('/mail/send', token, {
      method: 'POST',
      body: JSON.stringify({
        personalizations: [{ to: Array.isArray(to) ? to.map((e: string) => ({ email: e })) : [{ email: to }] }],
        from: typeof from === 'string' ? { email: from } : from,
        subject,
        content,
      }),
    });
  },

  async list_templates(params, token) {
    const { generations = 'dynamic' } = params;
    return sgFetch(`/templates?generations=${generations}`, token);
  },

  async send_template_email(params, token) {
    const { to, from, template_id, dynamic_template_data } = params;
    return sgFetch('/mail/send', token, {
      method: 'POST',
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }], dynamic_template_data }],
        from: typeof from === 'string' ? { email: from } : from,
        template_id,
      }),
    });
  },

  async list_senders(params, token) {
    return sgFetch('/verified_senders', token);
  },

  async get_stats(params, token) {
    const { start_date } = params;
    return sgFetch(`/stats?start_date=${start_date || '2024-01-01'}`, token);
  },
};

export const sendgridService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const user = await sgFetch('/user/profile', token);
    return {
      id: user.username,
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username,
      email: user.email,
      extra: { company: user.company, website: user.website },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string) {
    const handler = actions[action];
    if (!handler) {
      throw new Error(`Unknown SendGrid action: "${action}". Available: ${Object.keys(actions).join(', ')}`);
    }
    return handler(params, token);
  },
};