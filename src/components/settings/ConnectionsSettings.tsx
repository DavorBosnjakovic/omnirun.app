// ============================================================
// ConnectionsSettings.tsx - Project Connections Hub UI
// ============================================================

import { useState, useEffect } from 'react';
import {
  Shield,
  ExternalLink,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  Unplug,
  Plug,
  RefreshCw,
  FolderOpen,
} from 'lucide-react';

// --------------- Custom Service Icons ---------------
import githubIcon from '../../assets/icons/connections/github.svg';
import vercelIcon from '../../assets/icons/connections/vercel.svg';
import supabaseIcon from '../../assets/icons/connections/supabase.svg';
import cloudflareIcon from '../../assets/icons/connections/cloudflare.svg';
import stripeIcon from '../../assets/icons/connections/stripe.svg';
import netlifyIcon from '../../assets/icons/connections/Netlify.svg';
import sendgridIcon from '../../assets/icons/connections/sendgrid.svg';
import namecheapIcon from '../../assets/icons/connections/namecheap.svg';
import godaddyIcon from '../../assets/icons/connections/GoDaddy.svg';
import resendIcon from '../../assets/icons/connections/resend.svg';
import porkbunIcon from '../../assets/icons/connections/porkbun.svg';
import bunnyIcon from '../../assets/icons/connections/Bunny.svg';
import { useSettingsStore } from '../../stores/settingsStore';
import { themes } from '../../config/themes';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { useProjectStore } from '../../stores/projectStore';
import {
  PROVIDERS,
  MVP_PROVIDERS,
  CATEGORIES,
  isServiceAvailable,
  disconnectProjectProvider,
  retestProjectConnection,
  getService,
} from '../../services/connections';
import type { ConnectionProvider, ConnectionCategory, ProviderMeta } from '../../services/connections/types';

// --------------- Icon Map ---------------

const SERVICE_ICONS: Record<string, string> = {
  github: githubIcon,
  vercel: vercelIcon,
  supabase: supabaseIcon,
  cloudflare: cloudflareIcon,
  stripe: stripeIcon,
  netlify: netlifyIcon,
  sendgrid: sendgridIcon,
  namecheap: namecheapIcon,
  godaddy: godaddyIcon,
  resend: resendIcon,
  porkbun: porkbunIcon,
  bunny: bunnyIcon,
};

function getServiceIcon(providerId: string): string | null {
  return SERVICE_ICONS[providerId] || null;
}

// --------------- Status Badge ---------------

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'connected':
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-green-400">
          <CheckCircle size={12} /> Connected
        </span>
      );
    case 'connecting':
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-yellow-400">
          <Loader2 size={12} className="animate-spin" /> Connecting...
        </span>
      );
    case 'error':
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-red-400">
          <XCircle size={12} /> Error
        </span>
      );
    case 'expired':
      return (
        <span className="flex items-center gap-1 text-xs font-medium text-orange-400">
          <AlertCircle size={12} /> Expired
        </span>
      );
    default:
      return (
        <span className="flex items-center gap-1 text-xs opacity-50">
          <Unplug size={12} /> Not connected
        </span>
      );
  }
}

// --------------- Connection Card ---------------

/** Providers that return a list of external projects the user must pick from */
const PROVIDERS_WITH_PROJECT_PICKER = new Set<ConnectionProvider>([
  'supabase',   // extra.projects → [{ ref, name, region, status }]
  'firebase',   // future: extra.projects → [{ id, name }]
  'planetscale', // future: extra.projects → [{ id, name }]
]);

interface ConnectionCardProps {
  provider: ProviderMeta;
  projectId: string;
}

