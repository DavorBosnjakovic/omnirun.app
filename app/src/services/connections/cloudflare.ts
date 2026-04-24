// ============================================================
// Cloudflare Connection Service
// ============================================================
// API docs: https://developers.cloudflare.com/api/
// Token: API Token from https://dash.cloudflare.com/profile/api-tokens
// Base URL: https://api.cloudflare.com/client/v4

import type { ConnectionService, AccountInfo } from './types';
import { fetch } from '@tauri-apps/plugin-http';
import { blake3 } from 'hash-wasm';

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

// ─── Cloudflare Pages direct-upload hash ───
// Format REQUIRED by Cloudflare: blake3(base64Content + extensionNoDot), hex, first 32 chars.
// SHA1 / arbitrary keys will "upload" (API returns 200) but the edge CDN
// can't resolve the manifest → every request returns HTTP 500.
async function computePagesHash(contentBase64: string, path: string): Promise<string> {
  const dotIdx = path.lastIndexOf('.');
  const slashIdx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  const ext = dotIdx > slashIdx ? path.slice(dotIdx + 1) : '';
  const hex = await blake3(contentBase64 + ext);
  return hex.slice(0, 32);
}

const actions: Record<string, (params: any, token: string) => Promise<any>> = {
  async list_accounts(params, token) {
    return cfFetch('/accounts', token);
  },

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

  // --- Cloudflare Pages: Projects ---

  async list_pages_projects(params, token) {
    const { accountId } = params;
    return cfFetch(`/accounts/${accountId}/pages/projects`, token);
  },

  async get_pages_project(params, token) {
    const { accountId, projectName } = params;
    return cfFetch(`/accounts/${accountId}/pages/projects/${projectName}`, token);
  },

  // Create a Pages project for direct uploads (no Git integration).
  // production_branch is required by the API but meaningless for direct uploads.
  async create_pages_project(params, token) {
    const { accountId, name, productionBranch = 'main' } = params;
    return cfFetch(`/accounts/${accountId}/pages/projects`, token, {
      method: 'POST',
      body: JSON.stringify({
        name,
        production_branch: productionBranch,
      }),
    });
  },

  // --- Cloudflare Pages: Direct Upload ---

  // Ask Cloudflare which file hashes it DOESN'T already have.
  // Send the full list of hashes for this deploy; CF replies with the missing ones.
  // Params: { jwt, hashes: string[] }  (jwt obtained from get_pages_upload_jwt)
  async check_missing_pages_hashes(params, token) {
    const { jwt, hashes } = params;
    const res = await fetch(`${BASE}/pages/assets/check-missing`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'User-Agent': 'omnirun/1.0.0',
      },
      body: JSON.stringify({ hashes }),
    });
    const body = await res.json();
    if (!body.success) {
      const msg = body.errors?.[0]?.message || `CF check-missing failed: ${res.status}`;
      throw new Error(msg);
    }
    return body.result as string[];
  },

  // Get a short-lived JWT for uploading assets to a Pages project.
  // Params: { accountId, projectName }
  async get_pages_upload_jwt(params, token) {
    const { accountId, projectName } = params;
    const result = await cfFetch(
      `/accounts/${accountId}/pages/projects/${projectName}/upload-token`,
      token
    );
    return result.jwt as string;
  },

  // Upload a batch of files to Cloudflare's asset store.
  // Params: { jwt, payload: [{ key: hash, value: base64, metadata: { contentType }, base64: true }, ...] }
  async upload_pages_files(params, token) {
    const { jwt, payload } = params;
    const res = await fetch(`${BASE}/pages/assets/upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'User-Agent': 'omnirun/1.0.0',
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!body.success) {
      const msg = body.errors?.[0]?.message || `CF upload failed: ${res.status}`;
      throw new Error(msg);
    }
    return body.result;
  },

  // REQUIRED between upload and deployment.
  // Registers the full hash set against the deployment's asset bundle.
  // Without this, the edge CDN's manifest lookups fail → HTTP 500 on every request.
  // Params: { jwt, hashes: string[] }
  async upsert_pages_hashes(params, token) {
    const { jwt, hashes } = params;
    const res = await fetch(`${BASE}/pages/assets/upsert-hashes`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'User-Agent': 'omnirun/1.0.0',
      },
      body: JSON.stringify({ hashes }),
    });
    const body = await res.json();
    if (!body.success) {
      const msg = body.errors?.[0]?.message || `CF upsert-hashes failed: ${res.status}`;
      throw new Error(msg);
    }
    return body.result;
  },

  // Finalize a deployment: tell CF which files (by hash) make up this deploy
  // and which paths they map to. CF builds the site from the asset store.
  // Params: { accountId, projectName, manifest: { '/index.html': 'hash', ... }, branch? }
  async create_pages_deployment(params, token) {
    const { accountId, projectName, manifest, branch = 'main' } = params;

    // This endpoint is multipart/form-data, not JSON.
    const form = new FormData();
    form.append('manifest', JSON.stringify(manifest));
    form.append('branch', branch);

    const res = await fetch(
      `${BASE}/accounts/${accountId}/pages/projects/${projectName}/deployments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'omnirun/1.0.0',
          // NOTE: no Content-Type — browser sets multipart boundary automatically
        },
        body: form,
      }
    );
    const body = await res.json();
    if (!body.success) {
      const msg = body.errors?.[0]?.message || `CF deployment failed: ${res.status}`;
      throw new Error(msg);
    }
    return body.result;
  },

  // High-level: deploy an entire project folder to Cloudflare Pages.
  // Creates the Pages project if it doesn't exist.
  // Params: { projectPath, accountId, projectName, branch? }
  async deploy_folder(params, token) {
    const { invoke } = await import('@tauri-apps/api/core');
    const { projectPath, accountId, projectName, branch = 'main' } = params;

    // 1. Read the project folder via Rust.
    //    We use only path + content_base64 — the hash field from Rust (if any)
    //    is IGNORED because CF requires a specific blake3-based format.
    const payload: any = await invoke('read_project_for_deploy', { projectPath });
    const rawFiles: Array<{ path: string; content_base64: string }> = payload.files;

    // 2. Compute the correct Cloudflare Pages hash for each file.
    const files = await Promise.all(
      rawFiles.map(async (f) => ({
        path: f.path,
        content_base64: f.content_base64,
        hash: await computePagesHash(f.content_base64, f.path),
      }))
    );

    // 3. Make sure the Pages project exists (create if not).
    try {
      await actions.get_pages_project({ accountId, projectName }, token);
    } catch (err: any) {
      if (err.status === 404 || String(err.message).includes('not found')) {
        await actions.create_pages_project(
          { accountId, name: projectName, productionBranch: branch },
          token
        );
      } else {
        throw err;
      }
    }

    // 4. Get an upload JWT.
    const jwt = await actions.get_pages_upload_jwt({ accountId, projectName }, token);

    // 5. Ask CF which file hashes are missing.
    const allHashes = [...new Set(files.map((f) => f.hash))];
    const missing = await actions.check_missing_pages_hashes({ jwt, hashes: allHashes }, token);
    const missingSet = new Set(missing);

    // 6. Upload only the missing files, in batches of 50.
    if (missingSet.size > 0) {
      const uploadPayload = files
        .filter((f) => missingSet.has(f.hash))
        .map((f) => ({
          key: f.hash,
          value: f.content_base64,
          metadata: { contentType: guessContentType(f.path) },
          base64: true,
        }));

      for (let i = 0; i < uploadPayload.length; i += 50) {
        const batch = uploadPayload.slice(i, i + 50);
        await actions.upload_pages_files({ jwt, payload: batch }, token);
      }
    }

    // 7. Register the full hash set against this deployment.
    //    Skipping this is what caused the HTTP 500 on the live URL.
    await actions.upsert_pages_hashes({ jwt, hashes: allHashes }, token);

    // 8. Build the manifest: { '/path/to/file': 'hash' }
    const manifest: Record<string, string> = {};
    for (const f of files) {
      manifest[`/${f.path}`] = f.hash;
    }

    // 9. Create the deployment.
    return actions.create_pages_deployment(
      { accountId, projectName, manifest, branch },
      token
    );
  },
};

