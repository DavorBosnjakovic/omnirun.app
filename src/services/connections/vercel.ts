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

  // Create a new project
  async create_project(params, token) {
    const { name, framework, gitRepository } = params;
    const body: any = { name };
    if (framework) body.framework = framework; // nextjs, vite, etc.
    if (gitRepository) body.gitRepository = gitRepository; // { type: 'github', repo: 'owner/repo' }
    return vFetch('/v10/projects', token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // Deploy a project (file-based deployment)
  async deploy(params, token) {
    const { name, files, projectSettings, target = 'production' } = params;
    // files: [{ file: 'index.html', data: '...' }, ...]
    // Convert file data to base64 if not already
    const deployFiles = files.map((f: any) => ({
      file: f.file,
      data: f.data, // should be file content string
    }));

    return vFetch('/v13/deployments', token, {
      method: 'POST',
      body: JSON.stringify({
        name,
        files: deployFiles,
        target,
        projectSettings,
      }),
    });
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