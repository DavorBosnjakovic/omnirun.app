import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Play,
  Pause,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  MinusCircle,
  SkipForward,
  Circle,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import {
  useTaskStore,
  formatNextRun,
  formatRunStatus,
  type ScheduledTask,
  type StepResult,
  type StepStatus,
  type RunStatus,
} from "../../stores/taskStore";

interface TaskCardProps {
  task: ScheduledTask;
  isRunning: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onRunNow: () => void;
}

function TaskCard({ task, isRunning, onToggle, onDelete, onRunNow }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { runningStepResults } = useTaskStore();

  const lastRunStatus = formatRunStatus(task.last_run?.status);
  const nextRun = formatNextRun(task.next_run);

  // Step results to show — live results if running, otherwise last run
  const stepResults: StepResult[] = isRunning
    ? runningStepResults
    : task.last_run?.step_results || [];

  return (
    <div
      className={`${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} transition-colors ${
        !task.enabled ? "opacity-50" : ""
      }`}
    >
      {/* ── Collapsed row ────────────────────────────────── */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Expand chevron */}
        {expanded ? (
          <ChevronDown size={14} className={t.colors.textMuted} />
        ) : (
          <ChevronRight size={14} className={t.colors.textMuted} />
        )}

        {/* Status dot */}
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: isRunning ? "#3b82f6" : lastRunStatus.color }}
        />

        {/* Task name */}
        <span className={`text-sm font-medium ${t.colors.text} flex-1 truncate`}>
          {task.name}
        </span>

        {/* Schedule */}
        <span className={`text-xs ${t.colors.textMuted} hidden sm:block`}>
          {task.schedule || task.cron_expression}
        </span>

        {/* Running indicator */}
        {isRunning && (
          <Loader2 size={14} className="animate-spin text-blue-400 flex-shrink-0" />
        )}

        {/* Next run */}
        {!isRunning && task.enabled && (
          <span className={`text-xs ${t.colors.textMuted} flex-shrink-0`}>
            {nextRun}
          </span>
        )}

        {/* Disabled badge */}
        {!task.enabled && (
          <span className={`text-xs ${t.colors.textMuted} flex-shrink-0`}>
            Paused
          </span>
        )}
      </div>

      {/* ── Expanded detail ──────────────────────────────── */}
      {expanded && (
        <div className={`px-4 pb-4 pt-1 ${t.colors.border} border-t`}>
          {/* Description */}
          {task.description && (
            <p className={`text-sm ${t.colors.textMuted} mb-3`}>
              {task.description}
            </p>
          )}

          {/* Steps */}
          {task.steps.length > 0 && (
            <div className="mb-4">
              <p className={`text-xs font-medium ${t.colors.textMuted} mb-2 uppercase tracking-wide`}>
                Steps
              </p>
              <div className="flex flex-col gap-1.5">
                {task.steps.map((step, i) => {
                  const result = stepResults.find((r) => r.step_id === step.id);
                  return (
                    <div
                      key={step.id}
                      className="flex items-center gap-2"
                    >
                      {/* Step status icon */}
                      <StepStatusIcon status={result?.status} />

                      {/* Step number + name */}
                      <span className={`text-sm ${t.colors.text}`}>
                        <span className={t.colors.textMuted}>{i + 1}.</span>{" "}
                        {step.name}
                      </span>

                      {/* Executor badge */}
                      <span
                        className={`text-xs px-1.5 py-0.5 ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.textMuted}`}
                      >
                        {step.executor}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Last run info */}
          {task.last_run && !isRunning && (
            <div className="mb-4">
              <p className={`text-xs font-medium ${t.colors.textMuted} mb-1 uppercase tracking-wide`}>
                Last Run
              </p>
              <div className="flex items-center gap-3">
                <span
                  className="text-xs font-medium"
                  style={{ color: lastRunStatus.color }}
                >
                  {lastRunStatus.label}
                </span>
                <span className={`text-xs ${t.colors.textMuted}`}>
                  {formatTimeAgo(task.last_run.started_at)}
                </span>
                {task.last_run.step_results && (
                  <span className={`text-xs ${t.colors.textMuted}`}>
                    {task.last_run.step_results.filter((r) => r.status === "success").length}/
                    {task.last_run.step_results.length} steps passed
                  </span>
                )}
              </div>

              {/* Show errors from last run */}
              {task.last_run.step_results
                .filter((r) => r.status === "failed" && r.error)
                .map((r) => (
                  <div
                    key={r.step_id}
                    className={`mt-2 text-xs text-red-400 ${t.colors.bgTertiary} px-3 py-2 ${t.borderRadius}`}
                  >
                    {r.error}
                  </div>
                ))}
            </div>
          )}

          {/* Failure handling */}
          <div className="flex items-center gap-4 mb-4">
            <span className={`text-xs ${t.colors.textMuted}`}>
              On failure:{" "}
              {task.on_failure.type === "stop"
                ? "Stop"
                : task.on_failure.type === "skip_and_continue"
                ? "Skip & continue"
                : `Retry ${task.on_failure.max_attempts}x`}
            </span>
            {task.next_run && task.enabled && (
              <span className={`text-xs ${t.colors.textMuted}`}>
                Next: {nextRun}
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {/* Run Now */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRunNow();
              }}
              disabled={isRunning || !task.enabled}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium ${t.borderRadius} ${t.colors.accent} text-white ${t.colors.accentHover} transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {isRunning ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Play size={12} />
              )}
              {isRunning ? "Running..." : "Run Now"}
            </button>

            {/* Pause / Resume */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggle();
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${t.borderRadius} ${t.colors.border} border ${t.colors.text} hover:bg-white/10 transition-colors`}
            >
              {task.enabled ? <Pause size={12} /> : <Play size={12} />}
              {task.enabled ? "Pause" : "Resume"}
            </button>

            {/* Delete */}
            {confirmDelete ? (
              <div className="flex items-center gap-1.5 ml-auto">
                <span className="text-xs text-red-400">Delete?</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                    setConfirmDelete(false);
                  }}
                  className={`px-2 py-1 text-xs ${t.borderRadius} bg-red-600 text-white hover:bg-red-500 transition-colors`}
                >
                  Yes
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(false);
                  }}
                  className={`px-2 py-1 text-xs ${t.borderRadius} ${t.colors.border} border ${t.colors.text} hover:bg-white/10 transition-colors`}
                >
                  No
                </button>
              </div>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDelete(true);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs ${t.borderRadius} ${t.colors.textMuted} hover:text-red-400 hover:bg-white/5 transition-colors ml-auto`}
              >
                <Trash2 size={12} />
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Step status icon ──────────────────────────────────────────

function StepStatusIcon({ status }: { status?: StepStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle2 size={14} className="text-green-400 flex-shrink-0" />;
    case "failed":
      return <XCircle size={14} className="text-red-400 flex-shrink-0" />;
    case "skipped":
      return <SkipForward size={14} className="text-gray-500 flex-shrink-0" />;
    case "running":
      return <Loader2 size={14} className="animate-spin text-blue-400 flex-shrink-0" />;
    case "pending":
      return <Circle size={14} className="text-gray-600 flex-shrink-0" />;
    default:
      return <Circle size={14} className="text-gray-700 flex-shrink-0" />;
  }
}

// ── Time ago helper ───────────────────────────────────────────

function formatTimeAgo(isoString: string): string {
  try {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  } catch {
    return "";
  }
}

export default TaskCard;