function ConnectionCard({ provider, projectId }: ConnectionCardProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const store = useConnectionsStore();
  const connection = store.projectConnections[projectId]?.[provider.id];
  const status = connection?.status || 'disconnected';
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  const [expanded, setExpanded] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState('');
  const available = isServiceAvailable(provider.id);

  // Two-step connection: token validated → pick external project (if applicable)
  const [pendingToken, setPendingToken] = useState('');
  const [pendingAccountInfo, setPendingAccountInfo] = useState<any>(null);
  const [pendingProjects, setPendingProjects] = useState<any[]>([]);
  const [selectedRef, setSelectedRef] = useState('');
  const needsProjectPicker = PROVIDERS_WITH_PROJECT_PICKER.has(provider.id);

  const serviceIcon = getServiceIcon(provider.id);

  /** Step 1: Validate the token. If provider has multiple projects, pause for selection. */
  const handleConnect = async () => {
    if (!tokenInput.trim()) {
      setError(`Please enter your ${provider.tokenName}`);
      return;
    }
    setError('');

    const service = getService(provider.id);
    if (!service) { setError('Service not available'); return; }

    store.setProjectConnecting(projectId, provider.id);

    try {
      const accountInfo = await service.testConnection(tokenInput.trim());
      const projects: any[] = accountInfo?.extra?.projects || [];

      if (needsProjectPicker && projects.length > 1) {
        // Multiple external projects — show picker before finalizing
        setPendingToken(tokenInput.trim());
        setPendingAccountInfo(accountInfo);
        setPendingProjects(projects);
        setSelectedRef(projects[0]?.ref || projects[0]?.id || '');
        // Reset connecting state (we're paused, not done)
        store.setProjectError(projectId, provider.id, '');
        // Clear the error badge — we're in "picking" state, not error
        return;
      }

      // Single project or no project picker needed — auto-select and finalize
      if (needsProjectPicker && projects.length === 1) {
        accountInfo.extra = {
          ...accountInfo.extra,
          selectedProjectRef: projects[0].ref || projects[0].id,
        };
      }

      store.setProjectConnected(projectId, provider.id, tokenInput.trim(), accountInfo);
      setTokenInput('');
      setShowToken(false);
      resetPending();
    } catch (err: any) {
      store.setProjectError(projectId, provider.id, err.message || 'Connection failed');
      setError(err.message || 'Connection failed');
    }
  };

  /** Step 2: User picked an external project — finalize the connection. */
  const handleFinalizePick = () => {
    if (!selectedRef || !pendingAccountInfo || !pendingToken) return;

    const accountInfo = {
      ...pendingAccountInfo,
      extra: {
        ...pendingAccountInfo.extra,
        selectedProjectRef: selectedRef,
      },
    };

    store.setProjectConnected(projectId, provider.id, pendingToken, accountInfo);
    setTokenInput('');
    setShowToken(false);
    resetPending();
  };

  const handleCancelPick = () => {
    resetPending();
    // Clear the connecting/error state back to disconnected
    store.disconnectProject(projectId, provider.id);
  };

  const resetPending = () => {
    setPendingToken('');
    setPendingAccountInfo(null);
    setPendingProjects([]);
    setSelectedRef('');
  };

  const handleDisconnect = () => {
    disconnectProjectProvider(projectId, provider.id);
    setTokenInput('');
    setError('');
    resetPending();
  };

  const handleRetest = async () => {
    setError('');
    const ok = await retestProjectConnection(projectId, provider.id);
    if (!ok) setError('Token is no longer valid');
  };

  const isPicking = pendingProjects.length > 1;

  // For connected providers that have a selectedProjectRef, show which one
  const selectedProjectName = (() => {
    const extra = connection?.accountInfo?.extra;
    if (!extra?.selectedProjectRef || !extra?.projects) return null;
    const proj = extra.projects.find(
      (p: any) => (p.ref || p.id) === extra.selectedProjectRef
    );
    return proj?.name || extra.selectedProjectRef;
  })();

  return (
    <div
      className={`overflow-hidden ${t.colors.bgSecondary} ${t.borderRadius} ${isConnected ? 'border' : ''}`}
      style={isConnected ? { borderColor: t.colors.accent.match(/#[0-9A-Fa-f]+/)?.[0] || '#2DB87A' } : undefined}
    >
      {/* Header Row */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {serviceIcon ? (
            <img
              src={serviceIcon}
              alt={provider.name}
              className="w-[30px] h-[30px] shrink-0"
            />
          ) : (
            <span className="text-sm font-bold shrink-0">
              {provider.name.charAt(0)}
            </span>
          )}
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{provider.name}</span>
              {!available && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                  Coming Soon
                </span>
              )}
            </div>
            <p className="text-xs opacity-50 mt-0.5">{provider.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <StatusBadge status={isPicking ? 'connecting' : status} />
          {expanded
            ? <ChevronUp size={14} className="opacity-50" />
            : <ChevronDown size={14} className="opacity-50" />
          }
        </div>
      </div>

      {/* Expanded Section */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t border-opacity-10 border-current">

          {/* Connected State */}
          {isConnected && connection && (
            <div className="space-y-3 mt-3">
              {connection.accountInfo && (
                <div className={`rounded-md p-3 text-xs ${
                  theme === 'light' ? 'bg-green-50 text-green-800' : 'bg-green-500/10 text-green-300'
                }`}>
                  {connection.accountInfo.name && (
                    <p className="font-medium">{connection.accountInfo.name}</p>
                  )}
                  {connection.accountInfo.email && (
                    <p className="opacity-70">{connection.accountInfo.email}</p>
                  )}
                  {connection.accountInfo.plan && (
                    <p className="opacity-70 mt-1">Plan: {connection.accountInfo.plan}</p>
                  )}
                  {selectedProjectName && (
                    <p className="opacity-70 mt-1">
                      Project: <span className="font-medium">{selectedProjectName}</span>
                    </p>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 text-xs opacity-50">
                <span>Token: {connection.tokenLabel}</span>
                {connection.lastTestedAt && (
                  <span>• Last tested: {new Date(connection.lastTestedAt).toLocaleDateString()}</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleRetest}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition"
                >
                  <RefreshCw size={12} /> Re-test
                </button>
                <button
                  onClick={handleDisconnect}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                >
                  <Unplug size={12} /> Disconnect
                </button>
              </div>
            </div>
          )}

          {/* Error State */}
          {(status === 'error' || status === 'expired') && !isPicking && (
            <div className="mt-3 space-y-3">
              <div className="rounded-md p-2 bg-red-500/10 text-red-400 text-xs">
                {connection?.error || 'Connection error'}
              </div>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
              >
                <Unplug size={12} /> Remove & Reconnect
              </button>
            </div>
          )}

          {/* Project Picker — shown after token validated, before finalizing */}
          {isPicking && (
            <div className="mt-3 space-y-3">
              <div className={`rounded-md p-3 text-xs ${
                theme === 'light' ? 'bg-blue-50 text-blue-800' : 'bg-blue-500/10 text-blue-300'
              }`}>
                <p className="font-medium mb-0.5">Token verified — {pendingAccountInfo?.name || 'connected'}</p>
                <p className="opacity-70">
                  {pendingProjects.length} {provider.name} projects found. Pick one for this Omnirun project:
                </p>
              </div>

              <div>
                <label className="text-xs font-medium opacity-60 block mb-1.5">
                  {provider.name} project
                </label>
                <select
                  value={selectedRef}
                  onChange={(e) => setSelectedRef(e.target.value)}
                  className={`w-full px-3 py-2 text-xs border outline-none focus:outline-none ${t.colors.bgSecondary} ${t.colors.border} ${t.colors.text} ${t.borderRadius}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  {pendingProjects.map((proj: any) => {
                    const ref = proj.ref || proj.id;
                    const label = proj.name || ref;
                    const detail = proj.region
                      ? ` (${proj.region}${proj.status && proj.status !== 'ACTIVE_HEALTHY' ? `, ${proj.status}` : ''})`
                      : '';
                    return (
                      <option key={ref} value={ref}>{label}{detail}</option>
                    );
                  })}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleFinalizePick(); }}
                  disabled={!selectedRef}
                  className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  <Plug size={12} /> Connect
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCancelPick(); }}
                  className="flex items-center gap-1.5 px-3 py-2 rounded text-xs opacity-60 hover:opacity-100 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Disconnected / Connect Form */}
          {!isPicking && (status === 'disconnected' || status === 'error' || status === 'expired') && (
            <div className="mt-3 space-y-3">
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const { openUrl } = await import('@tauri-apps/plugin-opener');
                    await openUrl(provider.tokenHelpUrl);
                  } catch {
                    window.open(provider.tokenHelpUrl, '_blank');
                  }
                }}
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition cursor-pointer"
              >
                Get your {provider.tokenName} <ExternalLink size={10} />
              </button>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={tokenInput}
                    onChange={(e) => { setTokenInput(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
                    placeholder={provider.tokenPlaceholder}
                    className={`w-full px-3 py-2 pr-8 text-xs border outline-none focus:outline-none ${t.colors.bgSecondary} ${t.colors.border} ${t.colors.text} ${t.borderRadius}`}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowToken(!showToken); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-50 hover:opacity-100"
                  >
                    {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); handleConnect(); }}
                  disabled={isConnecting || !tokenInput.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {isConnecting
                    ? <><Loader2 size={12} className="animate-spin" /> Testing...</>
                    : <><Plug size={12} /> Connect</>
                  }
                </button>
              </div>

              {error && (
                <div className="rounded-md p-2 bg-red-500/10 text-red-400 text-xs flex items-center gap-1.5">
                  <AlertCircle size={12} /> {error}
                </div>
              )}

              <div className="text-xs opacity-40">
                What we automate: {provider.features.join(' • ')}
              </div>
            </div>
          )}

          {/* Connecting State */}
          {isConnecting && !error && !isPicking && (
            <div className="mt-3 flex items-center gap-2 text-xs text-yellow-400">
              <Loader2 size={14} className="animate-spin" />
              Testing connection to {provider.name}...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --------------- Category Filter ---------------

function CategoryFilter({
  active,
  onChange,
}: {
  active: ConnectionCategory | 'all';
  onChange: (cat: ConnectionCategory | 'all') => void;
}) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const btnBase = 'px-3 py-1.5 rounded-full text-xs font-medium transition';
  const btnActive = 'bg-blue-600 text-white';
  const btnInactive = `${t.colors.bgSecondary} ${t.colors.textMuted} hover:opacity-80`;

  return (
    <div className="flex flex-wrap gap-2">
      <button
        onClick={() => onChange('all')}
        className={`${btnBase} ${active === 'all' ? btnActive : btnInactive}`}
      >
        All ({MVP_PROVIDERS.length})
      </button>
      {CATEGORIES.map((cat) => {
        const count = MVP_PROVIDERS.filter((p) => PROVIDERS[p].category === cat.id).length;
        if (count === 0) return null;
        return (
          <button
            key={cat.id}
            onClick={() => onChange(cat.id)}
            className={`${btnBase} ${active === cat.id ? btnActive : btnInactive}`}
          >
            {cat.label} ({count})
          </button>
        );
      })}
    </div>
  );
}

// --------------- Main Component ---------------

export default function ConnectionsSettings() {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const projects = useProjectStore((s) => s.projects);
  const currentProject = useProjectStore((s) => s.currentProject);
  const loadProjectConnectionsFromDB = useConnectionsStore((s) => s.loadProjectConnectionsFromDB);
  const projectConnections = useConnectionsStore((s) => s.projectConnections);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ConnectionCategory | 'all'>('all');
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);

  // Default to the currently open project, or the first in the list
  useEffect(() => {
    if (selectedProjectId) return;
    const defaultId = currentProject?.id || projects[0]?.id || null;
    setSelectedProjectId(defaultId);
  }, [projects, currentProject]);

  // Load this project's connections from DB whenever selection changes
  useEffect(() => {
    if (selectedProjectId) {
      loadProjectConnectionsFromDB(selectedProjectId);
    }
  }, [selectedProjectId]);

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || null;

  const connectedCount = selectedProjectId
    ? Object.values(projectConnections[selectedProjectId] || {}).filter(
        (c) => c?.status === 'connected'
      ).length
    : 0;

  const filteredProviders = MVP_PROVIDERS.filter((p) => {
    if (activeCategory === 'all') return true;
    return PROVIDERS[p].category === activeCategory;
  });

  const sortedProviders = [...filteredProviders].sort((a, b) => {
    const aConn = projectConnections[selectedProjectId || '']?.[a]?.status === 'connected' ? 0 : 1;
    const bConn = projectConnections[selectedProjectId || '']?.[b]?.status === 'connected' ? 0 : 1;
    if (aConn !== bConn) return aConn - bConn;
    return PROVIDERS[a].name.localeCompare(PROVIDERS[b].name);
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold mb-2">Project Connections</h1>
        <p className={`${t.colors.textMuted} mb-6`}>
          Connect your project accounts to deploy, manage databases, process payments, and more — all without leaving Omnirun.
        </p>
      </div>

      {/* Project Selector */}
      <div className="flex items-center gap-3">
        <FolderOpen size={16} className="opacity-60 shrink-0" />
        <label className="text-xs font-medium opacity-60">Project</label>

        {projects.length === 0 ? (
          <p className="text-sm opacity-40">No projects yet — create a project first.</p>
        ) : (
          <div className="relative">
            <button
              onClick={() => setProjectDropdownOpen((o) => !o)}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm border transition-opacity hover:opacity-80 ${t.colors.bgSecondary} ${t.colors.border} ${t.colors.text} ${t.borderRadius}`}
            >
              <span className="truncate max-w-[200px]">
                {selectedProject?.name || 'Select project'}
              </span>
              <ChevronDown
                size={12}
                className={`opacity-50 transition-transform ${projectDropdownOpen ? 'rotate-180' : ''}`}
              />
            </button>

            {projectDropdownOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setProjectDropdownOpen(false)} />
                <div className={`absolute left-0 top-full mt-1 w-56 border shadow-xl z-20 overflow-hidden py-1 ${t.colors.bg} ${t.colors.border} ${t.borderRadius}`}>
                  {projects.map((p) => {
                    const isActive = p.id === selectedProjectId;
                    const pConnCount = Object.values(projectConnections[p.id] || {}).filter(
                      (c) => c?.status === 'connected'
                    ).length;
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedProjectId(p.id);
                          setProjectDropdownOpen(false);
                        }}
                        className={`w-full flex items-center justify-between px-3 py-1.5 text-xs text-left transition-opacity hover:opacity-70 ${
                          isActive ? 'opacity-100' : 'opacity-60'
                        }`}
                      >
                        <span className="truncate">{p.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          {pConnCount > 0 && (
                            <span className="text-[10px] text-green-400">{pConnCount} connected</span>
                          )}
                          {isActive && (
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {connectedCount > 0 && (
          <span className="text-xs text-green-400 shrink-0 font-medium">
            {connectedCount} connected
          </span>
        )}
      </div>

      {/* Category Tabs + Cards */}
      {selectedProject ? (
        <>
          <CategoryFilter active={activeCategory} onChange={setActiveCategory} />

          <div className="space-y-2">
            {sortedProviders.map((providerId) => (
              <ConnectionCard
                key={providerId}
                provider={PROVIDERS[providerId]}
                projectId={selectedProject.id}
              />
            ))}
          </div>
        </>
      ) : (
        projects.length > 0 && (
          <p className="text-sm opacity-40 text-center py-8">
            Select a project above to manage its connections.
          </p>
        )
      )}

      {/* Security Note */}
      <div className={`p-3 text-xs opacity-50 ${t.colors.bgSecondary} ${t.borderRadius}`}>
        <div className="flex items-center gap-1.5 font-medium mb-1">
          <Shield size={12} /> Security
        </div>
        <p>
          Tokens are stored locally on your device. They are never sent to Omnirun servers.
          All API calls go directly from your machine to the service provider.
        </p>
        <p className="mt-1 opacity-70">
          Phase 2: Tokens will be encrypted via OS Keychain (macOS) / Credential Manager (Windows).
        </p>
      </div>
    </div>
  );
}