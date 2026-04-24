// ============================================================
// Vercel Connection Service
// ============================================================
// API docs: https://vercel.com/docs/rest-api
// Token: Access Token from https://vercel.com/account/tokens
// Base URL: https://api.vercel.com

import type { ConnectionService, AccountInfo } from './types';
import { fetch } from '@tauri-apps/plugin-http';

const BASE = 'https://api.vercel.com';

// --------------- Framework Detection / Validation ---------------
// Vercel rejects any framework value not in this set.
// Source: Vercel API error response (v13/deployments, v10/projects).
const VERCEL_ALLOWED_FRAMEWORKS = new Set([
  'blitzjs', 'nextjs', 'gatsby', 'remix', 'react-router', 'astro',
  'hexo', 'eleventy', 'docusaurus-2', 'docusaurus', 'preact',
  'solidstart-1', 'solidstart', 'dojo', 'ember', 'vue', 'scully',
  'ionic-angular', 'angular', 'polymer', 'svelte', 'sveltekit',
  'sveltekit-1', 'ionic-react', 'create-react-app', 'gridsome',
  'umijs', 'sapper', 'saber', 'stencil', 'nuxtjs', 'redwoodjs',
  'hugo', 'jekyll', 'brunch', 'middleman', 'zola', 'hydrogen',
  'vite', 'tanstack-start', 'vitepress', 'vuepress', 'parcel',
  'fastapi', 'flask', 'fasthtml', 'django', 'sanity-v3', 'sanity',
  'storybook', 'nitro', 'hono', 'express', 'h3', 'koa', 'nestjs',
  'elysia', 'fastify', 'xmcp', 'python', 'ruby', 'rust', 'axum',
  'actix-web', 'node', 'go', 'services', 'mastra',
]);

/**
 * Maps commonly detected framework names (from Rust backend, contextService,
 * or AI-provided values) to Vercel's exact allowed strings.
 *
 * Keys are lowercased for case-insensitive matching.
 */
const FRAMEWORK_ALIAS_MAP: Record<string, string> = {
  // JS frameworks
  'next': 'nextjs',
  'next.js': 'nextjs',
  'nextjs': 'nextjs',
  'nuxt': 'nuxtjs',
  'nuxt.js': 'nuxtjs',
  'nuxtjs': 'nuxtjs',
  'nuxt3': 'nuxtjs',
  'gatsby': 'gatsby',
  'remix': 'remix',
  'astro': 'astro',
  'vite': 'vite',
  'vue': 'vue',
  'vue.js': 'vue',
  'vuejs': 'vue',
  'vue-cli': 'vue',
  'svelte': 'svelte',
  'sveltekit': 'sveltekit',
  'svelte-kit': 'sveltekit',
  'angular': 'angular',
  'react': 'vite',          // plain React projects almost always use Vite now
  'react-dom': 'vite',
  'create-react-app': 'create-react-app',
  'cra': 'create-react-app',
  'preact': 'preact',
  'solid': 'solidstart',
  'solidstart': 'solidstart',
  'solid-start': 'solidstart',
  'ember': 'ember',
  'eleventy': 'eleventy',
  '11ty': 'eleventy',
  'hexo': 'hexo',
  'hugo': 'hugo',
  'jekyll': 'jekyll',
  'zola': 'zola',
  'docusaurus': 'docusaurus-2',
  'storybook': 'storybook',
  'blitz': 'blitzjs',
  'blitzjs': 'blitzjs',
  'redwood': 'redwoodjs',
  'redwoodjs': 'redwoodjs',
  'hydrogen': 'hydrogen',
  'vitepress': 'vitepress',
  'vuepress': 'vuepress',
  'parcel': 'parcel',
  'gridsome': 'gridsome',
  'tanstack-start': 'tanstack-start',
  'react-router': 'react-router',

  // Backend frameworks
  'express': 'express',
  'express.js': 'express',
  'fastify': 'fastify',
  'hono': 'hono',
  'koa': 'koa',
  'nestjs': 'nestjs',
  'nest': 'nestjs',
  'elysia': 'elysia',
  'h3': 'h3',
  'nitro': 'nitro',
  'fastapi': 'fastapi',
  'flask': 'flask',
  'django': 'django',
  'sanity': 'sanity-v3',

  // Languages (Vercel serverless)
  'python': 'python',
  'ruby': 'ruby',
  'rust': 'rust',
  'go': 'go',
  'golang': 'go',
  'node': 'node',
  'nodejs': 'node',
  'node.js': 'node',
};

