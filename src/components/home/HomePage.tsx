import { useMemo, useEffect, useState, useRef } from 'react';
import {
  Folder, ArrowRight, CheckCircle, XCircle, AlertTriangle,
  Users, Lock, ChevronDown, Search, X,
} from 'lucide-react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTaskStore, fetchTasks, formatNextRun, getTaskCounts } from '../../stores/taskStore';
import { useConnectionsStore } from '../../stores/connectionsStore';
import { useUsageStore } from '../../stores/usageStore';
import { useAuthStore } from '../../stores/authStore';
import { useAssistantStore, selectEmailAccounts } from '../../stores/assistantStore';
import { themes } from '../../config/themes';

// ─── Types ───────────────────────────────────────────────────────────

export type AppSection = 'home' | 'projects' | 'assistant' | 'tasks';

interface HomePageProps {
  onNavigate: (section: AppSection) => void;
  onSettingsClick: (tab?: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  github: 'GitHub',
  vercel: 'Vercel',
  netlify: 'Netlify',
  cloudflare: 'Cloudflare',
  stripe: 'Stripe',
  sendgrid: 'SendGrid',
  supabase: 'Supabase',
  namecheap: 'Namecheap',
  railway: 'Railway',
  render: 'Render',
  firebase: 'Firebase',
  mongodb: 'MongoDB',
  planetscale: 'PlanetScale',
  resend: 'Resend',
  postmark: 'Postmark',
};

function fmtProvider(provider: string): string {
  return (
    PROVIDER_LABELS[provider.toLowerCase()] ??
    provider.charAt(0).toUpperCase() + provider.slice(1)
  );
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return String(n);
}

function fmtRelativeTime(isoStr: string): string {
  try {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
}

// ─── Component ───────────────────────────────────────────────────────

export default function HomePage({ onNavigate, onSettingsClick }: HomePageProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];

  const { projects } = useProjectStore();
  const { tasks } = useTaskStore();
  const { projectConnections, loadFromDB, loadProjectConnectionsFromDB } = useConnectionsStore();
  const { monthlyCost, monthlyTokens, monthlyBudget } = useUsageStore();
  const { profile } = useAuthStore();
  const { accounts } = useAssistantStore();
  const plan = profile?.plan ?? 'starter';
  const emailAccounts = selectEmailAccounts(accounts);

  // Connections widget tab state
  const [connTab, setConnTab] = useState<'projects' | 'assistant'>('projects');
  // Project selector for connections widget
  const [connProject, setConnProject] = useState<string>('');

  // Load tasks on mount if not yet loaded
  useEffect(() => {
    if (tasks.length === 0) fetchTasks();
  }, []);

  // Load global connections on mount
  useEffect(() => {
    loadFromDB();
  }, []);

  // Default connProject to first project
  useEffect(() => {
    if (!connProject && projects.length > 0) {
      setConnProject(projects[0].id);
    }
  }, [projects]);

  // Load project connections whenever selected project changes
  useEffect(() => {
    if (connProject) {
      loadProjectConnectionsFromDB(connProject);
    }
  }, [connProject]);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // ── Derived task data ──────────────────────────────────────────────

  const failedTasks = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.last_run?.status === 'failed' ||
          t.last_run?.status === 'partial_success'
      ),
    [tasks]
  );

  const successTasks = useMemo(
    () => tasks.filter((t) => t.last_run?.status === 'success'),
    [tasks]
  );

  // Top 5 tasks for the widget: failed first, then upcoming, then recent success
  const topTasks = useMemo(() => {
    const failed = tasks.filter(
      (t) =>
        t.last_run?.status === 'failed' ||
        t.last_run?.status === 'partial_success'
    );
    const upcoming = tasks.filter(
      (t) => t.enabled && t.next_run && !failed.includes(t)
    );
    const successful = tasks.filter(
      (t) =>
        t.last_run?.status === 'success' &&
        !failed.includes(t) &&
        !upcoming.includes(t)
    );
    return [...failed, ...upcoming, ...successful].slice(0, 5);
  }, [tasks]);

  // Recent activity feed (tasks with last_run, sorted newest first)
  const recentActivity = useMemo(
    () =>
      tasks
        .filter((t) => t.last_run)
        .sort((a, b) =>
          (b.last_run?.started_at ?? '').localeCompare(
            a.last_run?.started_at ?? ''
          )
        )
        .slice(0, 6),
    [tasks]
  );

  // Project status derived from tasks
  const projectTaskStatus = useMemo(() => {
    const map: Record<string, 'error' | 'active' | 'idle'> = {};
    for (const project of projects) {
      const pt = tasks.filter((t) => t.project_id === project.id);
      if (
        pt.some(
          (t) =>
            t.last_run?.status === 'failed' ||
            t.last_run?.status === 'partial_success'
        )
      ) {
        map[project.id] = 'error';
      } else if (pt.some((t) => t.enabled)) {
        map[project.id] = 'active';
      } else {
        map[project.id] = 'idle';
      }
    }
    return map;
  }, [projects, tasks]);

  // ── Connection items with project context ──────────────────────────

  // ── Connection items scoped to selected project ───────────────────
  // Shows ONLY project-scoped connections for the selected project.
  // Global connections are not shown — they are not project-specific.

  const allConnectionItems = useMemo(() => {
    const items: Array<{
      key: string;
      label: string;
      status: string;
      error?: string;
    }> = [];

    if (connProject) {
      const projectSlice = projectConnections[connProject] ?? {};
      for (const [provider, conn] of Object.entries(projectSlice)) {
        if (conn && conn.status && conn.status !== 'disconnected') {
          items.push({
            key: `${connProject}-${provider}`,
            label: fmtProvider(provider),
            status: conn.status,
            error: conn.error,
          });
        }
      }
    }

    return items;
  }, [projectConnections, connProject]);

  const errorConns = useMemo(
    () => allConnectionItems.filter((c) => c.status === 'error'),
    [allConnectionItems]
  );

  // ── Morning brief ──────────────────────────────────────────────────

  const briefText = useMemo(() => {
    const parts: string[] = [];

    if (failedTasks.length > 0) {
      const names = failedTasks
        .slice(0, 2)
        .map((t) => t.name)
        .join(', ');
      parts.push(
        `${failedTasks.length} task${failedTasks.length > 1 ? 's' : ''} failed — ${names}${failedTasks.length > 2 ? ' and more' : ''} need attention.`
      );
    }

    if (successTasks.length > 0) {
      parts.push(
        `${successTasks.length} task${successTasks.length > 1 ? 's' : ''} completed successfully.`
      );
    }

    if (errorConns.length > 0) {
      parts.push(
        `${errorConns.length} connection${errorConns.length > 1 ? 's' : ''} need${errorConns.length === 1 ? 's' : ''} to be reconnected.`
      );
    }

    if (parts.length === 0) {
      return projects.length > 0
        ? `All ${projects.length} project${projects.length > 1 ? 's' : ''} are healthy. No issues detected.`
        : 'Welcome to Omnirun. Create your first project to get started.';
    }

    return parts.join(' ');
  }, [failedTasks, successTasks, errorConns, projects]);

  // ── Budget bar ─────────────────────────────────────────────────────

  const budgetPercent =
    monthlyBudget !== null
      ? Math.min((monthlyCost / monthlyBudget) * 100, 100)
      : null;

  const budgetBarColor =
    budgetPercent !== null
      ? budgetPercent > 80
        ? '#ef4444'
        : budgetPercent > 60
        ? '#f59e0b'
        : '#2DB87A'
      : '#2DB87A';

  // ── Shared style helpers ───────────────────────────────────────────

  const card = `${t.colors.bgSecondary} ${t.colors.border} border rounded-lg p-3`;
  const sectionLabel = `text-xs ${t.colors.textMuted} uppercase tracking-wider font-medium mb-2 block`;
  const rowDivider = `border-b last:border-b-0 ${t.colors.border}`;

  // ── Render ────────────────────────────────────────────────────────

  return (
    <div
      className={`flex-1 overflow-y-auto p-4 ${t.fontFamily}`}
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className={`text-sm font-semibold ${t.colors.text}`}>
            {getGreeting()} 👋
          </h1>
          <p className={`text-xs ${t.colors.textMuted} mt-0.5`}>{today}</p>
        </div>
      </div>

      {/* ── Morning Brief ── */}
      <div
        className={`${t.colors.bgSecondary} rounded-lg p-3`}
        style={{
          borderLeft: '3px solid #2DB87A',
          border: `1px solid`,
          borderColor: `color-mix(in srgb, #2DB87A 30%, transparent)`,
          borderLeftColor: '#2DB87A',
        }}
      >
        <p
          className="text-xs font-semibold mb-1.5"
          style={{
            color: '#2DB87A',
            letterSpacing: '0.07em',
            textTransform: 'uppercase',
          }}
        >
          ✦ Morning Brief
        </p>
        <p className={`text-xs leading-relaxed ${t.colors.text}`}>
          {briefText}
        </p>
      </div>

      {/* ── Row 1: Projects + Connections (equal height) ── */}
      <div className="grid grid-cols-2 gap-3 items-stretch">

        {/* Projects */}
        <div className={`${card} flex flex-col`}>
          <div className="flex items-center justify-between mb-2">
            <span className={sectionLabel} style={{ marginBottom: 0 }}>
              Projects
            </span>
            <button
              onClick={() => onNavigate('projects')}
              className="text-xs flex items-center gap-0.5 transition-opacity hover:opacity-70"
              style={{ color: '#2DB87A' }}
            >
              View all <ArrowRight size={10} />
            </button>
          </div>

          {projects.length === 0 ? (
            <p className={`text-xs ${t.colors.textMuted} py-3 text-center flex-1 flex items-center justify-center`}>
              No projects yet. Create one to get started.
            </p>
          ) : (
            <div className="flex-1">
              {projects.slice(0, 8).map((project) => {
                const status = projectTaskStatus[project.id] ?? 'idle';
                return (
                  <div
                    key={project.id}
                    className={`flex items-center justify-between py-1.5 ${rowDivider}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Folder
                        size={12}
                        className={t.colors.textMuted}
                        style={{ flexShrink: 0 }}
                      />
                      <span className={`text-xs truncate ${t.colors.text}`}>
                        {project.name}
                      </span>
                    </div>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ml-2"
                      style={{
                        color:
                          status === 'error'
                            ? '#ef4444'
                            : status === 'active'
                            ? '#22c55e'
                            : undefined,
                        background:
                          status === 'error'
                            ? 'rgba(239,68,68,0.1)'
                            : status === 'active'
                            ? 'rgba(34,197,94,0.1)'
                            : undefined,
                      }}
                    >
                      {status === 'error'
                        ? 'Error'
                        : status === 'active'
                        ? 'Active'
                        : <span className={t.colors.textMuted}>Idle</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {projects.length > 8 && (
            <p className={`text-xs ${t.colors.textMuted} mt-2`}>
              +{projects.length - 8} more projects
            </p>
          )}
        </div>

        {/* Connections — tabbed */}
        <div className={`${card} flex flex-col`}>
          <div className="flex items-center justify-between mb-2">
            <span className={sectionLabel} style={{ marginBottom: 0 }}>
              Connections
            </span>
          </div>

          {/* Tabs */}
          <div className={`flex border-b ${t.colors.border} mb-3`}>
            {(['projects', 'assistant'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setConnTab(tab)}
                className={`text-xs px-3 py-1.5 font-medium capitalize transition-colors border-b-2 -mb-px ${
                  connTab === tab
                    ? 'border-green-500 text-green-500'
                    : `border-transparent ${t.colors.textMuted} hover:${t.colors.text}`
                }`}
                style={connTab === tab ? { color: '#2DB87A', borderBottomColor: '#2DB87A' } : {}}
              >
                {tab === 'projects' ? 'Projects' : 'Assistant'}
              </button>
            ))}
          </div>

          {/* Projects tab */}
          {connTab === 'projects' && (
            <div className="flex flex-col flex-1">
              {/* Project selector */}
              {projects.length > 1 && (
                <ConnectionProjectDropdown
                  projects={projects}
                  selectedId={connProject}
                  onSelect={setConnProject}
                  theme={t}
                />
              )}

              {allConnectionItems.length === 0 ? (
                <p className={`text-xs ${t.colors.textMuted} py-3 text-center flex-1`}>
                  No connections yet.
                </p>
              ) : (
                <div className="flex-1">
                  {allConnectionItems
                    .slice(0, 8)
                    .map((item) => (
                    <div
                      key={item.key}
                      className={`flex items-center justify-between py-1.5 ${rowDivider}`}
                    >
                      <span className={`text-xs ${t.colors.text} truncate flex-1`}>
                        {item.label}
                      </span>
                      <span
                        className="text-xs flex-shrink-0 font-medium ml-2"
                        style={{
                          color:
                            item.status === 'connected'
                              ? '#22c55e'
                              : item.status === 'error'
                              ? '#ef4444'
                              : item.status === 'connecting'
                              ? '#f59e0b'
                              : undefined,
                        }}
                      >
                        {item.status === 'connected'
                          ? '● Connected'
                          : item.status === 'error'
                          ? '⚠ Error'
                          : item.status === 'connecting'
                          ? '○ Connecting'
                          : <span className={t.colors.textMuted}>—</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => onSettingsClick('connections')}
                className="text-xs flex items-center gap-0.5 transition-opacity hover:opacity-70 mt-2"
                style={{ color: '#2DB87A' }}
              >
                Manage <ArrowRight size={10} />
              </button>
            </div>
          )}

          {/* Assistant tab */}
          {connTab === 'assistant' && (
            <div className="flex flex-col flex-1">
              {emailAccounts.length === 0 ? (
                <p className={`text-xs ${t.colors.textMuted} py-3 text-center flex-1`}>
                  No accounts connected.
                </p>
              ) : (
                <div className="flex-1">
                  {emailAccounts.map((account) => (
                    <div
                      key={account.id}
                      className={`flex items-center gap-2 py-1.5 ${rowDivider}`}
                    >
                      <div
                        className="flex-shrink-0 rounded text-xs font-bold flex items-center justify-center"
                        style={{
                          width: 18, height: 18,
                          background: account.provider === 'gmail' ? 'rgba(234,72,41,0.15)' : 'rgba(0,114,239,0.15)',
                          color: account.provider === 'gmail' ? '#EA4829' : '#0072EF',
                        }}
                      >
                        {account.provider === 'gmail' ? 'G' : 'O'}
                      </div>
                      <span className={`text-xs truncate flex-1 ${t.colors.text}`}>
                        {account.accountLabel || account.email}
                      </span>
                      <span className="text-xs" style={{ color: '#22c55e' }}>●</span>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => onNavigate('assistant')}
                className="text-xs flex items-center gap-0.5 transition-opacity hover:opacity-70 mt-2"
                style={{ color: '#2DB87A' }}
              >
                Open Assistant <ArrowRight size={10} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2: Tasks + Usage + Team ── */}
      <div className="grid grid-cols-3 gap-3">

        {/* Tasks */}
        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <span className={sectionLabel} style={{ marginBottom: 0 }}>
              Tasks
            </span>
            <button
              onClick={() => onNavigate('tasks')}
              className="text-xs flex items-center gap-0.5 transition-opacity hover:opacity-70"
              style={{ color: '#2DB87A' }}
            >
              All <ArrowRight size={10} />
            </button>
          </div>

          {topTasks.length === 0 ? (
            <p className={`text-xs ${t.colors.textMuted} py-3 text-center`}>
              No scheduled tasks yet.
            </p>
          ) : (
            <div>
              {topTasks.map((task) => {
                const status = task.last_run?.status;
                const dotColor =
                  status === 'failed' || status === 'partial_success'
                    ? '#ef4444'
                    : status === 'success'
                    ? '#22c55e'
                    : task.enabled && task.next_run
                    ? '#f59e0b'
                    : '#6b7280';

                const timeLabel =
                  status === 'failed' || status === 'partial_success'
                    ? 'Failed'
                    : status === 'success'
                    ? fmtRelativeTime(task.last_run!.started_at)
                    : task.next_run
                    ? formatNextRun(task.next_run)
                    : '—';

                return (
                  <div
                    key={task.id}
                    className={`flex items-center gap-2 py-1.5 ${rowDivider}`}
                  >
                    <div
                      className="rounded-full flex-shrink-0"
                      style={{ width: 6, height: 6, background: dotColor }}
                    />
                    <span className={`text-xs truncate flex-1 ${t.colors.text}`}>
                      {task.name}
                    </span>
                    <span className={`text-xs flex-shrink-0 ${t.colors.textMuted}`}>
                      {timeLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Usage */}
        <div className={card}>
          <span className={sectionLabel}>Usage this month</span>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className={`${t.colors.bgTertiary} rounded-md p-2 text-center`}>
              <div className="text-base font-semibold" style={{ color: '#2DB87A' }}>
                ${monthlyCost.toFixed(2)}
              </div>
              <div className={`text-xs ${t.colors.textMuted}`}>Cost</div>
            </div>
            <div className={`${t.colors.bgTertiary} rounded-md p-2 text-center`}>
              <div className="text-base font-semibold" style={{ color: '#2DB87A' }}>
                {fmtTokens(monthlyTokens)}
              </div>
              <div className={`text-xs ${t.colors.textMuted}`}>Tokens</div>
            </div>
          </div>

          {monthlyBudget !== null ? (
            <>
              <div className="flex justify-between mb-1">
                <span className={`text-xs ${t.colors.textMuted}`}>Monthly budget</span>
                <span className={`text-xs ${t.colors.textMuted}`}>
                  ${monthlyCost.toFixed(2)} / ${monthlyBudget}
                </span>
              </div>
              <div
                className={`${t.colors.bgTertiary} rounded-full overflow-hidden`}
                style={{ height: 5 }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${budgetPercent}%`, background: budgetBarColor }}
                />
              </div>
            </>
          ) : (
            <button
              onClick={() => onSettingsClick('usage')}
              className={`text-xs ${t.colors.textMuted} hover:${t.colors.text} flex items-center gap-1 transition-colors`}
            >
              View usage details →
            </button>
          )}
        </div>

        {/* Team */}
        <div className={card}>
          <div className="flex items-center justify-between mb-2">
            <span className={sectionLabel} style={{ marginBottom: 0 }}>
              Team
            </span>
            {(plan === 'business' || plan === 'enterprise') && (
              <button
                onClick={() => onSettingsClick('team')}
                className="text-xs flex items-center gap-0.5 transition-opacity hover:opacity-70"
                style={{ color: '#2DB87A' }}
              >
                Manage <ArrowRight size={10} />
              </button>
            )}
          </div>

          {plan === 'starter' || plan === 'pro' ? (
            /* Upgrade prompt */
            <div className="flex flex-col items-center justify-center py-3 gap-2 text-center">
              <Lock size={16} className={t.colors.textMuted} />
              <p className={`text-xs ${t.colors.textMuted} leading-relaxed`}>
                Collaborate with your team on Business plan.
              </p>
              <button
                onClick={() => onSettingsClick('billing')}
                className="text-xs px-3 py-1.5 rounded-md font-medium transition-opacity hover:opacity-80"
                style={{ background: '#2DB87A', color: 'white' }}
              >
                Upgrade to Business
              </button>
            </div>
          ) : (
            /* Business/Enterprise — placeholder until team store is wired */
            <div className="flex flex-col items-center justify-center py-3 gap-2 text-center">
              <Users size={16} className={t.colors.textMuted} />
              <p className={`text-xs ${t.colors.textMuted} leading-relaxed`}>
                No team set up yet.
              </p>
              <button
                onClick={() => onSettingsClick('team')}
                className="text-xs flex items-center gap-0.5 transition-opacity hover:opacity-70"
                style={{ color: '#2DB87A' }}
              >
                Set up team <ArrowRight size={10} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Recent Activity ── */}
      {recentActivity.length > 0 && (
        <div className={card}>
          <span className={sectionLabel}>Recent Activity</span>
          <div className="grid grid-cols-2 gap-x-4">
            {recentActivity.map((task) => {
              const status = task.last_run!.status;
              const Icon =
                status === 'success'
                  ? CheckCircle
                  : status === 'failed'
                  ? XCircle
                  : AlertTriangle;
              const iconColor =
                status === 'success'
                  ? '#22c55e'
                  : status === 'failed'
                  ? '#ef4444'
                  : '#f59e0b';

              return (
                <div
                  key={task.id}
                  className={`flex items-center gap-2 py-1.5 ${rowDivider}`}
                >
                  <Icon
                    size={12}
                    style={{ color: iconColor, flexShrink: 0 }}
                  />
                  <span className={`text-xs flex-1 truncate ${t.colors.text}`}>
                    {task.name}
                  </span>
                  <span className={`text-xs flex-shrink-0 ${t.colors.textMuted}`}>
                    {fmtRelativeTime(task.last_run!.started_at)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── ConnectionProjectDropdown ────────────────────────────────
// Custom styled dropdown for the Connections widget, matching
// the ProjectSelector component style from the Tasks page.

interface ConnectionProjectDropdownProps {
  projects: Array<{ id: string; name: string; path: string }>;
  selectedId: string;
  onSelect: (id: string) => void;
  theme: any;
}

function ConnectionProjectDropdown({
  projects,
  selectedId,
  onSelect,
  theme: t,
}: ConnectionProjectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selectedProject = projects.find((p) => p.id === selectedId);
  const displayName = selectedProject?.name || 'Select project';

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;
  }, [projects, search]);

  const showSearch = projects.length > 5;

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Focus search when opening
  useEffect(() => {
    if (isOpen && searchRef.current) searchRef.current.focus();
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className="relative mb-3">
      {/* Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs ${t.colors.bgTertiary} ${t.colors.border} border ${t.borderRadius} ${t.colors.text} hover:bg-white/10 transition-colors`}
      >
        <Folder size={11} className={`${t.colors.textMuted} flex-shrink-0`} />
        <span className="truncate flex-1 text-left">{displayName}</span>
        <ChevronDown
          size={10}
          className={`${t.colors.textMuted} flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          className={`absolute top-full mt-1 left-0 z-50 w-full ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-xl overflow-hidden`}
        >
          {/* Search (only if 6+ projects) */}
          {showSearch && (
            <div className={`p-2 ${t.colors.border} border-b`}>
              <div className="relative">
                <Search
                  size={11}
                  className={`absolute left-2 top-1/2 -translate-y-1/2 ${t.colors.textMuted}`}
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search projects..."
                  className={`w-full pl-6 pr-6 py-1.5 text-xs ${t.colors.bgTertiary || t.colors.bgSecondary} ${t.colors.text} ${t.borderRadius} border ${t.colors.border} focus:outline-none focus:ring-1 focus:ring-blue-500 ${t.fontFamily}`}
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className={`absolute right-2 top-1/2 -translate-y-1/2 ${t.colors.textMuted}`}
                  >
                    <X size={10} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* List */}
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.map((project) => (
              <button
                key={project.id}
                onClick={() => {
                  onSelect(project.id);
                  setIsOpen(false);
                  setSearch('');
                }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                  project.id === selectedId
                    ? 'bg-blue-600/20 text-blue-300'
                    : `${t.colors.text} hover:bg-white/10`
                }`}
              >
                <span className="flex-shrink-0 text-sm">📂</span>
                <span className="truncate flex-1">{project.name}</span>
              </button>
            ))}

            {filtered.length === 0 && (
              <p className={`px-3 py-3 text-xs ${t.colors.textMuted} text-center`}>
                No projects matching "{search}"
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}