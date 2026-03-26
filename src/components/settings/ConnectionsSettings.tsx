// ============================================================
// ConnectionsSettings.tsx - Project Connections Hub UI
// ============================================================

import { useState, useEffect } from 'react';
import {
  Github,
  Triangle,
  Globe,
  Database,
  CreditCard,
  Mail,
  Shield,
  Globe2,
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
  Rabbit,
  Send,
  Landmark,
  FolderOpen,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { useProjectStore } from '../../stores/projectStore';
import {
  PROVIDERS,
  MVP_PROVIDERS,
  CATEGORIES,
  isServiceAvailable,
  connectProjectProvider,
  disconnectProjectProvider,
  retestProjectConnection,
} from '../../services/connections';
import type { ConnectionProvider, ConnectionCategory, ProviderMeta } from '../../services/connections/types';

// --------------- Icon Map ---------------

const ICONS: Record<string, any> = {
  Github,
  Triangle,
  Globe,
  Database,
  CreditCard,
  Mail,
  Shield,
  Globe2,
  Rabbit,
  Send,
  Landmark,
};

function getIcon(iconName: string) {
  return ICONS[iconName] || Globe;
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

interface ConnectionCardProps {
  provider: ProviderMeta;
  projectId: string;
}

function ConnectionCard({ provider, projectId }: ConnectionCardProps) {
  const { theme } = useSettingsStore();
  const connection = useConnectionsStore(
    (s) => s.projectConnections[projectId]?.[provider.id]
  );
  const status = connection?.status || 'disconnected';
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  const [expanded, setExpanded] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState('');
  const available = isServiceAvailable(provider.id);

  const Icon = getIcon(provider.icon);

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
    : 'bg-gray-800 border border-gray-700';

  const bgInput = theme === 'light'
    ? 'bg-gray-100 border-gray-300 text-gray-900'
    : theme === 'sepia'
    ? 'bg-stone-900 border-stone-600 text-orange-100'
    : theme === 'retro'
    ? 'bg-black border-green-700 text-green-400 font-mono'
    : theme === 'midnight'
    ? 'bg-slate-950 border-slate-600 text-slate-100'
    : theme === 'highContrast'
    ? 'bg-black border-white text-white'
    : 'bg-gray-900 border-gray-600 text-white';

  const handleConnect = async () => {
    if (!tokenInput.trim()) {
      setError(`Please enter your ${provider.tokenName}`);
      return;
    }
    setError('');
    try {
      await connectProjectProvider(projectId, provider.id, tokenInput.trim());
      setTokenInput('');
      setShowToken(false);
    } catch (err: any) {
      setError(err.message || 'Connection failed');
    }
  };

  const handleDisconnect = () => {
    disconnectProjectProvider(projectId, provider.id);
    setTokenInput('');
    setError('');
  };

  const handleRetest = async () => {
    setError('');
    const ok = await retestProjectConnection(projectId, provider.id);
    if (!ok) setError('Token is no longer valid');
  };

  return (
    <div className={`rounded-lg overflow-hidden ${bgCard}`}>
      {/* Header Row */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center"
            style={{
              backgroundColor: isConnected
                ? 'rgba(74, 222, 128, 0.15)'
                : 'rgba(148, 163, 184, 0.15)',
            }}
          >
            <Icon size={18} className={isConnected ? 'text-green-400' : 'opacity-60'} />
          </div>
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
          <StatusBadge status={status} />
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
          {(status === 'error' || status === 'expired') && (
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

          {/* Disconnected / Connect Form */}
          {(status === 'disconnected' || status === 'error' || status === 'expired') && (
            <div className="mt-3 space-y-3">
              <a
                href={provider.tokenHelpUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition"
                onClick={(e) => e.stopPropagation()}
              >
                Get your {provider.tokenName} <ExternalLink size={10} />
              </a>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <input
                    type={showToken ? 'text' : 'password'}
                    value={tokenInput}
                    onChange={(e) => { setTokenInput(e.target.value); setError(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleConnect(); }}
                    placeholder={provider.tokenPlaceholder}
                    className={`w-full px-3 py-2 pr-8 rounded text-xs border outline-none focus:ring-1 focus:ring-blue-500 ${bgInput}`}
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
          {isConnecting && !error && (
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

  const btnBase = 'px-3 py-1.5 rounded-full text-xs font-medium transition';
  const btnActive = theme === 'light'
    ? 'bg-blue-500 text-white'
    : theme === 'retro'
    ? 'bg-green-700 text-black'
    : 'bg-blue-600 text-white';
  const btnInactive = theme === 'light'
    ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
    : theme === 'retro'
    ? 'bg-black text-green-500 border border-green-800 hover:bg-green-900/30'
    : 'bg-gray-800 text-gray-400 hover:bg-gray-700';

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
  const projects = useProjectStore((s) => s.projects);
  const currentProject = useProjectStore((s) => s.currentProject);
  const loadProjectConnectionsFromDB = useConnectionsStore((s) => s.loadProjectConnectionsFromDB);
  const projectConnections = useConnectionsStore((s) => s.projectConnections);

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<ConnectionCategory | 'all'>('all');

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

  const bgSelect = theme === 'light'
    ? 'bg-white border-gray-300 text-gray-900'
    : theme === 'sepia'
    ? 'bg-stone-800 border-stone-600 text-orange-100'
    : theme === 'retro'
    ? 'bg-black border-green-700 text-green-400 font-mono'
    : theme === 'midnight'
    ? 'bg-slate-900 border-slate-600 text-slate-100'
    : theme === 'highContrast'
    ? 'bg-black border-white text-white'
    : 'bg-gray-800 border-gray-600 text-white';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold">Project Connections</h2>
        <p className="text-sm opacity-60 mt-1">
          Connect your project accounts to deploy, manage databases, process payments, and more — all without leaving Omnirun.
        </p>
      </div>

      {/* Project Selector */}
      <div className={`rounded-lg p-4 w-1/3 ${
        theme === 'light'
          ? 'bg-gray-50 border border-gray-200'
          : 'bg-gray-800/60 border border-gray-700'
      }`}>
        <div className="flex items-center gap-3">
          <FolderOpen size={16} className="opacity-60 shrink-0" />
          <div className="flex-1 min-w-0">
            <label className="text-xs font-medium opacity-60 block mb-1.5">Project</label>
            {projects.length === 0 ? (
              <p className="text-sm opacity-40">No projects yet — create a project first.</p>
            ) : (
              <select
                value={selectedProjectId || ''}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className={`w-full px-3 py-2 rounded text-sm border outline-none focus:ring-1 focus:ring-blue-500 ${bgSelect}`}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>
          {connectedCount > 0 && (
            <span className="text-xs text-green-400 shrink-0 font-medium">
              {connectedCount} connected
            </span>
          )}
        </div>
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
      <div className={`rounded-lg p-3 text-xs opacity-50 ${
        theme === 'light' ? 'bg-gray-50' : 'bg-gray-800/50'
      }`}>
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