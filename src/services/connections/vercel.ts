// ============================================================
// Vercel Connection Service
// ============================================================
// API docs: https://vercel.com/docs/rest-api
// Token: Access Token from https://vercel.com/account/tokens
// Base URL: https://api.vercel.com

import type { ConnectionService, AccountInfo } from './types';

const BASE = 'https://api.vercel.com';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'User-Agent': 'omnirun/1.0.0',
  };
}

async function vFetch(path: string, token: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { ...headers(token), ...options.headers },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err: any = new Error(body.error?.message || `Vercel API error: ${res.status}`);
      err.status = res.status;
      throw err;
    }

    // Some Vercel endpoints return 204 No Content
    if (res.status === 204) return null;
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// --------------- Actions ---------------

const actions: Record<string, (params: any, token: string) => Promise<any>> = {
  // List all projects
  async list_projects(params, token) {
    const { limit = 20 } = params;
    return vFetch(`/v9/projects?limit=${limit}`, token);
  },

  // Get a single project
  async get_project(params, token) {
    const { projectId } = params;
    return vFetch(`/v9/projects/${projectId}`, token);
  },

  // Create a new project (gitless — OmniRun deploys directly, no GitHub link)
  async create_project(params, token) {
    const { name, framework } = params;
    const body: any = { name };
    if (framework) body.framework = framework; // nextjs, vite, etc.
    return vFetch('/v10/projects', token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // Upload a single file to Vercel by SHA1 digest.
  // Must be called for every file BEFORE deploy().
  // Vercel stores the file keyed by its SHA1 and references it in the deploy.
  async upload_file(params, token) {
    const { sha1, contentBase64, size } = params;
    // Decode base64 → raw bytes for the request body.
    const binary = atob(contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const res = await fetch(`${BASE}/v2/files`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'x-vercel-digest': sha1,
        'Content-Length': String(size),
        'User-Agent': 'omnirun/1.0.0',
      },
      body: bytes,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error?.message || `Vercel upload failed: ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  },

  // Create a deployment from already-uploaded files (referenced by SHA).
  // Call upload_file for each file first, then call this.
  async deploy(params, token) {
    const { name, files, projectSettings, target = 'production', project } = params;
    // files: [{ file: 'index.html', sha: 'abc123...', size: 1234 }, ...]
    return vFetch('/v13/deployments', token, {
      method: 'POST',
      body: JSON.stringify({
        name,
        files,
        target,
        projectSettings,
        ...(project ? { project } : {}),
      }),
    });
  },

  // High-level: deploy an entire project folder in one call.
  // Reads files via the Tauri deploy command, uploads each one,
  // then creates the deployment. Returns the deployment object
  // (use get_deployment to poll status).
  //
  // Params:
  //   projectPath    - local folder to deploy
  //   name           - project name (used when creating a new project)
  //   vercelProjectId - OPTIONAL: existing Vercel project ID to deploy TO.
  //                     When provided, deployment is linked to that project
  //                     (domains, env vars, deployment history all preserved).
  //                     When omitted, a new Vercel project is created.
  //   target         - 'production' | 'preview' (default 'production')
  //   projectSettings - optional framework/build overrides
  async deploy_folder(params, token) {
    const { invoke } = await import('@tauri-apps/api/core');
    const {
      projectPath,
      name,
      vercelProjectId,
      target = 'production',
      projectSettings,
    } = params;

    // 1. Ask Rust to read the project folder.
    const payload: any = await invoke('read_project_for_deploy', { projectPath });
    const { files, framework } = payload;

    // 2. Upload every file by SHA. Emit progress via globalThis so
    //    deploymentService can surface a "3 / 47 files" counter.
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      await actions.upload_file(
        { sha1: f.sha1, contentBase64: f.content_base64, size: f.size },
        token
      );
      const emit = (globalThis as any).__omnirunUploadProgress;
      if (typeof emit === 'function') emit(i + 1, files.length);
    }

    // 3. Build the deployment manifest (Vercel expects file+sha+size).
    const manifest = files.map((f: any) => ({
      file: f.path,
      sha: f.sha1,
      size: f.size,
    }));

    // 4. Default project settings from detected framework if none provided.
    const settings = projectSettings ?? (framework ? { framework } : undefined);

    // 5. Create the deployment — link to existing project if ID was passed.
    const deployment = await actions.deploy(
      {
        name,
        files: manifest,
        target,
        projectSettings: settings,
        project: vercelProjectId, // links to existing project when provided
      },
      token
    );

    // 6. If we deployed to an existing project, check for custom domains
    //    attached to it and prefer those over the auto-generated vercel.app URL.
    if (vercelProjectId) {
      try {
        const domains: any = await actions.list_domains({ projectId: vercelProjectId }, token);
        const domainList: any[] = domains?.domains ?? domains ?? [];
        const verifiedCustom = domainList.find(
          (d: any) => d.verified && !d.name?.endsWith('.vercel.app')
        );
        if (verifiedCustom?.name) {
          deployment.url = verifiedCustom.name;
          deployment.customDomain = verifiedCustom.name;
        }
      } catch {
        // non-fatal — fall back to deployment.url as returned
      }
    }

    return deployment;
  },

  // Get deployment status
  async get_deployment(params, token) {
    const { deploymentId } = params;
    return vFetch(`/v13/deployments/${deploymentId}`, token);
  },

  // List deployments for a project
  async list_deployments(params, token) {
    const { projectId, limit = 10, target } = params;
    let url = `/v6/deployments?projectId=${projectId}&limit=${limit}`;
    if (target) url += `&target=${target}`;
    return vFetch(url, token);
  },

  // Set environment variables
  async set_env(params, token) {
    const { projectId, envVars } = params;
    // envVars: [{ key: 'DB_URL', value: '...', target: ['production', 'preview'] }]
    return vFetch(`/v10/projects/${projectId}/env`, token, {
      method: 'POST',
      body: JSON.stringify(envVars),
    });
  },

  // List environment variables
  async list_env(params, token) {
    const { projectId } = params;
    return vFetch(`/v9/projects/${projectId}/env`, token);
  },

  // Delete environment variable
  async delete_env(params, token) {
    const { projectId, envId } = params;
    return vFetch(`/v9/projects/${projectId}/env/${envId}`, token, {
      method: 'DELETE',
    });
  },

  // List domains for a project
  async list_domains(params, token) {
    const { projectId } = params;
    return vFetch(`/v9/projects/${projectId}/domains`, token);
  },

  // Add a domain to a project
  async add_domain(params, token) {
    const { projectId, domain } = params;
    return vFetch(`/v10/projects/${projectId}/domains`, token, {
      method: 'POST',
      body: JSON.stringify({ name: domain }),
    });
  },

  // Remove a domain
  async remove_domain(params, token) {
    const { projectId, domain } = params;
    return vFetch(`/v9/projects/${projectId}/domains/${domain}`, token, {
      method: 'DELETE',
    });
  },

  // Check domain config (DNS verification)
  async check_domain(params, token) {
    const { domain } = params;
    return vFetch(`/v6/domains/${domain}/config`, token);
  },

  // Get user's teams
  async list_teams(params, token) {
    return vFetch('/v2/teams', token);
  },
};

// --------------- Service Export ---------------

export const vercelService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const user = await vFetch('/v2/user', token);
    return {
      id: user.user?.id || user.id,
      name: user.user?.name || user.user?.username,
      email: user.user?.email,
      avatar: user.user?.avatar,
      extra: {
        username: user.user?.username,
        softBlock: user.user?.softBlock,
      },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string) {
    const handler = actions[action];
    if (!handler) {
      throw new Error(
        `Unknown Vercel action: "${action}". Available: ${Object.keys(actions).join(', ')}`
      );
    }
    return handler(params, token);
  },
};