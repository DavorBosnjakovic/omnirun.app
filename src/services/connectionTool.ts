// ============================================================
// Connection Tool - AI Meta-Tool Integration
// ============================================================

import { executeProjectProviderAction, isServiceAvailable } from './connections/connectionManager';
import { useConnectionsStore } from '../stores/connectionsStore';
import { useProjectStore } from '../stores/projectStore';
import { PROVIDERS, MVP_PROVIDERS } from './connections/types';
import type { ConnectionProvider } from './connections/types';


// --------------- Tool Definition (add to buildToolsPrompt) ---------------

const ALL_PROVIDER_DOCS: Record<string, string> = {
  github: `### github
- list_repos: List user repos. Params: { sort?, per_page?, page? }
- get_repo: Get repo details. Params: { owner, repo }
- create_repo: Create repo. Params: { name, description?, private?, auto_init? }
- list_branches: Params: { owner, repo }
- create_branch: Params: { owner, repo, branch, from_branch? }
- get_file: Get file. Params: { owner, repo, path, ref? }
- put_file: Create/update file. Params: { owner, repo, path, content, message?, branch?, sha? }
- list_commits: Params: { owner, repo, per_page?, sha? }
- create_pr: Create PR. Params: { owner, repo, title, body?, head, base? }
- list_prs: Params: { owner, repo, state? }
- get_tree: Full file tree. Params: { owner, repo, branch? }`,

  vercel: `### vercel
- list_projects: Params: { limit? }
- get_project: Params: { projectId }
- create_project: Params: { name, framework?, gitRepository? }
- deploy: Deploy files. Params: { name, files: [{file, data}], projectSettings?, target? }
- get_deployment: Params: { deploymentId }
- list_deployments: Params: { projectId, limit?, target? }
- set_env: Set env vars. Params: { projectId, envVars: [{key, value, target}] }
- list_env: Params: { projectId }
- list_domains: Params: { projectId }
- add_domain: Params: { projectId, domain }
- check_domain: Params: { domain }`,

  supabase: `### supabase
- list_projects: List all projects
- get_project: Params: { projectRef }
- create_project: Params: { name, organization_id, region?, db_pass, plan? }
- get_api_keys: Params: { projectRef }
- list_organizations: List orgs
- run_sql: Execute SQL. Params: { projectRef, query }
- list_tables: Params: { projectRef }
- create_table: Params: { projectRef, tableName, columns: [{name, type, primaryKey?, default?, notNull?}] }
- enable_rls: Params: { projectRef, tableName }
- get_settings: Get project URL + keys. Params: { projectRef }`,

  stripe: `### stripe
- list_products: Params: { limit?, active? }
- create_product: Params: { name, description?, metadata? }
- create_price: Params: { product, unit_amount, currency?, recurring? }
- create_checkout: Params: { line_items, mode?, success_url, cancel_url }
- list_customers: Params: { limit?, email? }
- create_customer: Params: { name?, email?, metadata? }
- get_balance: Get account balance`,

  netlify: `### netlify
- list_sites: List all sites
- get_site: Params: { siteId }
- create_site: Params: { name?, custom_domain? }
- list_deploys: Params: { siteId }
- set_env: Params: { siteId, key, values }
- list_env: Params: { siteId }`,

  sendgrid: `### sendgrid
- send_email: Params: { to, from, subject, text?, html? }
- list_templates: Params: { generations? }
- send_template_email: Params: { to, from, template_id, dynamic_template_data }`,

  cloudflare: `### cloudflare
- list_zones: List all zones
- list_dns_records: Params: { zoneId }
- create_dns_record: Params: { zoneId, type, name, content, ttl?, proxied? }
- update_dns_record: Params: { zoneId, recordId, type, name, content }
- delete_dns_record: Params: { zoneId, recordId }
- purge_cache: Params: { zoneId }`,

  namecheap: `### namecheap
- list_domains: List all domains
- get_dns: Get DNS records. Params: { domain }
- set_dns: Set DNS records. Params: { domain, records: [{type, name, address, ttl?}] }
- check_availability: Params: { domains } (comma-separated)
- set_nameservers: Params: { domain, nameservers }`,

  resend: `### resend
- send_email: Send an email. Params: { from, to, subject, html?, text?, reply_to?, cc?, bcc? }
- get_email: Get email details. Params: { email_id }
- list_domains: List verified sending domains
- add_domain: Add a domain. Params: { domain, region? }
- verify_domain: Verify a domain. Params: { domain_id }`,

  bunny: `### bunny
- list_pull_zones: List CDN pull zones
- create_pull_zone: Params: { name, originUrl }
- purge_cache: Params: { pullZoneId }
- list_storage_zones: List storage zones
- upload_file: Params: { storageZoneName, path, content }`,

  godaddy: `### godaddy
- list_domains: List all domains
- get_dns: Get DNS records. Params: { domain, type? }
- set_dns: Set DNS records. Params: { domain, type, records: [{name, data, ttl?}] }`,

  porkbun: `### porkbun
- list_domains: List all domains
- get_dns: Get DNS records. Params: { domain }
- create_dns: Create DNS record. Params: { domain, type, content, name?, ttl? }
- delete_dns: Delete DNS record. Params: { domain, id }`,
};

