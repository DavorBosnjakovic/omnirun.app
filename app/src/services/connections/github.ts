// ============================================================
// GitHub Connection Service
// ============================================================
// API docs: https://docs.github.com/en/rest
// Token: Personal Access Token (fine-grained or classic)
// Base URL: https://api.github.com

import type { ConnectionService, AccountInfo } from './types';
import { fetch } from '@tauri-apps/plugin-http';

const BASE = 'https://api.github.com';

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'omnirun/1.0.0',
  };
}

async function ghFetch(path: string, token: string, options: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { ...headers(token), ...options.headers },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body.message || `GitHub API error: ${res.status}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

// --------------- Actions ---------------

const actions: Record<string, (params: any, token: string) => Promise<any>> = {
  // List user's repos
  async list_repos(params, token) {
    const { sort = 'updated', per_page = 30, page = 1 } = params;
    return ghFetch(`/user/repos?sort=${sort}&per_page=${per_page}&page=${page}`, token);
  },

  // Get a single repo
  async get_repo(params, token) {
    const { owner, repo } = params;
    return ghFetch(`/repos/${owner}/${repo}`, token);
  },

  // Create a new repo
  async create_repo(params, token) {
    const { name, description = '', private: isPrivate = true, auto_init = true } = params;
    return ghFetch('/user/repos', token, {
      method: 'POST',
      body: JSON.stringify({ name, description, private: isPrivate, auto_init }),
    });
  },

  // List branches
  async list_branches(params, token) {
    const { owner, repo } = params;
    return ghFetch(`/repos/${owner}/${repo}/branches`, token);
  },

  // Create a branch
  async create_branch(params, token) {
    const { owner, repo, branch, from_branch = 'main' } = params;
    // Get the SHA of the source branch
    const ref = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${from_branch}`, token);
    return ghFetch(`/repos/${owner}/${repo}/git/refs`, token, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: ref.object.sha }),
    });
  },

  // Get file contents
  async get_file(params, token) {
    const { owner, repo, path, ref } = params;
    const query = ref ? `?ref=${ref}` : '';
    return ghFetch(`/repos/${owner}/${repo}/contents/${path}${query}`, token);
  },

  // Create or update a file
  async put_file(params, token) {
    const { owner, repo, path, content, message, branch, sha } = params;
    const encoded = btoa(unescape(encodeURIComponent(content)));
    const body: any = { message: message || `Update ${path}`, content: encoded };
    if (branch) body.branch = branch;
    if (sha) body.sha = sha; // required for updates
    return ghFetch(`/repos/${owner}/${repo}/contents/${path}`, token, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },

  // List commits
  async list_commits(params, token) {
    const { owner, repo, per_page = 10, sha } = params;
    const query = sha ? `?per_page=${per_page}&sha=${sha}` : `?per_page=${per_page}`;
    return ghFetch(`/repos/${owner}/${repo}/commits${query}`, token);
  },

  // Create a pull request
  async create_pr(params, token) {
    const { owner, repo, title, body = '', head, base = 'main' } = params;
    return ghFetch(`/repos/${owner}/${repo}/pulls`, token, {
      method: 'POST',
      body: JSON.stringify({ title, body, head, base }),
    });
  },

  // List pull requests
  async list_prs(params, token) {
    const { owner, repo, state = 'open' } = params;
    return ghFetch(`/repos/${owner}/${repo}/pulls?state=${state}`, token);
  },

  // Get repo tree (for full file listing)
  async get_tree(params, token) {
    const { owner, repo, branch = 'main' } = params;
    return ghFetch(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, token);
  },
};

// --------------- Service Export ---------------

export const githubService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    const user = await ghFetch('/user', token);
    return {
      id: String(user.id),
      name: user.name || user.login,
      email: user.email,
      avatar: user.avatar_url,
      plan: user.plan?.name,
      extra: {
        login: user.login,
        public_repos: user.public_repos,
        private_repos: user.total_private_repos,
        url: user.html_url,
      },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string) {
    const handler = actions[action];
    if (!handler) {
      throw new Error(
        `Unknown GitHub action: "${action}". Available: ${Object.keys(actions).join(', ')}`
      );
    }
    return handler(params, token);
  },
};