// ============================================================
// Connection Tool - AI Meta-Tool Integration
// ============================================================
// This integrates with your existing toolService.ts.
// Instead of 50+ individual tools, the AI gets ONE tool per service.
//
// Add this to your toolService.ts tool definitions and execution logic.
// Example AI usage:
//   <tool_call>{"tool": "connection", "params": {"provider": "vercel", "action": "list_projects", "params": {}}}</tool_call>

import { executeProviderAction, isServiceAvailable } from './connections/connectionManager';
import { useConnectionsStore } from '../stores/connectionsStore';
import { PROVIDERS, MVP_PROVIDERS } from './connections/types';
import type { ConnectionProvider } from './connections/types';

// --------------- Tool Definition (add to buildToolsPrompt) ---------------

export const connectionToolPrompt = `
## connection
Use this tool to interact with connected external services (Vercel, GitHub, Supabase, Stripe, etc.).
This is a meta-tool — specify the provider, action, and parameters.

**Parameters:**
- provider: string (required) — The service name: ${MVP_PROVIDERS.join(', ')}
- action: string (required) — The action to perform (varies by provider)
- params: object (optional) — Action-specific parameters

**Available actions by provider:**

### github
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
- get_tree: Full file tree. Params: { owner, repo, branch? }

### vercel
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
- check_domain: Params: { domain }

### supabase
- list_projects: List all projects
- get_project: Params: { projectRef }
- create_project: Params: { name, organization_id, region?, db_pass, plan? }
- get_api_keys: Params: { projectRef }
- list_organizations: List orgs
- run_sql: Execute SQL. Params: { projectRef, query }
- list_tables: Params: { projectRef }
- create_table: Params: { projectRef, tableName, columns: [{name, type, primaryKey?, default?, notNull?}] }
- enable_rls: Params: { projectRef, tableName }
- get_settings: Get project URL + keys. Params: { projectRef }

### stripe
- list_products: Params: { limit?, active? }
- create_product: Params: { name, description?, metadata? }
- create_price: Params: { product, unit_amount, currency?, recurring? }
- create_checkout: Params: { line_items, mode?, success_url, cancel_url }
- list_customers: Params: { limit?, email? }
- create_customer: Params: { name?, email?, metadata? }
- get_balance: Get account balance

### netlify
- list_sites: List all sites
- get_site: Params: { siteId }
- create_site: Params: { name?, custom_domain? }
- list_deploys: Params: { siteId }
- set_env: Params: { siteId, key, values }
- list_env: Params: { siteId }

### sendgrid
- send_email: Params: { to, from, subject, text?, html? }
- list_templates: Params: { generations? }
- send_template_email: Params: { to, from, template_id, dynamic_template_data }

### cloudflare
- list_zones: List all zones
- list_dns_records: Params: { zoneId }
- create_dns_record: Params: { zoneId, type, name, content, ttl?, proxied? }
- update_dns_record: Params: { zoneId, recordId, type, name, content }
- delete_dns_record: Params: { zoneId, recordId }
- purge_cache: Params: { zoneId }

### namecheap
- list_domains: List all domains
- get_dns: Get DNS records. Params: { domain }
- set_dns: Set DNS records. Params: { domain, records: [{type, name, address, ttl?}] }
- check_availability: Params: { domains } (comma-separated)
- set_nameservers: Params: { domain, nameservers }

**IMPORTANT:** Before using any provider, check if it's connected. If not, tell the user to connect it in Settings > Connections.
`;

// --------------- Tool Execution (add to executeTool) ---------------

/**
 * Execute a connection tool call from the AI.
 * Returns a string result suitable for tool_result messages.
 */
export async function executeConnectionTool(
  toolParams: { provider: string; action: string; params?: Record<string, any> }
): Promise<string> {
  const { provider, action, params = {} } = toolParams;

  // Validate provider
  if (!MVP_PROVIDERS.includes(provider as ConnectionProvider)) {
    return `Error: Unknown provider "${provider}". Available: ${MVP_PROVIDERS.join(', ')}`;
  }

  const p = provider as ConnectionProvider;

  // Check if service is implemented
  if (!isServiceAvailable(p)) {
    return `Error: ${PROVIDERS[p].name} service is not yet implemented.`;
  }

  // Check if connected
  const store = useConnectionsStore.getState();
  if (!store.isConnected(p)) {
    return `Error: Not connected to ${PROVIDERS[p].name}. Please ask the user to connect it in Settings > Connections.`;
  }

  try {
    const result = await executeProviderAction(p, action, params);

    // Truncate large responses to avoid blowing up context
    const json = JSON.stringify(result, null, 2);
    if (json.length > 10000) {
      return JSON.stringify(result, null, 2).slice(0, 10000) + '\n... (truncated)';
    }
    return json;
  } catch (err: any) {
    return `Error: ${err.message || 'Action failed'}`;
  }
}

// --------------- Helper: Get Connected Services Summary ---------------
// Include this in the system prompt so AI knows what's available

export function getConnectionsSummary(): string {
  const store = useConnectionsStore.getState();
  const connected = store.getConnectedProviders();

  if (connected.length === 0) {
    return '';
  }

  const lines = connected.map((p) => {
    const conn = store.getConnection(p);
    const meta = PROVIDERS[p];
    const name = conn?.accountInfo?.name || conn?.accountInfo?.email || '';
    return `- ${meta.name}: Connected${name ? ` (${name})` : ''}`;
  });

  return `Connected services:\n${lines.join('\n')}\n\nUse the "connection" tool to interact with these services.`;
}