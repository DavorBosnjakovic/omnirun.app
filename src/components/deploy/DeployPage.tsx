// ============================================================
// DeployPage.tsx - Deployment Dashboard (Tools > Deploy)
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import {
  Rocket,
  ExternalLink,
  RefreshCw,
  Globe,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Copy,
  Check,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Settings,
  Link2,
  GitBranch,
  Shield,
  Eye,
  Unplug,
  Triangle,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { useProjectStore } from '../../stores/projectStore';
import { themes } from '../../config/themes';
import { executeProjectProviderAction } from '../../services/connections/connectionManager';

// --------------- Types ---------------

interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  link?: { type: string; repo?: string };
  targets?: Record<string, any>;
  latestDeployments?: any[];
  updatedAt?: number;
}

interface Deployment {
  uid: string;
  name: string;
  url: string;
  state: string; // READY, ERROR, BUILDING, QUEUED, CANCELED
  target: string | null; // production, preview
  created: number;
  createdAt?: number;
  buildingAt?: number;
  ready?: number;
  meta?: { githubCommitMessage?: string; githubCommitRef?: string };
  inspectorUrl?: string;
  creator?: { username?: string };
}

interface Domain {
  name: string;
  verified: boolean;
  configured?: boolean;
  apexName?: string;
  redirect?: string | null;
  gitBranch?: string | null;
}

// --------------- Helpers ---------------

function formatTimeAgo(ts: number): string {
  if (!ts) return '';
  const now = Date.now();
  const diffMs = now - ts;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString();
}

function deployStateColor(state: string): string {
  switch (state?.toUpperCase()) {
    case 'READY': return '#22c55e';
    case 'ERROR': return '#ef4444';
    case 'BUILDING': return '#3b82f6';
    case 'QUEUED': return '#f59e0b';
    case 'CANCELED': return '#6b7280';
    case 'INITIALIZING': return '#f59e0b';
    default: return '#6b7280';
  }
}

function deployStateLabel(state: string): string {
  switch (state?.toUpperCase()) {
    case 'READY': return 'Live';
    case 'ERROR': return 'Failed';
    case 'BUILDING': return 'Building';
    case 'QUEUED': return 'Queued';
    case 'CANCELED': return 'Canceled';
    case 'INITIALIZING': return 'Starting';
    default: return state || 'Unknown';
  }
}

// --------------- Main Component ---------------

interface DeployPageProps {
  onSettingsClick?: (tab: string) => void;
  onSendToChat?: (message: string) => void;
}