// --- Helpers ---------------------------------------------------

function guessContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
    json: 'application/json',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    ico: 'image/x-icon',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ttf: 'font/ttf',
    otf: 'font/otf',
    txt: 'text/plain',
    xml: 'application/xml',
    pdf: 'application/pdf',
    map: 'application/json',
  };
  return (ext && map[ext]) || 'application/octet-stream';
}

export const cloudflareService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const verify = await cfFetch('/user/tokens/verify', token);
    const user = await cfFetch('/user', token);

    // Resolve the account ID that Pages/Workers need.
    // Strategy: /accounts → /zones → user.organizations (which ARE accounts in CF's API)
    let accountId: string | undefined;
    try {
      const accounts = await cfFetch('/accounts', token);
      accountId = accounts?.[0]?.id;
    } catch {
      // No Account:Read permission
    }
    if (!accountId) {
      try {
        const zones = await cfFetch('/zones', token);
        accountId = zones?.[0]?.account?.id;
      } catch {
        // No zones
      }
    }
    if (!accountId && Array.isArray(user.organizations) && user.organizations.length > 0) {
      accountId = user.organizations[0].id;
    }

    return {
      id: accountId || user.id,
      name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email,
      email: user.email,
      extra: {
        tokenStatus: verify.status,
        organizations: user.organizations,
        accountId,
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