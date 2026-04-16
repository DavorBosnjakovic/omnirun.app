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

  // Create a deploy by sending a file SHA1 manifest.
  // Netlify responds with `required: [sha1, ...]` — only those need uploading.
  // files param: { 'index.html': 'sha1hash', 'assets/app.js': 'sha1hash', ... }
  async deploy_site(params, token) {
    const { siteId, files, draft = false, async = false } = params;
    return ntlFetch(`/sites/${siteId}/deploys`, token, {
      method: 'POST',
      body: JSON.stringify({ files, draft, async }),
    });
  },

  // Upload one file's raw bytes to an in-progress deploy.
  // Netlify identifies the file by its PATH in the URL (not SHA like Vercel).
  // Params: { deployId, path, contentBase64 }
  async upload_deploy_file(params, token) {
    const { deployId, path, contentBase64 } = params;
    const binary = atob(contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const res = await fetch(`${BASE}/deploys/${deployId}/files/${path}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'User-Agent': 'omnirun/1.0.0',
      },
      body: bytes,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Netlify upload failed: ${res.status}`);
    }
    return res.json();
  },

  // High-level: deploy an entire project folder in one call.
  // Creates a site if siteId is not provided.
  // Params: { projectPath, siteId?, siteName? }
  async deploy_folder(params, token) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { projectPath, siteName } = params;
    let { siteId } = params;

    // 1. Read the project folder via Rust.
    const payload: any = await invoke('read_project_for_deploy', { projectPath });
    const files: Array<{ path: string; sha1: string; size: number; content_base64: string }> =
      payload.files;

    // 2. Create a new site if none was provided.
    if (!siteId) {
      const site = await actions.create_site({ name: siteName }, token);
      siteId = site.id;
    }

    // 3. Build the SHA1 manifest Netlify expects: { "/path": "sha1", ... }
    const manifest: Record<string, string> = {};
    for (const f of files) {
      manifest[`/${f.path}`] = f.sha1;
    }

    // 4. Create the deploy — Netlify returns `required` (array of SHAs to upload).
    const deploy: any = await actions.deploy_site(
      { siteId, files: manifest, async: false },
      token
    );

    // 5. Upload only the files Netlify doesn't already have.
    const required: string[] = deploy.required || [];
    const requiredSet = new Set(required);
    for (const f of files) {
      if (requiredSet.has(f.sha1)) {
        await actions.upload_deploy_file(
          { deployId: deploy.id, path: f.path, contentBase64: f.content_base64 },
          token
        );
      }
    }

    // 6. Return the deploy object (caller polls state via get_deploy / list_deploys).
    return { ...deploy, site_id: siteId };
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