/**
 * Resolve a detected framework string to a valid Vercel framework value.
 * Returns null if the framework can't be mapped — Vercel will auto-detect.
 * This prevents the "projectSettings.framework should be equal to one of
 * the allowed values" API error.
 */
function resolveVercelFramework(detected: string | undefined | null): string | null {
  if (!detected) return null;

  const lower = detected.toLowerCase().trim();

  // Already a valid Vercel value — pass through
  if (VERCEL_ALLOWED_FRAMEWORKS.has(lower)) return lower;

  // Check alias map
  const mapped = FRAMEWORK_ALIAS_MAP[lower];
  if (mapped && VERCEL_ALLOWED_FRAMEWORKS.has(mapped)) return mapped;

  // Unknown — return null so Vercel auto-detects instead of rejecting
  console.warn(
    `[vercel] Unknown framework "${detected}" — skipping (Vercel will auto-detect). ` +
    `Add it to FRAMEWORK_ALIAS_MAP if this is a known framework.`
  );
  return null;
}

/**
 * Build configuration per framework. When deploying SOURCE (not pre-built
 * output), Vercel needs these settings to know how to build the project.
 * Without them, Vercel serves raw .tsx/.vue files → 404.
 */
const FRAMEWORK_BUILD_CONFIG: Record<string, {
  buildCommand: string;
  outputDirectory: string;
  installCommand?: string;
}> = {
  nextjs:            { buildCommand: 'next build',             outputDirectory: '.next'   },
  nuxtjs:            { buildCommand: 'nuxt build',             outputDirectory: '.nuxt'   },
  remix:             { buildCommand: 'remix build',            outputDirectory: 'build'   },
  gatsby:            { buildCommand: 'gatsby build',           outputDirectory: 'public'  },
  sveltekit:         { buildCommand: 'vite build',             outputDirectory: 'build'   },
  astro:             { buildCommand: 'astro build',            outputDirectory: 'dist'    },
  vite:              { buildCommand: 'vite build',             outputDirectory: 'dist'    },
  'create-react-app': { buildCommand: 'react-scripts build',  outputDirectory: 'build'   },
  'react-router':    { buildCommand: 'react-router build',    outputDirectory: 'build'   },
  'tanstack-start':  { buildCommand: 'vinxi build',           outputDirectory: '.output'  },
  vitepress:         { buildCommand: 'vitepress build',       outputDirectory: '.vitepress/dist' },
  vuepress:          { buildCommand: 'vuepress build',        outputDirectory: '.vuepress/dist'  },
  angular:           { buildCommand: 'ng build',              outputDirectory: 'dist'    },
  vue:               { buildCommand: 'vue-cli-service build', outputDirectory: 'dist'    },
  preact:            { buildCommand: 'preact build',          outputDirectory: 'build'   },
  solidstart:        { buildCommand: 'vinxi build',           outputDirectory: '.output'  },
  eleventy:          { buildCommand: 'eleventy',              outputDirectory: '_site'   },
  hexo:              { buildCommand: 'hexo generate',         outputDirectory: 'public'  },
  hugo:              { buildCommand: 'hugo',                  outputDirectory: 'public'  },
  jekyll:            { buildCommand: 'jekyll build',          outputDirectory: '_site'   },
  zola:              { buildCommand: 'zola build',            outputDirectory: 'public'  },
  docusaurus:        { buildCommand: 'docusaurus build',      outputDirectory: 'build'   },
  'docusaurus-2':    { buildCommand: 'docusaurus build',      outputDirectory: 'build'   },
  hydrogen:          { buildCommand: 'shopify hydrogen build', outputDirectory: 'dist'   },
  storybook:         { buildCommand: 'storybook build',       outputDirectory: 'storybook-static' },
  redwoodjs:         { buildCommand: 'rw build',              outputDirectory: 'web/dist' },
  blitzjs:           { buildCommand: 'blitz build',           outputDirectory: '.next'   },
};

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
    const resolvedFw = resolveVercelFramework(framework);
    if (resolvedFw) body.framework = resolvedFw;
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

    // Validate framework in projectSettings before sending to Vercel API
    let sanitizedSettings = projectSettings;
    if (sanitizedSettings?.framework) {
      const resolved = resolveVercelFramework(sanitizedSettings.framework);
      if (resolved) {
        sanitizedSettings = { ...sanitizedSettings, framework: resolved };
      } else {
        const { framework: _invalid, ...rest } = sanitizedSettings;
        sanitizedSettings = Object.keys(rest).length > 0 ? rest : undefined;
      }
    }

    return vFetch('/v13/deployments', token, {
      method: 'POST',
      body: JSON.stringify({
        name,
        files,
        target,
        projectSettings: sanitizedSettings,
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
    const { files, framework, output_dir: outputDir } = payload;

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

    // 4. Assemble project settings.
    //    Two scenarios:
    //    A) output_dir is set → Rust already deployed pre-built files (dist/, build/).
    //       No framework or build settings needed — it's static content.
    //    B) output_dir is null → raw source uploaded. Vercel MUST know the
    //       framework + build command + output dir, otherwise it serves raw
    //       .tsx/.vue files and the user gets a 404.
    let settings = projectSettings;

    if (settings?.framework) {
      // Caller provided explicit settings — validate framework
      const resolved = resolveVercelFramework(settings.framework);
      if (resolved) {
        settings = { ...settings, framework: resolved };
        // Merge build config if deploying source and caller didn't provide build settings
        if (!outputDir && !settings.buildCommand) {
          const buildCfg = FRAMEWORK_BUILD_CONFIG[resolved];
          if (buildCfg) {
            settings = { ...buildCfg, ...settings }; // caller's overrides win
          }
        }
      } else {
        const { framework: _invalid, ...rest } = settings;
        settings = Object.keys(rest).length > 0 ? rest : undefined;
      }
    } else if (!settings && framework) {
      const resolved = resolveVercelFramework(framework);
      if (outputDir) {
        // Pre-built output: skip framework/build settings, serve as static.
        // Setting framework on pre-built files can confuse Vercel into
        // trying to rebuild — which fails because deps aren't uploaded.
        settings = undefined;
      } else if (resolved) {
        // Source deploy: include framework + build config so Vercel builds it.
        const buildCfg = FRAMEWORK_BUILD_CONFIG[resolved] || {};
        settings = { framework: resolved, ...buildCfg };
      }
      // If resolved is null (unknown framework), leave settings undefined
      // and let Vercel auto-detect.
    }

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

  // Fetch build output / event log for a deployment.
  // Returns the raw events array. On build failure the error lines
  // are in events with type 'error' or whose text contains 'Error:'.
  async get_build_logs(params, token) {
    const { deploymentId } = params;
    // Vercel returns newline-delimited JSON objects from this endpoint,
    // not a standard JSON array. We need to parse each line.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);

    try {
      const res = await fetch(`${BASE}/v3/deployments/${deploymentId}/events`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'User-Agent': 'omnirun/1.0.0',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        // Non-fatal: return empty if we can't fetch logs.
        return [];
      }

      const text = await res.text();

      // Try parsing as JSON array first (some Vercel API versions).
      try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return parsed;
        return [parsed];
      } catch {
        // Newline-delimited JSON — parse each line.
        return text
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            try { return JSON.parse(line); }
            catch { return { text: line }; }
          });
      }
    } finally {
      clearTimeout(timeout);
    }
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