export function buildConnectionToolPrompt(connectedProviders: string[]): string {
  if (connectedProviders.length === 0) return '';

  const providerList = connectedProviders.join(', ');
  const providerDocs = connectedProviders
    .map((p) => ALL_PROVIDER_DOCS[p])
    .filter(Boolean)
    .join('\n\n');

  return `
## connection
Use this tool to interact with connected external services.
This is a meta-tool — specify the provider, action, and parameters.

**Parameters:**
- provider: string (required) — The service name: ${providerList}
- action: string (required) — The action to perform (varies by provider)
- params: object (optional) — Action-specific parameters

**Available actions by provider:**

${providerDocs}

**IMPORTANT:** Before using any provider, check if it's connected. If not, tell the user to connect it in Settings > Connections.
`;
}

// Keep export for backward compatibility
export const connectionToolPrompt = buildConnectionToolPrompt(Array.from(Object.keys(ALL_PROVIDER_DOCS)));

// --------------- Tool Execution ---------------

/**
 * Execute a connection tool call from the AI.
 * Pass currentProjectId so project-scoped providers use the right credential.
 */
export async function executeConnectionTool(
  toolParams: { provider: string; action: string; params?: Record<string, any> },
  currentProjectId?: string
): Promise<string> {
  const { provider, action, params = {} } = toolParams;

  if (!MVP_PROVIDERS.includes(provider as ConnectionProvider)) {
    return `Error: Unknown provider "${provider}". Available: ${MVP_PROVIDERS.join(', ')}`;
  }

  const p = provider as ConnectionProvider;

  if (!isServiceAvailable(p)) {
    return `Error: ${PROVIDERS[p].name} service is not yet implemented.`;
  }

  const store = useConnectionsStore.getState();
  const projectId = currentProjectId || useProjectStore.getState().currentProject?.id;

  if (!projectId || !store.isProjectConnected(projectId, p)) {
    return `Error: Not connected to ${PROVIDERS[p].name}. Please ask the user to connect it in Settings > Connections.`;
  }

  try {
    const result = await executeProjectProviderAction(projectId, p, action, params);
    const json = JSON.stringify(result, null, 2);
    if (json.length > 10000) {
      return json.slice(0, 10000) + '\n... (truncated)';
    }
    return json;
  } catch (err: any) {
    return `Error: ${err.message || 'Action failed'}`;
  }
}

// --------------- Connected Services Summary ---------------
// Pass currentProjectId so the AI knows which Supabase instance belongs to this project.

export function getConnectionsSummary(currentProjectId?: string): string {
  const store = useConnectionsStore.getState();
  const projectId = currentProjectId || useProjectStore.getState().currentProject?.id;

  if (!projectId) return '';

  const projectConns = store.projectConnections[projectId] || {};
  const lines: string[] = [];

  for (const p of MVP_PROVIDERS) {
    const conn = projectConns[p as ConnectionProvider];
    if (conn?.status === 'connected') {
      const meta = PROVIDERS[p as ConnectionProvider];
      const name = conn.accountInfo?.name || conn.accountInfo?.email || '';
      lines.push(`- ${meta.name}: Connected${name ? ` (${name})` : ''}`);
    }
  }

  if (lines.length === 0) return '';
  return `Connected services:\n${lines.join('\n')}\n\nUse the "connection" tool to interact with these services.`
}