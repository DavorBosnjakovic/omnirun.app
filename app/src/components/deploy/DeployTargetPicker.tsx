// ============================================================
// DeployTargetPicker.tsx — Choose where to deploy
// ============================================================
// Shown when:
// 1. First time deploying a project (no saved target yet)
// 2. User clicks the "Change target" gear icon
//
// Behavior:
// - Fetches existing projects/sites from the selected provider
// - Lists them with attached domains visible
// - "Create new" option at the bottom with name + optional custom domain
// - On confirm, saves to deployTargetStore and (optionally) starts deploy
// ============================================================

import { useEffect, useState } from 'react';
import {
  Rocket,
  X,
  Triangle,
  Globe,
  Cloud,
  Loader2,
  Plus,
  ExternalLink,
  Check,
  AlertCircle,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { useDeployTargetStore, type DeployTarget } from '../../stores/deployTargetStore';
import { executeProjectProviderAction } from '../../services/connections/connectionManager';
import { themes } from '../../config/themes';
import type { ConnectionProvider } from '../../services/connections/types';

// ─── Provider metadata ───

const PROVIDER_META: Record<string, { label: string; icon: any }> = {
  vercel: { label: 'Vercel', icon: Triangle },
  netlify: { label: 'Netlify', icon: Globe },
  cloudflare: { label: 'Cloudflare Pages', icon: Cloud },
};

// ─── Types for fetched project lists ───

interface RemoteProject {
  id: string;
  name: string;
  domain?: string;          // custom domain attached, if any
  defaultUrl?: string;      // auto-generated URL (e.g. foo.vercel.app)
}

// ─── Props ───

interface DeployTargetPickerProps {
  /** The OmniRun project ID this target belongs to. */
  omniProjectId: string;
  /** The OmniRun project name — prefilled when creating a new remote project. */
  omniProjectName: string;
  /** Deploy providers the user can choose from (filtered to connected ones). */
  availableProviders: ConnectionProvider[];
  /** Called when user confirms a target. Parent decides whether to start deploy. */
  onConfirm: (target: DeployTarget) => void;
  /** Called when user cancels. */
  onCancel: () => void;
}

// ─── Component ───

export default function DeployTargetPicker({
  omniProjectId,
  omniProjectName,
  availableProviders,
  onConfirm,
  onCancel,
}: DeployTargetPickerProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  // If multiple providers are available, user picks the provider first.
  // If only one, skip straight to project list for that provider.
  const [provider, setProvider] = useState<ConnectionProvider | null>(
    availableProviders.length === 1 ? availableProviders[0] : null
  );

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-lg mx-4 ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-2xl overflow-hidden max-h-[85vh] flex flex-col`}
      >
        {/* Header */}
        <div className={`flex items-center gap-3 px-5 py-4 ${t.colors.border} border-b flex-shrink-0`}>
          <Rocket size={18} className={t.colors.textMuted} />
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-medium ${t.colors.text}`}>Deploy target</div>
            <div className={`text-xs ${t.colors.textMuted}`}>
              {provider
                ? `Pick or create a ${PROVIDER_META[provider]?.label} project`
                : 'Pick a provider'}
            </div>
          </div>
          <button
            onClick={onCancel}
            className={`p-1 ${t.borderRadius} ${t.colors.text} hover:bg-white/10 transition-colors`}
            title="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto">
          {!provider ? (
            <ProviderSelect
              providers={availableProviders}
              onPick={setProvider}
              t={t}
            />
          ) : (
            <ProjectSelect
              provider={provider}
              omniProjectId={omniProjectId}
              omniProjectName={omniProjectName}
              onBack={availableProviders.length > 1 ? () => setProvider(null) : undefined}
              onConfirm={onConfirm}
              t={t}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Pick provider (only if multiple connected) ───

function ProviderSelect({
  providers,
  onPick,
  t,
}: {
  providers: ConnectionProvider[];
  onPick: (p: ConnectionProvider) => void;
  t: any;
}) {
  return (
    <div className="px-3 py-3 space-y-1.5">
      {providers.map((p) => {
        const meta = PROVIDER_META[p] || { label: p, icon: Rocket };
        const Icon = meta.icon;
        return (
          <button
            key={p}
            onClick={() => onPick(p)}
            className={`w-full px-3 py-3 ${t.borderRadius} flex items-center gap-3 ${t.colors.text} hover:bg-white/10 transition-colors text-left`}
          >
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center ${t.colors.bgTertiary} flex-shrink-0`}
            >
              <Icon size={16} />
            </div>
            <div className="flex-1 min-w-0 text-sm font-medium">{meta.label}</div>
          </button>
        );
      })}
    </div>
  );
}

// ─── Step 2: Pick an existing project or create a new one ───

function ProjectSelect({
  provider,
  omniProjectId,
  omniProjectName,
  onBack,
  onConfirm,
  t,
}: {
  provider: ConnectionProvider;
  omniProjectId: string;
  omniProjectName: string;
  onBack?: () => void;
  onConfirm: (target: DeployTarget) => void;
  t: any;
}) {
  const projectConnections = useConnectionsStore((s) => s.projectConnections);
  const getConnection = useConnectionsStore((s) => s.getConnection);
  const [remoteProjects, setRemoteProjects] = useState<RemoteProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const [newName, setNewName] = useState(omniProjectName);
  const [newDomain, setNewDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Resolve Cloudflare account ID — try every possible source
  const [cloudflareAccountId, setCfAccountId] = useState<string>('');

  useEffect(() => {
    if (provider !== 'cloudflare') return;

    // 1. Try stored connection data (multiple paths because different cloudflare.ts versions stored it differently)
    const cfConn = getConnection?.('cloudflare');
    const stored =
      cfConn?.accountInfo?.extra?.accountId ||
      cfConn?.accountInfo?.extra?.accounts?.[0]?.id ||
      cfConn?.accountInfo?.extra?.organizations?.[0]?.id ||
      '';
    if (stored) {
      setCfAccountId(stored);
      return;
    }

    // 2. Not stored — fetch from Cloudflare API.
    //    Try zones first (Zone:Read), then accounts as fallback.
    let cancelled = false;
    (async () => {
      try {
        // Try zones — most users have at least one
        const zones = await executeProjectProviderAction(omniProjectId, 'cloudflare', 'list_zones', {});
        if (cancelled) return;
        const id = zones?.[0]?.account?.id;
        if (id) { setCfAccountId(id); return; }
      } catch {
        // No zones or no permission — try accounts
      }

      try {
        const accounts = await executeProjectProviderAction(omniProjectId, 'cloudflare', 'list_accounts', {});
        if (cancelled) return;
        const id = accounts?.[0]?.id;
        if (id) setCfAccountId(id);
      } catch (err) {
        console.error('Failed to resolve Cloudflare account ID:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [provider, omniProjectId]);

  // Fetch existing projects
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const list = await fetchRemoteProjects(provider, omniProjectId, projectConnections, cloudflareAccountId);
        if (!cancelled) setRemoteProjects(list);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load projects');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, cloudflareAccountId]);

  const handleUseExisting = () => {
    const rp = remoteProjects.find((p) => p.id === selectedId);
    if (!rp) return;
    onConfirm({
      provider,
      remoteProjectId: rp.id,
      remoteProjectName: rp.name,
      domain: rp.domain,
      cloudflareAccountId: provider === 'cloudflare' ? cloudflareAccountId : undefined,
      createdAt: Date.now(),
    });
  };

  const handleCreateNew = async () => {
    if (!newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await createRemoteProject(
        provider,
        omniProjectId,
        newName.trim(),
        newDomain.trim() || undefined,
        cloudflareAccountId || undefined,
        projectConnections
      );
      onConfirm({
        provider,
        remoteProjectId: created.id,
        remoteProjectName: created.name,
        domain: newDomain.trim() || undefined,
        cloudflareAccountId: provider === 'cloudflare' ? cloudflareAccountId : undefined,
        createdAt: Date.now(),
      });
    } catch (e: any) {
      setError(e?.message || 'Failed to create project');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-3">
      {onBack && (
        <button
          onClick={onBack}
          className={`mb-2 text-xs ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
        >
          ← Back to provider list
        </button>
      )}


      {/* Error banner */}
      {error && (
        <div className={`flex items-center gap-2 px-3 py-2 mb-2 ${t.borderRadius} bg-red-500/10 text-red-400 text-xs`}>
          <AlertCircle size={14} className="flex-shrink-0" />
          <span className="break-words">{error}</span>
        </div>
      )}

      {!creatingNew ? (
        <>
          {/* Existing projects list */}
          {loading ? (
            <div className={`flex items-center justify-center py-8 ${t.colors.textMuted}`}>
              <Loader2 size={18} className="animate-spin mr-2" />
              <span className="text-sm">Loading projects…</span>
            </div>
          ) : remoteProjects.length === 0 ? (
            <div className={`text-center py-6 text-sm ${t.colors.textMuted}`}>
              No existing projects — create one below.
            </div>
          ) : (
            <div className="space-y-1.5 mb-3">
              {remoteProjects.map((rp) => {
                const isSelected = selectedId === rp.id;
                return (
                  <button
                    key={rp.id}
                    onClick={() => setSelectedId(rp.id)}
                    className={`w-full px-3 py-2.5 ${t.borderRadius} flex items-center gap-3 text-left transition-colors ${
                      isSelected
                        ? `${t.colors.bgTertiary} border ${t.colors.border}`
                        : `hover:bg-white/10 border border-transparent`
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                        isSelected ? 'bg-blue-500' : `${t.colors.border} border`
                      }`}
                    >
                      {isSelected && <Check size={10} className="text-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-medium ${t.colors.text} truncate`}>
                        {rp.name}
                      </div>
                      <div className={`text-xs ${t.colors.textMuted} truncate flex items-center gap-1`}>
                        {rp.domain ? (
                          <>
                            <ExternalLink size={10} />
                            {rp.domain}
                          </>
                        ) : rp.defaultUrl ? (
                          <>
                            <ExternalLink size={10} />
                            {rp.defaultUrl}
                          </>
                        ) : (
                          'No URL set'
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {/* Create new button */}
          <button
            onClick={() => setCreatingNew(true)}
            className={`w-full px-3 py-2.5 ${t.borderRadius} flex items-center gap-3 ${t.colors.text} hover:bg-white/10 transition-colors text-left border border-dashed ${t.colors.border}`}
          >
            <div className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${t.colors.textMuted}`}>
              <Plus size={14} />
            </div>
            <div className="flex-1 text-sm">Create new project</div>
          </button>

          {/* Use this project button */}
          <div className="pt-3 mt-3 border-t border-white/5 flex items-center justify-end gap-2">
            <button
              onClick={handleUseExisting}
              disabled={!selectedId}
              className={`px-4 py-2 ${t.borderRadius} text-sm font-medium transition-colors ${
                selectedId
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : `${t.colors.bgTertiary} ${t.colors.textMuted} cursor-not-allowed`
              }`}
            >
              Use this project
            </button>
          </div>
        </>
      ) : (
        <>
          {/* Create new form */}
          <div className="space-y-3">
            <div>
              <label className={`block text-xs mb-1 ${t.colors.textMuted}`}>Project name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-bakery"
                autoFocus
                className={`w-full px-3 py-2 text-sm ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} ${t.colors.border} border outline-none focus:ring-1 focus:ring-blue-500`}
              />
              <div className={`text-xs mt-1 ${t.colors.textMuted}`}>
                Letters, numbers, hyphens. This is your project ID on {PROVIDER_META[provider]?.label}.
              </div>
            </div>

            <div>
              <label className={`block text-xs mb-1 ${t.colors.textMuted}`}>
                Custom domain <span className="opacity-60">(optional)</span>
              </label>
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="mybakery.com"
                className={`w-full px-3 py-2 text-sm ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} ${t.colors.border} border outline-none focus:ring-1 focus:ring-blue-500`}
              />
              <div className={`text-xs mt-1 ${t.colors.textMuted}`}>
                Leave empty to use the auto-generated URL. You can add a domain later.
              </div>
            </div>

          </div>

          <div className="pt-3 mt-3 border-t border-white/5 flex items-center justify-end gap-2">
            <button
              onClick={() => setCreatingNew(false)}
              disabled={submitting}
              className={`px-3 py-2 ${t.borderRadius} text-sm ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
            >
              Back
            </button>
            <button
              onClick={handleCreateNew}
              disabled={submitting || !newName.trim()}
              className={`px-4 py-2 ${t.borderRadius} text-sm font-medium transition-colors ${
                !submitting && newName.trim()
                  ? 'bg-blue-500 text-white hover:bg-blue-600'
                  : `${t.colors.bgTertiary} ${t.colors.textMuted} cursor-not-allowed`
              }`}
            >
              {submitting ? 'Creating…' : 'Create & use'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Fetch helpers (per provider) ───

async function fetchRemoteProjects(
  provider: ConnectionProvider,
  projectId: string,
  _projectConnections: any,
  cloudflareAccountId?: string
): Promise<RemoteProject[]> {
  if (provider === 'vercel') {
    const res = await executeProjectProviderAction(projectId, 'vercel', 'list_projects', { limit: 50 });
    const projects = (res?.projects ?? res ?? []) as any[];
    return projects.map((p) => {
      // Vercel attaches domains at the "alias" or via per-project domain list.
      // For simplicity, we use the first non-vercel.app alias if present.
      const aliases: string[] = p.targets?.production?.alias || p.alias || [];
      const customDomain = aliases.find((a: string) => !a.endsWith('.vercel.app'));
      const defaultUrl = aliases.find((a: string) => a.endsWith('.vercel.app')) || `${p.name}.vercel.app`;
      return {
        id: p.id,
        name: p.name,
        domain: customDomain,
        defaultUrl,
      };
    });
  }

  if (provider === 'netlify') {
    const res = await executeProjectProviderAction(projectId, 'netlify', 'list_sites', {});
    // The response may be a raw array OR wrapped in an object (e.g. { result: [...] }).
    // Vercel's branch already handles this; Netlify needs the same treatment.
    const raw = Array.isArray(res) ? res : (res?.sites ?? res?.result ?? res?.data ?? []);
    const sites = (Array.isArray(raw) ? raw : []) as any[];
    return sites.map((s) => ({
      id: s.id,
      name: s.name || s.site_name || s.id,
      domain: s.custom_domain || undefined,
      defaultUrl: s.url || s.ssl_url,
    }));
  }

  if (provider === 'cloudflare') {
    // Resolve account ID: parameter → stored → live from zones → live from accounts
    let cfAccountId = cloudflareAccountId;
    if (!cfAccountId) {
      const cfConn = useConnectionsStore.getState().getConnection('cloudflare');
      cfAccountId =
        cfConn?.accountInfo?.extra?.accountId ||
        cfConn?.accountInfo?.extra?.organizations?.[0]?.id ||
        '';
    }
    if (!cfAccountId) {
      try {
        const zones = await executeProjectProviderAction(projectId, 'cloudflare', 'list_zones', {});
        cfAccountId = zones?.[0]?.account?.id || '';
      } catch { /* no zones */ }
    }
    if (!cfAccountId) {
      try {
        const accounts = await executeProjectProviderAction(projectId, 'cloudflare', 'list_accounts', {});
        cfAccountId = accounts?.[0]?.id || '';
      } catch { /* no account access */ }
    }
    if (!cfAccountId) return [];
    try {
      const res = await executeProjectProviderAction(projectId, 'cloudflare', 'list_pages_projects', {
        accountId: cfAccountId,
      });
      const projects = (Array.isArray(res) ? res : (res?.result ?? [])) as any[];
      return projects.map((p: any) => ({
        id: p.name, // CF Pages uses name as identifier
        name: p.name,
        domain: p.domains?.[0] && !p.domains[0].endsWith('.pages.dev') ? p.domains[0] : undefined,
        defaultUrl: p.subdomain ? `https://${p.subdomain}` : `https://${p.name}.pages.dev`,
      }));
    } catch {
      return [];
    }
  }

  return [];
}

async function createRemoteProject(
  provider: ConnectionProvider,
  projectId: string,
  name: string,
  domain: string | undefined,
  cloudflareAccountId: string | undefined,
  _projectConnections: any
): Promise<{ id: string; name: string }> {
  if (provider === 'vercel') {
    const created = await executeProjectProviderAction(projectId, 'vercel', 'create_project', { name });
    if (domain) {
      try {
        await executeProjectProviderAction(projectId, 'vercel', 'add_domain', {
          projectId: created.id,
          domain,
        });
      } catch (e) {
        console.warn('Vercel: failed to attach domain (project still created):', e);
      }
    }
    return { id: created.id, name: created.name };
  }

  if (provider === 'netlify') {
    const created = await executeProjectProviderAction(projectId, 'netlify', 'create_site', {
      name,
      custom_domain: domain,
    });
    return { id: created.id, name: created.name || name };
  }

  if (provider === 'cloudflare') {
    // Resolve account ID: parameter → stored → live from zones → live from accounts
    let cfAccountId = cloudflareAccountId;
    if (!cfAccountId) {
      const cfConn = useConnectionsStore.getState().getConnection('cloudflare');
      cfAccountId =
        cfConn?.accountInfo?.extra?.accountId ||
        cfConn?.accountInfo?.extra?.organizations?.[0]?.id ||
        '';
    }
    if (!cfAccountId) {
      try {
        const zones = await executeProjectProviderAction(projectId, 'cloudflare', 'list_zones', {});
        cfAccountId = zones?.[0]?.account?.id || '';
      } catch { /* no zones */ }
    }
    if (!cfAccountId) {
      try {
        const accounts = await executeProjectProviderAction(projectId, 'cloudflare', 'list_accounts', {});
        cfAccountId = accounts?.[0]?.id || '';
      } catch { /* no account access */ }
    }
    if (!cfAccountId) throw new Error('Could not determine Cloudflare Account ID. Please reconnect Cloudflare in Settings.');
    await executeProjectProviderAction(projectId, 'cloudflare', 'create_pages_project', {
      accountId: cfAccountId,
      name,
    });
    // CF Pages uses the project NAME as the identifier (not a separate ID).
    return { id: name, name };
  }

  throw new Error(`Unsupported provider: ${provider}`);
}