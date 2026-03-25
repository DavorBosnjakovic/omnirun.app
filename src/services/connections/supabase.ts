// ============================================================
// Supabase Connection Service
// ============================================================
// Management API docs: https://supabase.com/docs/reference/api
// Token: Access Token from https://supabase.com/dashboard/account/tokens
// Base URL: https://api.supabase.com

import { invoke } from '@tauri-apps/api/core';
import type { ConnectionService, AccountInfo } from './types';

/**
 * Proxy all Supabase Management API calls through Tauri's Rust backend
 * to avoid CORS blocks (the Management API doesn't set Access-Control headers).
 */
async function sbFetch(path: string, token: string, options: RequestInit = {}) {
  const method = options.method || 'GET';
  const body = options.body ? String(options.body) : null;

  const result = await invoke<{ status: number; body: string }>('supabase_management_api', {
    path,
    token,
    method,
    body,
  });

  if (result.status === 204) return null;

  if (result.status >= 400) {
    let errorBody: any = {};
    try { errorBody = JSON.parse(result.body); } catch {}
    const err: any = new Error(errorBody.message || errorBody.msg || `Supabase API error: ${result.status}`);
    err.status = result.status;
    throw err;
  }

  return JSON.parse(result.body);
}

/**
 * Query a Supabase project's database via PostgREST
 * Requires the project's URL and anon/service key
 */
async function projectQuery(
  projectUrl: string,
  serviceKey: string,
  table: string,
  params: Record<string, string> = {}
) {
  const query = new URLSearchParams(params).toString();
  const url = `${projectUrl}/rest/v1/${table}${query ? '?' + query : ''}`;
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Query error: ${res.status}`);
  }
  return res.json();
}

// --------------- Actions ---------------

const actions: Record<string, (params: any, token: string) => Promise<any>> = {
  // List all projects
  async list_projects(params, token) {
    return sbFetch('/v1/projects', token);
  },

  // Get a single project
  async get_project(params, token) {
    const { projectRef } = params;
    return sbFetch(`/v1/projects/${projectRef}`, token);
  },

  // Create a new project
  async create_project(params, token) {
    const { name, organization_id, region = 'us-east-1', db_pass, plan = 'free' } = params;
    return sbFetch('/v1/projects', token, {
      method: 'POST',
      body: JSON.stringify({ name, organization_id, region, db_pass, plan }),
    });
  },

  // Get project API keys (anon key, service role key)
  async get_api_keys(params, token) {
    const { projectRef } = params;
    return sbFetch(`/v1/projects/${projectRef}/api-keys`, token);
  },

  // List organizations
  async list_organizations(params, token) {
    return sbFetch('/v1/organizations', token);
  },

  // Run SQL on a project
  async run_sql(params, token) {
    const { projectRef, query } = params;
    return sbFetch(`/v1/projects/${projectRef}/database/query`, token, {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  },

  // List tables (via SQL)
  async list_tables(params, token) {
    const { projectRef } = params;
    return sbFetch(`/v1/projects/${projectRef}/database/query`, token, {
      method: 'POST',
      body: JSON.stringify({
        query: `
          SELECT table_name, table_schema
          FROM information_schema.tables
          WHERE table_schema = 'public'
          ORDER BY table_name;
        `,
      }),
    });
  },

  // Create a table (via SQL)
  async create_table(params, token) {
    const { projectRef, tableName, columns } = params;
    // columns: [{ name: 'id', type: 'uuid', primaryKey: true, default: 'gen_random_uuid()' }, ...]
    const colDefs = columns.map((col: any) => {
      let def = `"${col.name}" ${col.type}`;
      if (col.primaryKey) def += ' PRIMARY KEY';
      if (col.default) def += ` DEFAULT ${col.default}`;
      if (col.notNull) def += ' NOT NULL';
      if (col.unique) def += ' UNIQUE';
      return def;
    }).join(', ');

    const query = `CREATE TABLE IF NOT EXISTS public."${tableName}" (${colDefs});`;
    return sbFetch(`/v1/projects/${projectRef}/database/query`, token, {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  },

  // Enable RLS on a table
  async enable_rls(params, token) {
    const { projectRef, tableName } = params;
    const query = `ALTER TABLE public."${tableName}" ENABLE ROW LEVEL SECURITY;`;
    return sbFetch(`/v1/projects/${projectRef}/database/query`, token, {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  },

  // List storage buckets
  async list_buckets(params, token) {
    const { projectRef } = params;
    // This goes through the project's storage API, not management API
    // We'd need the project URL and service key
    return sbFetch(`/v1/projects/${projectRef}/database/query`, token, {
      method: 'POST',
      body: JSON.stringify({
        query: `SELECT * FROM storage.buckets ORDER BY name;`,
      }),
    });
  },

  // Get project settings (URL, keys, etc.)
  async get_settings(params, token) {
    const { projectRef } = params;
    const [project, keys] = await Promise.all([
      sbFetch(`/v1/projects/${projectRef}`, token),
      sbFetch(`/v1/projects/${projectRef}/api-keys`, token),
    ]);
    return {
      ...project,
      api_keys: keys,
      url: `https://${projectRef}.supabase.co`,
    };
  },

  // Pause a project
  async pause_project(params, token) {
    const { projectRef } = params;
    return sbFetch(`/v1/projects/${projectRef}/pause`, token, { method: 'POST' });
  },

  // Resume a project
  async resume_project(params, token) {
    const { projectRef } = params;
    return sbFetch(`/v1/projects/${projectRef}/resume`, token, { method: 'POST' });
  },
};

// --------------- Service Export ---------------

export const supabaseService: ConnectionService = {
  async testConnection(token: string): Promise<AccountInfo> {
    // Supabase management API - list projects to verify token works
    const projects = await sbFetch('/v1/projects', token);
    const orgs = await sbFetch('/v1/organizations', token).catch(() => []);

    return {
      id: orgs?.[0]?.id,
      name: orgs?.[0]?.name || 'Supabase User',
      extra: {
        projectCount: Array.isArray(projects) ? projects.length : 0,
        organizations: orgs,
        projects: Array.isArray(projects)
          ? projects.map((p: any) => ({
              ref: p.id,
              name: p.name,
              region: p.region,
              status: p.status,
            }))
          : [],
      },
    };
  },

  async execute(action: string, params: Record<string, any>, token: string) {
    const handler = actions[action];
    if (!handler) {
      throw new Error(
        `Unknown Supabase action: "${action}". Available: ${Object.keys(actions).join(', ')}`
      );
    }
    return handler(params, token);
  },
};