export default function DeployPage({ onSettingsClick, onSendToChat }: DeployPageProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { currentProject } = useProjectStore();
  const projectId = currentProject?.id || '';

  const store = useConnectionsStore();
  const vercelConn = store.projectConnections[projectId]?.vercel;
  const netlifyConn = store.projectConnections[projectId]?.netlify;
  const isVercelConnected = vercelConn?.status === 'connected';
  const isNetlifyConnected = netlifyConn?.status === 'connected';
  const hasHostingProvider = isVercelConnected || isNetlifyConnected;

  // Active provider (prefer Vercel, fall back to Netlify)
  const activeProvider = isVercelConnected ? 'vercel' : isNetlifyConnected ? 'netlify' : null;
  const providerName = activeProvider === 'vercel' ? 'Vercel' : activeProvider === 'netlify' ? 'Netlify' : null;

  // Data state
  const [projects, setProjects] = useState<VercelProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(false);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [expandedDeploy, setExpandedDeploy] = useState<string | null>(null);

  // Load connections from DB on mount
  useEffect(() => {
    if (projectId) {
      store.loadProjectConnectionsFromDB(projectId);
    }
  }, [projectId]);

  // Fetch projects when provider is connected
  const fetchProjects = useCallback(async () => {
    if (!activeProvider || !projectId) return;
    setLoading(true);
    setError(null);
    try {
      if (activeProvider === 'vercel') {
        const res = await executeProjectProviderAction(projectId, 'vercel', 'list_projects', { limit: 50 });
        setProjects(res?.projects || []);
        // Auto-select first project if none selected
        if (!selectedProjectId && res?.projects?.length > 0) {
          setSelectedProjectId(res.projects[0].id);
        }
      } else if (activeProvider === 'netlify') {
        const res = await executeProjectProviderAction(projectId, 'netlify', 'list_sites', {});
        const sites = Array.isArray(res) ? res : [];
        setProjects(sites.map((s: any) => ({
          id: s.id,
          name: s.name || s.subdomain,
          framework: s.build_settings?.repo_type || null,
          updatedAt: new Date(s.updated_at).getTime(),
        })));
        if (!selectedProjectId && sites.length > 0) {
          setSelectedProjectId(sites[0].id);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch projects');
    } finally {
      setLoading(false);
    }
  }, [activeProvider, projectId, selectedProjectId]);

  useEffect(() => {
    if (hasHostingProvider) fetchProjects();
  }, [hasHostingProvider, activeProvider]);

  // Fetch deployments + domains when a project is selected
  const fetchDeploymentData = useCallback(async () => {
    if (!activeProvider || !projectId || !selectedProjectId) return;
    setDeploymentsLoading(true);
    try {
      if (activeProvider === 'vercel') {
        const [depsRes, domsRes] = await Promise.all([
          executeProjectProviderAction(projectId, 'vercel', 'list_deployments', {
            projectId: selectedProjectId,
            limit: 15,
          }),
          executeProjectProviderAction(projectId, 'vercel', 'list_domains', {
            projectId: selectedProjectId,
          }),
        ]);
        setDeployments(depsRes?.deployments || []);
        setDomains(domsRes?.domains || []);
      } else if (activeProvider === 'netlify') {
        const deps = await executeProjectProviderAction(projectId, 'netlify', 'list_deploys', {
          siteId: selectedProjectId,
        });
        const depsArr = Array.isArray(deps) ? deps.slice(0, 15) : [];
        setDeployments(depsArr.map((d: any) => ({
          uid: d.id,
          name: d.name || d.title || '',
          url: d.ssl_url || d.deploy_ssl_url || d.url || '',
          state: d.state === 'ready' ? 'READY' : d.state === 'error' ? 'ERROR' : d.state?.toUpperCase() || 'UNKNOWN',
          target: d.context || null,
          created: new Date(d.created_at).getTime(),
          meta: { githubCommitMessage: d.title },
        })));
        setDomains([]);
      }
    } catch (err: any) {
      console.error('Failed to fetch deployment data:', err);
    } finally {
      setDeploymentsLoading(false);
    }
  }, [activeProvider, projectId, selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId) fetchDeploymentData();
  }, [selectedProjectId]);

  // Copy URL to clipboard
  const handleCopyUrl = (url: string) => {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    });
  };

  // Open URL in browser
  const handleOpenUrl = (url: string) => {
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    window.open(fullUrl, '_blank');
  };

  // Card bg matching ConnectionsSettings pattern
  const bgCard = theme === 'light'
    ? 'bg-white border border-gray-200 shadow-sm'
    : theme === 'sepia'
    ? 'bg-stone-800 border border-stone-700'
    : theme === 'retro'
    ? 'bg-black border border-green-800'
    : theme === 'midnight'
    ? 'bg-slate-900 border border-slate-700'
    : theme === 'highContrast'
    ? 'bg-black border border-white'
    : `${t.colors.bgSecondary} ${t.colors.border} border`;

  // ── No project open ──
  if (!currentProject) {
    return (
      <div className="max-w-3xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <Rocket size={24} className={t.colors.textMuted} />
          <h1 className={`text-xl font-semibold ${t.colors.text}`}>Deploy</h1>
        </div>
        <div className={`text-center py-16 ${t.colors.textMuted}`}>
          <Rocket size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Open a project first to manage deployments.</p>
        </div>
      </div>
    );
  }

  // ── Not connected state ──
  if (!hasHostingProvider) {
    return (
      <div className="max-w-3xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <Rocket size={24} className={t.colors.textMuted} />
          <h1 className={`text-xl font-semibold ${t.colors.text}`}>Deploy</h1>
        </div>

        <div className={`${bgCard} ${t.borderRadius} p-8 text-center`}>
          <div className="flex justify-center gap-3 mb-4">
            <Unplug size={28} className={t.colors.textMuted} />
          </div>
          <h2 className={`text-lg font-medium ${t.colors.text} mb-2`}>
            Connect a hosting provider
          </h2>
          <p className={`text-sm ${t.colors.textMuted} mb-6 max-w-md mx-auto`}>
            Link your Vercel or Netlify account to deploy projects, manage domains, and monitor builds — all from here.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={() => onSettingsClick?.('connections')}
              className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium ${t.borderRadius} ${t.colors.accent} ${
                theme === 'highContrast' ? 'text-black' : 'text-white'
              } ${t.colors.accentHover} transition-colors`}
            >
              <Settings size={14} />
              Open Connections
            </button>
          </div>
          <p className={`text-xs ${t.colors.textMuted} mt-4 opacity-60`}>
            Or just tell the AI: "Deploy this" — it'll walk you through setup.
          </p>
        </div>
      </div>
    );
  }

  // ── Connected — main dashboard ──
  const selectedProject = projects.find((p) => p.id === selectedProjectId);
  const latestDeploy = deployments[0];
  const isLive = latestDeploy?.state?.toUpperCase() === 'READY';
  const productionUrl = latestDeploy?.url;
  const customDomains = domains.filter((d) => !d.name?.includes('.vercel.app'));
  const vercelDomains = domains.filter((d) => d.name?.includes('.vercel.app'));

  return (
    <div className="max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Rocket size={24} className={t.colors.textMuted} />
        <h1 className={`text-xl font-semibold ${t.colors.text}`}>Deploy</h1>
        <span className={`text-xs px-2 py-0.5 ${t.borderRadius} ${t.colors.bgTertiary || t.colors.bgSecondary} ${t.colors.textMuted}`}>
          {providerName}
        </span>

        {/* Refresh */}
        <button
          onClick={() => { fetchProjects(); if (selectedProjectId) fetchDeploymentData(); }}
          disabled={loading || deploymentsLoading}
          className={`ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs ${t.borderRadius} ${t.colors.border} border ${t.colors.text} hover:bg-white/10 transition-colors disabled:opacity-40`}
        >
          <RefreshCw size={12} className={(loading || deploymentsLoading) ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div className={`flex items-center gap-2 px-4 py-3 mb-4 ${t.borderRadius} bg-red-500/10 text-red-400 text-sm`}>
          <AlertCircle size={14} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto text-xs hover:text-red-300">Dismiss</button>
        </div>
      )}

      {/* Project selector (if multiple projects) */}
      {projects.length > 1 && (
        <div className={`${bgCard} ${t.borderRadius} p-4 mb-5`}>
          <label className={`text-xs font-medium ${t.colors.textMuted} block mb-2`}>
            {providerName} Project
          </label>
          <select
            value={selectedProjectId || ''}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className={`w-full max-w-xs px-3 py-2 ${t.borderRadius} text-sm border outline-none focus:ring-1 focus:ring-blue-500 ${
              theme === 'light' ? 'bg-gray-100 border-gray-300 text-gray-900'
              : theme === 'retro' ? 'bg-black border-green-700 text-green-400 font-mono'
              : theme === 'highContrast' ? 'bg-black border-white text-white'
              : `${t.colors.bgTertiary || t.colors.bg} ${t.colors.border} ${t.colors.text}`
            }`}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && projects.length === 0 && (
        <div className={`flex items-center justify-center py-20 ${t.colors.textMuted}`}>
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading {providerName} projects...
        </div>
      )}

      {/* No projects */}
      {!loading && projects.length === 0 && (
        <div className={`text-center py-16 ${t.colors.textMuted}`}>
          <Rocket size={28} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm mb-1">No projects found on {providerName}</p>
          <p className="text-xs opacity-60">Deploy from chat to create your first project.</p>
        </div>
      )}

      {/* ── Status card ── */}
      {selectedProject && (
        <div className={`${bgCard} ${t.borderRadius} p-5 mb-5`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              {/* Project name + status */}
              <div className="flex items-center gap-3 mb-2">
                <h2 className={`text-base font-semibold ${t.colors.text} truncate`}>
                  {selectedProject.name}
                </h2>
                {latestDeploy && (
                  <span
                    className="flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{
                      color: deployStateColor(latestDeploy.state),
                      backgroundColor: `${deployStateColor(latestDeploy.state)}15`,
                    }}
                  >
                    {latestDeploy.state?.toUpperCase() === 'BUILDING' && (
                      <Loader2 size={10} className="animate-spin" />
                    )}
                    {latestDeploy.state?.toUpperCase() === 'READY' && <CheckCircle2 size={10} />}
                    {latestDeploy.state?.toUpperCase() === 'ERROR' && <XCircle size={10} />}
                    {deployStateLabel(latestDeploy.state)}
                  </span>
                )}
              </div>

              {/* Framework + last deployed */}
              <div className={`flex items-center gap-4 text-xs ${t.colors.textMuted}`}>
                {selectedProject.framework && (
                  <span className="flex items-center gap-1">
                    <span className="opacity-60">Framework:</span> {selectedProject.framework}
                  </span>
                )}
                {latestDeploy && (
                  <span className="flex items-center gap-1">
                    <Clock size={11} />
                    {formatTimeAgo(latestDeploy.created || latestDeploy.createdAt || 0)}
                  </span>
                )}
              </div>

              {/* Production URL */}
              {productionUrl && (
                <div className="flex items-center gap-2 mt-3">
                  <Link2 size={13} className={t.colors.textMuted} />
                  <button
                    onClick={() => handleOpenUrl(productionUrl)}
                    className="text-sm text-blue-400 hover:text-blue-300 truncate transition-colors"
                  >
                    {productionUrl}
                  </button>
                  <button
                    onClick={() => handleCopyUrl(productionUrl)}
                    className={`p-1 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                    title="Copy URL"
                  >
                    {copiedUrl === productionUrl ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
                  </button>
                  <button
                    onClick={() => handleOpenUrl(productionUrl)}
                    className={`p-1 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                    title="Open in browser"
                  >
                    <ExternalLink size={12} />
                  </button>
                </div>
              )}
            </div>

            {/* Deploy button */}
            <button
              onClick={() => onSendToChat?.('Deploy the current project to production')}
              className={`flex items-center gap-2 px-4 py-2 text-sm font-medium ${t.borderRadius} ${t.colors.accent} ${
                theme === 'highContrast' ? 'text-black' : 'text-white'
              } ${t.colors.accentHover} transition-colors flex-shrink-0`}
            >
              <Rocket size={14} />
              Deploy
            </button>
          </div>
        </div>
      )}

      {/* ── Domains ── */}
      {(customDomains.length > 0 || vercelDomains.length > 0) && (
        <div className="mb-5">
          <h3 className={`text-xs font-medium ${t.colors.textMuted} mb-2.5 uppercase tracking-wide`}>
            Domains
          </h3>
          <div className={`${bgCard} ${t.borderRadius} divide-y ${
            theme === 'light' ? 'divide-gray-100' : theme === 'retro' ? 'divide-green-900/50' : `divide-white/5`
          }`}>
            {[...customDomains, ...vercelDomains].map((domain) => (
              <div key={domain.name} className="flex items-center gap-3 px-4 py-3">
                <Globe size={14} className={t.colors.textMuted} />
                <button
                  onClick={() => handleOpenUrl(domain.name)}
                  className={`text-sm ${t.colors.text} hover:text-blue-400 truncate transition-colors`}
                >
                  {domain.name}
                </button>
                {domain.verified !== false && (
                  <span className="flex items-center gap-1 text-[10px] text-green-400">
                    <Shield size={10} /> SSL
                  </span>
                )}
                {domain.redirect && (
                  <span className={`text-[10px] ${t.colors.textMuted}`}>
                    → {domain.redirect}
                  </span>
                )}
                <div className="ml-auto flex items-center gap-1">
                  <button
                    onClick={() => handleCopyUrl(domain.name)}
                    className={`p-1 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                  >
                    {copiedUrl === domain.name ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
                  </button>
                  <button
                    onClick={() => handleOpenUrl(domain.name)}
                    className={`p-1 ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                  >
                    <ExternalLink size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Deployment history ── */}
      {selectedProject && (
        <div className="mb-5">
          <h3 className={`text-xs font-medium ${t.colors.textMuted} mb-2.5 uppercase tracking-wide`}>
            Deployments
          </h3>

          {deploymentsLoading && deployments.length === 0 && (
            <div className={`flex items-center gap-2 py-8 justify-center ${t.colors.textMuted} text-sm`}>
              <Loader2 size={14} className="animate-spin" />
              Loading deployments...
            </div>
          )}

          {!deploymentsLoading && deployments.length === 0 && (
            <div className={`text-center py-8 ${t.colors.textMuted}`}>
              <p className="text-sm">No deployments yet</p>
              <p className="text-xs mt-1 opacity-60">Deploy from chat to get started.</p>
            </div>
          )}

          {deployments.length > 0 && (
            <div className={`${bgCard} ${t.borderRadius} divide-y ${
              theme === 'light' ? 'divide-gray-100' : theme === 'retro' ? 'divide-green-900/50' : 'divide-white/5'
            }`}>
              {deployments.map((dep, i) => {
                const isExpanded = expandedDeploy === dep.uid;
                const isFirst = i === 0;
                return (
                  <div key={dep.uid}>
                    <div
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors ${
                        isFirst ? 'rounded-t-lg' : ''
                      }`}
                      onClick={() => setExpandedDeploy(isExpanded ? null : dep.uid)}
                    >
                      {/* Expand icon */}
                      {isExpanded
                        ? <ChevronDown size={12} className={t.colors.textMuted} />
                        : <ChevronRight size={12} className={t.colors.textMuted} />
                      }

                      {/* Status dot */}
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: deployStateColor(dep.state) }}
                      />

                      {/* State label */}
                      <span
                        className="text-xs font-medium w-16 flex-shrink-0"
                        style={{ color: deployStateColor(dep.state) }}
                      >
                        {deployStateLabel(dep.state)}
                      </span>

                      {/* Commit or name */}
                      <span className={`text-sm ${t.colors.text} truncate flex-1`}>
                        {dep.meta?.githubCommitMessage || dep.name || dep.url || 'Deployment'}
                      </span>

                      {/* Target badge */}
                      {dep.target && (
                        <span className={`text-[10px] px-1.5 py-0.5 ${t.borderRadius} ${
                          dep.target === 'production'
                            ? 'bg-green-500/10 text-green-400'
                            : 'bg-blue-500/10 text-blue-400'
                        }`}>
                          {dep.target}
                        </span>
                      )}

                      {/* Time */}
                      <span className={`text-xs ${t.colors.textMuted} flex-shrink-0`}>
                        {formatTimeAgo(dep.created || dep.createdAt || 0)}
                      </span>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className={`px-4 pb-3 pt-1 ${t.colors.border} border-t`}>
                        <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 text-xs ${t.colors.textMuted}`}>
                          {dep.url && (
                            <span className="flex items-center gap-1.5">
                              <Link2 size={11} />
                              <button
                                onClick={(e) => { e.stopPropagation(); handleOpenUrl(dep.url); }}
                                className="text-blue-400 hover:text-blue-300 transition-colors"
                              >
                                {dep.url}
                              </button>
                            </span>
                          )}
                          {dep.meta?.githubCommitRef && (
                            <span className="flex items-center gap-1.5">
                              <GitBranch size={11} />
                              {dep.meta.githubCommitRef}
                            </span>
                          )}
                          {dep.creator?.username && (
                            <span>by {dep.creator.username}</span>
                          )}
                          {dep.inspectorUrl && (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleOpenUrl(dep.inspectorUrl!); }}
                              className="flex items-center gap-1.5 text-blue-400 hover:text-blue-300 transition-colors"
                            >
                              <Eye size={11} />
                              Build logs
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Quick actions footer ── */}
      {selectedProject && (
        <div className={`pt-5 ${t.colors.border} border-t`}>
          <p className={`text-xs ${t.colors.textMuted} mb-3 text-center`}>
            Quick actions — or just tell the AI what you need in chat
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { label: 'Deploy to production', msg: 'Deploy the current project to production' },
              { label: 'Add a custom domain', msg: 'Help me add a custom domain to this project' },
              { label: 'Set env variables', msg: 'Help me set environment variables for this project' },
              { label: 'Preview deploy', msg: 'Create a preview deployment for the current branch' },
            ].map((action) => (
              <button
                key={action.label}
                onClick={() => onSendToChat?.(action.msg)}
                className={`px-3 py-1.5 text-xs ${t.borderRadius} ${t.colors.border} border ${t.colors.textMuted} hover:${t.colors.text} hover:bg-white/5 transition-colors`}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}