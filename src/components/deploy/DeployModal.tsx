// ============================================================
// DeployModal.tsx — Deploy progress + result modal
// ============================================================
// Subscribes to useDeployStore and renders the current stage.
// Reachable from: Topbar Deploy button, DeployPage "Deploy Now"
// button, or any programmatic deploy (e.g. the `deploy` AI tool).
// ============================================================

import { useState } from 'react';
import {
  Rocket,
  CheckCircle2,
  XCircle,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  X,
  Triangle,
  Globe,
  Cloud,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useDeployStore, type DeployStage } from '../../stores/deployStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useDeployTargetStore } from '../../stores/deployTargetStore';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { themes } from '../../config/themes';

// Stages shown in the progress tracker (idle + starting are hidden as
// their own step — they roll into "reading_files").
const STEPS: { id: DeployStage; label: string }[] = [
  { id: 'reading_files', label: 'Reading files' },
  { id: 'uploading', label: 'Uploading' },
  { id: 'building', label: 'Building' },
  { id: 'live', label: 'Live' },
];

function stageIndex(stage: DeployStage): number {
  const idx = STEPS.findIndex((s) => s.id === stage);
  return idx === -1 ? 0 : idx;
}

export default function DeployModal() {
  const { open, stage, message, url, dashboardUrl: deploymentDashboardUrl, error, provider, close } = useDeployStore();
  const { theme } = useSettingsStore();
  const currentProject = useProjectStore((s) => s.currentProject);
  const deployTargets = useDeployTargetStore((s) => s.targets);
  const projectConnections = useConnectionsStore((s) => s.projectConnections);
  const t = themes[theme];
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const inProgress = stage !== 'live' && stage !== 'failed' && stage !== 'idle';
  const succeeded = stage === 'live';
  const failed = stage === 'failed';
  const current = stageIndex(stage);

  // Saved target info for the "View on Vercel/Netlify/Cloudflare" links.
  const savedTarget = currentProject ? deployTargets[currentProject.id] : null;

  // Build account slug from the connection's accountInfo so we can make
  // correct dashboard URLs (Vercel includes the user/team slug in its path).
  const accountSlug = (() => {
    if (!savedTarget || !currentProject) return null;
    const conn = projectConnections[currentProject.id]?.[savedTarget.provider];
    const info: any = conn?.accountInfo;
    if (!info) return null;
    return info.username || info.slug || info.extra?.username || info.extra?.slug || null;
  })();

  // Prefer the provider's own URL from the deployment response (never 404s).
  // Fall back to a URL we construct from the saved target + account slug.
  const dashboardUrl =
    deploymentDashboardUrl ||
    (savedTarget ? buildDashboardUrl(savedTarget, accountSlug) : null);

  // Prefer the saved target's provider (always accurate) over the
  // in-flight `provider` from the deploy store (may clear between runs).
  const resolvedProvider = savedTarget?.provider || provider;
  const providerLabel = resolvedProvider
    ? (resolvedProvider === 'vercel'
        ? 'Vercel'
        : resolvedProvider === 'netlify'
          ? 'Netlify'
          : 'Cloudflare')
    : '';
  const providerIcon = resolvedProvider
    ? (resolvedProvider === 'vercel'
        ? Triangle
        : resolvedProvider === 'netlify'
          ? Globe
          : Cloud)
    : Rocket;

  const handleCopy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const handleOpenUrl = async () => {
    if (!url) return;
    try {
      await openUrl(url);
    } catch (e) {
      console.error('Failed to open deploy URL:', e);
    }
  };

  const handleOpenDashboard = async () => {
    if (!dashboardUrl) return;
    try {
      await openUrl(dashboardUrl);
    } catch (e) {
      console.error('Failed to open provider dashboard:', e);
    }
  };

  const handleViewInOmniRun = () => {
    // Navigate to the Deploy page inside OmniRun. MainLayout listens
    // for this window event and calls handleToolsNavigate.
    window.dispatchEvent(new CustomEvent('omnirun-navigate-tools', { detail: 'deploy' }));
    close();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={inProgress ? undefined : close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md mx-4 ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-2xl overflow-hidden`}
      >
        {/* Header */}
        <div className={`flex items-center gap-3 px-5 py-4 ${t.colors.border} border-b`}>
          <Rocket size={18} className={t.colors.textMuted} />
          <div className="flex-1 min-w-0">
            <div className={`text-sm font-medium ${t.colors.text}`}>
              {succeeded ? 'Deployed' : failed ? 'Deploy failed' : 'Deploying'}
            </div>
            {provider && (
              <div className={`text-xs ${t.colors.textMuted}`}>to {provider}</div>
            )}
          </div>
          {!inProgress && (
            <button
              onClick={close}
              className={`p-1 ${t.borderRadius} ${t.colors.text} hover:bg-white/10 transition-colors`}
              title="Close"
            >
              <X size={16} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          {/* Stage tracker */}
          {!failed && (
            <div className="flex items-center justify-between mb-5">
              {STEPS.map((step, i) => {
                const done = i < current || succeeded;
                const active = i === current && !succeeded;
                return (
                  <div key={step.id} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center gap-1.5">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                          done
                            ? 'bg-green-500 text-white'
                            : active
                            ? 'bg-blue-500 text-white'
                            : `${t.colors.bgTertiary || t.colors.bg} ${t.colors.textMuted}`
                        }`}
                      >
                        {done ? (
                          <Check size={14} />
                        ) : active ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          i + 1
                        )}
                      </div>
                      <div
                        className={`text-[11px] ${
                          done || active ? t.colors.text : t.colors.textMuted
                        }`}
                      >
                        {step.label}
                      </div>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div
                        className={`flex-1 h-0.5 mx-2 mb-5 ${
                          done ? 'bg-green-500' : t.colors.bgTertiary || 'bg-white/10'
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* In-progress message */}
          {inProgress && (
            <div
              className={`flex items-center gap-2 px-3 py-2 ${t.borderRadius} ${t.colors.bgTertiary || 'bg-white/5'} ${t.colors.textMuted} text-sm`}
            >
              <Loader2 size={14} className="animate-spin flex-shrink-0" />
              <span className="truncate">{message || 'Working…'}</span>
            </div>
          )}

          {/* Success */}
          {succeeded && url && (
            <div className="space-y-3">
              <div className={`flex items-center gap-2 text-green-400 text-sm`}>
                <CheckCircle2 size={16} />
                Your site is live
              </div>
              <div
                className={`flex items-center gap-2 px-3 py-2.5 ${t.borderRadius} ${t.colors.bgTertiary || 'bg-white/5'}`}
              >
                <div className={`flex-1 truncate text-sm ${t.colors.text}`}>{url}</div>
                <button
                  onClick={handleCopy}
                  title="Copy URL"
                  className={`p-1.5 ${t.borderRadius} ${t.colors.textMuted} hover:bg-white/10 transition-colors`}
                >
                  {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleOpenUrl}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 ${t.borderRadius} bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors`}
                >
                  <ExternalLink size={14} />
                  Open site
                </button>
                <button
                  onClick={close}
                  className={`px-4 py-2 ${t.borderRadius} ${t.colors.border} border ${t.colors.text} text-sm hover:bg-white/10 transition-colors`}
                >
                  Done
                </button>
              </div>

              {/* Secondary links — view on provider dashboard + in OmniRun */}
              <div className={`flex items-center justify-center gap-5 pt-2 text-xs ${t.colors.textMuted}`}>
                {dashboardUrl && (
                  <button
                    onClick={handleOpenDashboard}
                    className={`flex items-center gap-1.5 hover:${t.colors.text} transition-colors`}
                  >
                    {(() => {
                      const Icon = providerIcon;
                      return <Icon size={12} />;
                    })()}
                    View on {providerLabel}
                  </button>
                )}
                <button
                  onClick={handleViewInOmniRun}
                  className={`flex items-center gap-1.5 hover:${t.colors.text} transition-colors`}
                >
                  <Rocket size={12} />
                  View in OmniRun
                </button>
              </div>
            </div>
          )}

          {/* Failure */}
          {failed && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <XCircle size={16} />
                Deploy failed
              </div>
              <div
                className={`px-3 py-2.5 ${t.borderRadius} bg-red-500/10 text-red-300 text-sm whitespace-pre-wrap break-words`}
              >
                {error || message || 'Unknown error'}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={close}
                  className={`flex-1 px-4 py-2 ${t.borderRadius} ${t.colors.border} border ${t.colors.text} text-sm hover:bg-white/10 transition-colors`}
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Helpers ---------------------------------------------------

function buildDashboardUrl(
  target: {
    provider: string;
    remoteProjectId: string;
    remoteProjectName: string;
    cloudflareAccountId?: string;
  },
  accountSlug: string | null
): string | null {
  switch (target.provider) {
    case 'vercel':
      // Real Vercel dashboard pattern: vercel.com/{username-or-team}/{project}/deployments
      // If we couldn't resolve the account slug, fall back to the generic
      // dashboard listing which will still work (just not deep-linked).
      if (accountSlug) {
        return `https://vercel.com/${accountSlug}/${target.remoteProjectName}/deployments`;
      }
      return `https://vercel.com/dashboard`;
    case 'netlify':
      // Netlify: app.netlify.com/sites/{site-name} (no account slug needed)
      return `https://app.netlify.com/sites/${target.remoteProjectName}`;
    case 'cloudflare':
      if (!target.cloudflareAccountId) return 'https://dash.cloudflare.com';
      return `https://dash.cloudflare.com/${target.cloudflareAccountId}/pages/view/${target.remoteProjectName}`;
    default:
      return null;
  }
}