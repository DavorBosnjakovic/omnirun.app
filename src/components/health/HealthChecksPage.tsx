// ============================================================
// HealthChecksPage.tsx - Project Health Check Dashboard
// ============================================================
// Two tabs: Checks (overview + run scan) and Results (issues).
// Scans run locally via healthScanner.ts — no chat involvement.
// Only "Fix" buttons send to chat.

import { useState, useCallback } from 'react';
import {
  Activity,
  Shield,
  Gauge,
  Eye,
  Search,
  FileCode,
  Play,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  ChevronDown,
  ChevronRight,
  Wrench,
  Clock,
  RefreshCw,
  FileWarning,
  Sparkles,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { themes } from '../../config/themes';
import { runHealthScan } from '../../services/healthScanner';

// --------------- Types ---------------

export type CheckCategory = 'security' | 'performance' | 'accessibility' | 'seo' | 'code-quality';
export type IssueSeverity = 'critical' | 'warning' | 'info';

export interface HealthIssue {
  id: string;
  category: CheckCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  file?: string;
  line?: number;
  fixMessage?: string;
  fixLabel?: string;
}

export interface ScanResult {
  timestamp: number;
  issues: HealthIssue[];
  scannedFiles: number;
  duration: number;
}

// --------------- Category Config ---------------

const CATEGORIES: {
  id: CheckCategory;
  label: string;
  icon: typeof Shield;
  description: string;
  checks: string[];
}[] = [
  {
    id: 'security',
    label: 'Security',
    icon: Shield,
    description: 'API keys, secrets, dependencies, HTTPS',
    checks: [
      'Exposed API keys or secrets in code',
      'Hardcoded passwords and tokens',
      'Database connection strings with credentials',
      'Private keys committed to source',
      'Bearer tokens in source files',
    ],
  },
  {
    id: 'performance',
    label: 'Performance',
    icon: Gauge,
    description: 'Images, bundle size, lazy loading',
    checks: [
      'Large unoptimized images (> 500KB)',
      'Large inline base64 data URIs',
      'Missing lazy loading on images',
      'Unminified JS/CSS in output directories',
      'Large bundle indicators',
    ],
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    icon: Eye,
    description: 'Alt text, contrast, keyboard nav',
    checks: [
      'Images missing alt text',
      'Icon-only buttons without aria-label',
      'Form inputs missing labels',
      'Missing ARIA attributes on interactive elements',
      'Keyboard navigation issues',
    ],
  },
  {
    id: 'seo',
    label: 'SEO',
    icon: Search,
    description: 'Meta tags, sitemap, structured data',
    checks: [
      'Missing <title> tag',
      'Missing meta description',
      'Missing Open Graph tags',
      'Missing robots.txt',
      'Missing sitemap.xml',
    ],
  },
  {
    id: 'code-quality',
    label: 'Code Quality',
    icon: FileCode,
    description: 'Console.logs, TODOs, large files',
    checks: [
      'Console.log statements left in code',
      'TODO/FIXME comments piling up',
      'Excessive imports per file',
      'Very large files (500+ lines)',
      'Unused code indicators',
    ],
  },
];

// --------------- Helpers ---------------

function severityLabel(s: IssueSeverity): string {
  if (s === 'critical') return 'Critical';
  if (s === 'warning') return 'Warning';
  return 'Info';
}

function SeverityIcon({ severity, size = 14 }: { severity: IssueSeverity; size?: number }) {
  if (severity === 'critical') return <XCircle size={size} style={{ color: '#ef4444' }} />;
  if (severity === 'warning') return <AlertTriangle size={size} style={{ color: '#f59e0b' }} />;
  return <Info size={size} style={{ color: '#3b82f6' }} />;
}

function formatTimeAgo(ts: number): string {
  if (!ts) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

// --------------- Main Component ---------------

interface HealthChecksPageProps {
  onSendToChat?: (message: string) => void;
  onSettingsClick?: (tab: string) => void;
}

type TabId = 'checks' | 'results';

export default function HealthChecksPage({ onSendToChat }: HealthChecksPageProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { currentProject } = useProjectStore();

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('checks');

  // Scan state
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [scanFilesDone, setScanFilesDone] = useState(0);
  const [scanFilesTotal, setScanFilesTotal] = useState(0);

  // Results state
  const [expandedCategory, setExpandedCategory] = useState<CheckCategory | null>(null);
  const [filterSeverity, setFilterSeverity] = useState<IssueSeverity | 'all'>('all');

  // Theme-aware card styles
  const bgCard =
    theme === 'light' ? 'bg-white border border-gray-200 shadow-sm'
    : theme === 'sepia' ? 'bg-stone-800 border border-stone-700'
    : theme === 'retro' ? 'bg-black border border-green-800'
    : theme === 'midnight' ? 'bg-slate-900 border border-slate-700'
    : theme === 'highContrast' ? 'bg-black border border-white'
    : `${t.colors.bgSecondary} ${t.colors.border} border`;

  const dividerColor =
    theme === 'light' ? 'divide-gray-100'
    : theme === 'retro' ? 'divide-green-900/50'
    : 'divide-white/5';

  // ── Run local scan ──
  const handleRunScan = useCallback(async () => {
    setIsScanning(true);
    setScanProgress('Starting scan...');
    setScanFilesDone(0);
    setScanFilesTotal(0);

    try {
      const result = await runHealthScan((msg, done, total) => {
        setScanProgress(msg);
        setScanFilesDone(done);
        setScanFilesTotal(total);
      });
      setScanResult(result);
      setActiveTab('results');
    } catch (err: any) {
      console.error('Health scan failed:', err);
      setScanProgress(`Scan failed: ${err.message || 'Unknown error'}`);
    } finally {
      setIsScanning(false);
    }
  }, []);

  // ── Fix handlers (these go to chat) ──
  const handleFixIssue = (issue: HealthIssue) => {
    if (!onSendToChat) return;
    onSendToChat(
      issue.fixMessage || `Fix this: ${issue.title}${issue.file ? ` in ${issue.file}` : ''}`
    );
  };

  const handleFixCategory = (category: CheckCategory) => {
    if (!onSendToChat || !scanResult) return;
    const issues = scanResult.issues.filter((i) => i.category === category);
    if (issues.length === 0) return;
    const cat = CATEGORIES.find((c) => c.id === category);
    onSendToChat(
      `Fix all ${cat?.label || category} issues: ` +
      issues.map((i) => `${i.title}${i.file ? ` (${i.file})` : ''}`).join('; ')
    );
  };

  const handleFixAll = () => {
    if (!onSendToChat || !scanResult) return;
    onSendToChat(
      `Fix all ${scanResult.issues.length} health check issues. Prioritize critical first, then warnings. ` +
      `Issues: ${scanResult.issues.map((i) => `[${i.severity}] ${i.title}${i.file ? ` (${i.file})` : ''}`).join('; ')}`
    );
  };

  // ── Count helpers ──
  const getCount = (cat: CheckCategory) =>
    scanResult?.issues.filter((i) => i.category === cat).length || 0;

  const getCriticalCount = () =>
    scanResult?.issues.filter((i) => i.severity === 'critical').length || 0;

  const getWarningCount = () =>
    scanResult?.issues.filter((i) => i.severity === 'warning').length || 0;

  const getInfoCount = () =>
    scanResult?.issues.filter((i) => i.severity === 'info').length || 0;

  const totalIssues = scanResult?.issues.length || 0;

  const filteredIssues = (cat: CheckCategory) => {
    if (!scanResult) return [];
    return scanResult.issues.filter(
      (i) => i.category === cat && (filterSeverity === 'all' || i.severity === filterSeverity)
    );
  };

  // ══════════════════════════════════════════════
  // No project open
  // ══════════════════════════════════════════════

  if (!currentProject) {
    return (
      <div className="max-w-3xl mx-auto w-full">
        <div className="flex items-center gap-3 mb-6">
          <Activity size={24} className={t.colors.textMuted} />
          <h1 className={`text-xl font-semibold ${t.colors.text}`}>Health Checks</h1>
        </div>
        <div className={`text-center py-16 ${t.colors.textMuted}`}>
          <Activity size={32} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Open a project first to run health checks.</p>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════════
  // Render
  // ══════════════════════════════════════════════

  return (
    <div className="max-w-3xl mx-auto w-full">

      {/* ── Header with tab toggle ── */}
      <div className="flex items-center gap-3 mb-6">
        <Activity size={24} className={t.colors.textMuted} />
        <h1 className={`text-xl font-semibold ${t.colors.text}`}>Health Checks</h1>

        {/* Tab toggle — right aligned */}
        <div className={`ml-auto inline-flex ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} p-0.5`}>
          <button
            onClick={() => setActiveTab('checks')}
            className={`px-3 py-1 text-xs font-medium ${t.borderRadius} transition-all duration-200 ${
              activeTab === 'checks'
                ? `${t.colors.accent} ${theme === 'highContrast' ? 'text-black' : 'text-white'} shadow-sm`
                : `${t.colors.textMuted} hover:bg-white/5`
            }`}
          >
            Checks
          </button>
          <button
            onClick={() => setActiveTab('results')}
            className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium ${t.borderRadius} transition-all duration-200 ${
              activeTab === 'results'
                ? `${t.colors.accent} ${theme === 'highContrast' ? 'text-black' : 'text-white'} shadow-sm`
                : `${t.colors.textMuted} hover:bg-white/5`
            }`}
          >
            Results
            {scanResult && (
              <span className={`text-[10px] px-1 rounded ${
                activeTab === 'results'
                  ? 'bg-white/20'
                  : getCriticalCount() > 0
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-white/10'
              }`}>
                {totalIssues}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ══════════════ CHECKS TAB ══════════════ */}
      {activeTab === 'checks' && (
        <>
          <p className={`text-sm ${t.colors.textMuted} mb-5`}>
            Scan{' '}
            <strong className={t.colors.text}>{currentProject.name}</strong>
            {' '}for security risks, performance issues, accessibility problems, and more.
          </p>

          {/* Category cards grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              const count = getCount(cat.id);
              const hasScan = scanResult !== null;

              return (
                <div key={cat.id} className={`${bgCard} ${t.borderRadius} p-4`}>
                  <div className="flex items-center gap-2.5 mb-2">
                    <Icon size={16} className={t.colors.textMuted} />
                    <span className={`text-sm font-medium ${t.colors.text}`}>
                      {cat.label}
                    </span>
                    {hasScan && (
                      count === 0
                        ? <CheckCircle2 size={13} className="text-green-400 ml-auto" />
                        : <span className="ml-auto text-xs font-medium text-amber-400">
                            {count} issue{count > 1 ? 's' : ''}
                          </span>
                    )}
                  </div>
                  <p className={`text-xs ${t.colors.textMuted} mb-2.5`}>
                    {cat.description}
                  </p>
                  <ul className={`text-xs ${t.colors.textMuted} opacity-70 space-y-1`}>
                    {cat.checks.map((check, i) => (
                      <li key={i} className="flex items-start gap-1.5">
                        <span className="mt-0.5 opacity-50">•</span>
                        {check}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {/* Scan button + progress */}
          <div className="text-center">
            <button
              onClick={handleRunScan}
              disabled={isScanning}
              className={`inline-flex items-center gap-2 px-6 py-2.5 text-sm font-medium ${t.borderRadius} ${t.colors.accent} ${
                theme === 'highContrast' ? 'text-black' : 'text-white'
              } ${t.colors.accentHover} transition-colors disabled:opacity-60`}
            >
              {isScanning ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Scanning...
                </>
              ) : (
                <>
                  <Play size={14} />
                  {scanResult ? 'Rescan' : 'Run Full Scan'}
                </>
              )}
            </button>

            {/* Progress indicator */}
            {isScanning && (
              <div className="mt-3">
                <p className={`text-xs ${t.colors.textMuted}`}>{scanProgress}</p>
                {scanFilesTotal > 0 && (
                  <div className="mt-2 max-w-xs mx-auto">
                    <div className={`h-1 ${t.borderRadius} ${t.colors.bgSecondary} overflow-hidden`}>
                      <div
                        className="h-full bg-green-500 transition-all duration-200"
                        style={{ width: `${Math.round((scanFilesDone / scanFilesTotal) * 100)}%` }}
                      />
                    </div>
                    <p className={`text-[10px] ${t.colors.textMuted} mt-1`}>
                      {scanFilesDone} / {scanFilesTotal} files
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Status line */}
            {!isScanning && !scanResult && (
              <p className={`text-xs ${t.colors.textMuted} mt-3 opacity-60`}>
                Scans your actual project files locally. No AI tokens used.
              </p>
            )}
            {!isScanning && scanResult && (
              <p className={`text-xs ${t.colors.textMuted} mt-3 opacity-60`}>
                Last scan: {formatTimeAgo(scanResult.timestamp)} · {scanResult.scannedFiles} files · {scanResult.duration}ms
              </p>
            )}
          </div>
        </>
      )}

      {/* ══════════════ RESULTS TAB ══════════════ */}
      {activeTab === 'results' && (
        <>
          {/* No results yet */}
          {!scanResult && !isScanning && (
            <div className={`text-center py-16 ${t.colors.textMuted}`}>
              <Activity size={28} className="mx-auto mb-3 opacity-40" />
              <p className="text-sm mb-2">No scan results yet</p>
              <button
                onClick={() => {
                  setActiveTab('checks');
                  handleRunScan();
                }}
                className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium ${t.borderRadius} ${t.colors.accent} ${
                  theme === 'highContrast' ? 'text-black' : 'text-white'
                } ${t.colors.accentHover} transition-colors`}
              >
                <Play size={12} />
                Run Scan
              </button>
            </div>
          )}

          {/* Scanning indicator */}
          {isScanning && (
            <div className={`${bgCard} ${t.borderRadius} p-8 text-center`}>
              <Loader2 size={28} className="animate-spin mx-auto mb-4 text-blue-400" />
              <p className={`text-sm ${t.colors.text} font-medium mb-1`}>
                Scanning {currentProject.name}...
              </p>
              <p className={`text-xs ${t.colors.textMuted}`}>{scanProgress}</p>
              {scanFilesTotal > 0 && (
                <div className="mt-3 max-w-xs mx-auto">
                  <div className={`h-1 ${t.borderRadius} ${t.colors.bgSecondary} overflow-hidden`}>
                    <div
                      className="h-full bg-green-500 transition-all duration-200"
                      style={{ width: `${Math.round((scanFilesDone / scanFilesTotal) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Scan results */}
          {scanResult && !isScanning && (
            <>
              {/* ── Summary bar ── */}
              <div className={`${bgCard} ${t.borderRadius} p-4 mb-5`}>
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-4">
                    {totalIssues === 0 ? (
                      <div className="flex items-center gap-2">
                        <CheckCircle2 size={20} className="text-green-400" />
                        <span className={`text-sm font-medium ${t.colors.text}`}>
                          All clear — no issues found
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <FileWarning
                          size={20}
                          style={{ color: getCriticalCount() > 0 ? '#ef4444' : '#f59e0b' }}
                        />
                        <span className={`text-sm font-medium ${t.colors.text}`}>
                          {totalIssues} issue{totalIssues !== 1 ? 's' : ''} found
                        </span>
                      </div>
                    )}

                    {/* Severity counts */}
                    <div className="flex items-center gap-3">
                      {getCriticalCount() > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-red-400">
                          <XCircle size={11} /> {getCriticalCount()} critical
                        </span>
                      )}
                      {getWarningCount() > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-amber-400">
                          <AlertTriangle size={11} /> {getWarningCount()}
                        </span>
                      )}
                      {getInfoCount() > 0 && (
                        <span className="flex items-center gap-1 text-xs font-medium text-blue-400">
                          <Info size={11} /> {getInfoCount()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Meta + rescan */}
                  <div className="flex items-center gap-3">
                    <span className={`text-xs ${t.colors.textMuted} flex items-center gap-1`}>
                      <Clock size={11} />
                      {formatTimeAgo(scanResult.timestamp)} · {scanResult.scannedFiles} files
                    </span>
                    <button
                      onClick={handleRunScan}
                      disabled={isScanning}
                      className={`flex items-center gap-1.5 px-2.5 py-1 text-xs ${t.borderRadius} ${t.colors.border} border ${t.colors.textMuted} hover:bg-white/10 transition-colors`}
                    >
                      <RefreshCw size={11} />
                      Rescan
                    </button>
                  </div>
                </div>

                {/* Fix all button */}
                {totalIssues > 0 && (
                  <div className={`flex items-center gap-2 mt-3 pt-3 border-t ${
                    theme === 'light' ? 'border-gray-100' : 'border-white/5'
                  }`}>
                    <button
                      onClick={handleFixAll}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${t.borderRadius} ${t.colors.accent} ${
                        theme === 'highContrast' ? 'text-black' : 'text-white'
                      } ${t.colors.accentHover} transition-colors`}
                    >
                      <Sparkles size={12} />
                      Fix All Issues
                    </button>
                    <span className={`text-xs ${t.colors.textMuted} opacity-60`}>
                      Sends all issues to chat — AI will fix them in your code
                    </span>
                  </div>
                )}
              </div>

              {/* ── Severity filter pills ── */}
              {totalIssues > 0 && (
                <div className="flex items-center gap-2 mb-4">
                  {(['all', 'critical', 'warning', 'info'] as const).map((sev) => {
                    const isActive = filterSeverity === sev;
                    const count =
                      sev === 'all'
                        ? totalIssues
                        : scanResult.issues.filter((i) => i.severity === sev).length;

                    if (sev !== 'all' && count === 0) return null;

                    return (
                      <button
                        key={sev}
                        onClick={() => setFilterSeverity(sev)}
                        className={`px-3 py-1 text-xs font-medium ${t.borderRadius} transition-all ${
                          isActive
                            ? `${t.colors.accent} ${theme === 'highContrast' ? 'text-black' : 'text-white'}`
                            : `${t.colors.bgSecondary} ${t.colors.textMuted} hover:bg-white/5`
                        }`}
                      >
                        {sev === 'all' ? 'All' : severityLabel(sev)} ({count})
                      </button>
                    );
                  })}
                </div>
              )}

              {/* ── Category result cards ── */}
              <div className="space-y-3">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const issues = filteredIssues(cat.id);
                  const totalCatIssues = getCount(cat.id);
                  const isExpanded = expandedCategory === cat.id;
                  const hasCritical = scanResult.issues.some(
                    (i) => i.category === cat.id && i.severity === 'critical'
                  );
                  const isPassing = totalCatIssues === 0;

                  return (
                    <div key={cat.id} className={`${bgCard} ${t.borderRadius}`}>
                      {/* Category header */}
                      <div
                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
                        onClick={() =>
                          setExpandedCategory(isExpanded ? null : cat.id)
                        }
                      >
                        {isExpanded ? (
                          <ChevronDown size={12} className={t.colors.textMuted} />
                        ) : (
                          <ChevronRight size={12} className={t.colors.textMuted} />
                        )}

                        {isPassing ? (
                          <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />
                        ) : (
                          <Icon
                            size={16}
                            style={{ color: hasCritical ? '#ef4444' : '#f59e0b' }}
                            className="flex-shrink-0"
                          />
                        )}

                        <span className={`text-sm font-medium ${t.colors.text} flex-1`}>
                          {cat.label}
                        </span>

                        {isPassing ? (
                          <span className="text-xs text-green-400 font-medium">All good</span>
                        ) : (
                          <span
                            className="text-xs font-medium px-2 py-0.5 rounded-full"
                            style={{
                              color: hasCritical ? '#ef4444' : '#f59e0b',
                              backgroundColor: hasCritical
                                ? 'rgba(239,68,68,0.1)'
                                : 'rgba(245,158,11,0.1)',
                            }}
                          >
                            {totalCatIssues} issue{totalCatIssues !== 1 ? 's' : ''}
                          </span>
                        )}
                      </div>

                      {/* Expanded issues */}
                      {isExpanded && (
                        <div className={`${t.colors.border} border-t`}>
                          {/* Passing state */}
                          {isPassing && (
                            <div className={`px-4 py-4 text-center ${t.colors.textMuted}`}>
                              <CheckCircle2 size={16} className="mx-auto mb-1.5 text-green-400" />
                              <p className="text-xs">
                                No {cat.label.toLowerCase()} issues found
                              </p>
                            </div>
                          )}

                          {/* Issue list */}
                          {issues.length > 0 && (
                            <div className={`divide-y ${dividerColor}`}>
                              {issues.map((issue) => (
                                <div key={issue.id} className="px-4 py-3">
                                  <div className="flex items-start gap-2.5">
                                    <SeverityIcon severity={issue.severity} size={13} />
                                    <div className="flex-1 min-w-0">
                                      <p className={`text-sm ${t.colors.text}`}>
                                        {issue.title}
                                      </p>
                                      <p className={`text-xs ${t.colors.textMuted} mt-0.5`}>
                                        {issue.description}
                                      </p>
                                      {issue.file && (
                                        <p className={`text-xs ${t.colors.textMuted} mt-1 opacity-60 font-mono`}>
                                          {issue.file}
                                          {issue.line ? `:${issue.line}` : ''}
                                        </p>
                                      )}
                                    </div>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleFixIssue(issue);
                                      }}
                                      className={`flex items-center gap-1 px-2.5 py-1 text-xs ${t.borderRadius} ${t.colors.border} border ${t.colors.textMuted} hover:bg-white/5 transition-colors flex-shrink-0`}
                                    >
                                      <Wrench size={10} />
                                      Fix
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Fix all in category */}
                          {totalCatIssues > 1 && (
                            <div className={`px-4 py-2.5 ${t.colors.border} border-t`}>
                              <button
                                onClick={() => handleFixCategory(cat.id)}
                                className={`flex items-center gap-1.5 text-xs ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                              >
                                <Sparkles size={11} />
                                Fix all {cat.label.toLowerCase()} issues
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}