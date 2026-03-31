import { useState, useEffect } from "react";
import {
  Clock,
  Play,
  Pause,
  Trash2,
  Loader2,
  Send,
  Sparkles,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import { themes } from "../../config/themes";
import {
  useTaskStore,
  fetchTasks,
  toggleTask,
  deleteTask,
  runTaskNow,
  startTaskListener,
  getTasksGroupedByScope,
  formatNextRun,
  formatRunStatus,
  type ScheduledTask,
  type TaskScope,
} from "../../stores/taskStore";
import TaskCard from "./TaskCard";
import TaskEmptyState from "./TaskEmptyState";
import ProjectSelector, { addRecentProject } from "./ProjectSelector";

interface TasksPageProps {
  onSendToChat?: (message: string, projectPath?: string) => void;
}

function TasksPage({ onSendToChat }: TasksPageProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const { projects, currentProject } = useProjectStore();
  const { tasks, isLoading, runningTaskId } = useTaskStore();
  const [taskInput, setTaskInput] = useState("");

  // Scope state
  const [scope, setScope] = useState<TaskScope>("project");

  // Default to current project if one is active
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    currentProject?.path || currentProject?.id || null
  );
  const [selectedProjectName, setSelectedProjectName] = useState<string>(
    currentProject?.name || ""
  );

  // Update default when currentProject changes
  useEffect(() => {
    if (currentProject && !selectedProjectId) {
      setSelectedProjectId(currentProject.path || currentProject.id);
      setSelectedProjectName(currentProject.name);
    }
  }, [currentProject]);

  // Load tasks and start event listener on mount
  useEffect(() => {
    fetchTasks();

    let unlisten: (() => void) | null = null;
    startTaskListener().then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Group tasks by scope
  const { assistant: assistantTasks, projects: projectGroups } = getTasksGroupedByScope(tasks);
  const projectGroupKeys = Object.keys(projectGroups);

  // Resolve project name from ID (project_id is the path)
  const getProjectName = (key: string): string => {
    if (key === "_general") return "General";
    const project = projects.find((p) => p.path === key || p.id === key);
    if (project) return project.name;
    // Fallback: use last folder name from path
    const parts = key.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || key;
  };

  const handleToggle = async (taskId: string) => {
    await toggleTask(taskId);
  };

  const handleDelete = async (taskId: string) => {
    await deleteTask(taskId);
  };

  const handleRunNow = async (taskId: string) => {
    await runTaskNow(taskId);
  };

  // Send task message with explicit scheduled task instruction
  const handleSend = (message: string) => {
    if (!message.trim() || !onSendToChat) return;

    let finalMessage = message.trim();

    if (scope === "assistant") {
      finalMessage = `[Scheduled Task Request — Scope: Assistant] Use the create_scheduled_task tool to set up this assistant task (scope: "assistant", no project): ${finalMessage}`;
      onSendToChat(finalMessage, undefined);
    } else {
      if (selectedProjectId && selectedProjectName) {
        addRecentProject(selectedProjectId);
        finalMessage = `[Scheduled Task Request — Project: ${selectedProjectName}] Use the create_scheduled_task tool to set up this task: ${finalMessage}`;
      } else {
        finalMessage = `[Scheduled Task Request] Use the create_scheduled_task tool to set up this task: ${finalMessage}`;
      }
      onSendToChat(finalMessage, selectedProjectId || undefined);
    }
  };

  // Check if the current scope view is empty
  const isCurrentScopeEmpty =
    scope === "assistant"
      ? assistantTasks.length === 0
      : projectGroupKeys.length === 0;

  // Fully empty — no tasks at all
  if (!isLoading && tasks.length === 0) {
    return (
      <TaskEmptyState
        onSuggestionClick={handleSend}
        selectedProjectId={selectedProjectId}
        selectedProjectName={selectedProjectName}
        onProjectSelect={(id, name) => {
          setSelectedProjectId(id);
          setSelectedProjectName(name);
        }}
        scope={scope}
        onScopeChange={setScope}
      />
    );
  }

  // Needs a project selected only for project-scope input
  const needsProject = scope === "project" && !selectedProjectId && projects.length > 0;

  return (
    <div className="max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Clock size={24} className={t.colors.textMuted} />
        <h1 className={`text-xl font-semibold ${t.colors.text}`}>
          All Tasks
        </h1>
        <span className={`text-sm ${t.colors.textMuted}`}>
          {tasks.filter((t) => t.enabled).length} active
        </span>

        {/* Scope filter — segmented pill (right-aligned) */}
        <div className="ml-auto">
          <ScopePill scope={scope} onScopeChange={setScope} theme={t} themeName={theme} />
        </div>
      </div>

      {/* Loading */}
      {isLoading && tasks.length === 0 && (
        <div className={`flex items-center justify-center py-20 ${t.colors.textMuted}`}>
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading tasks...
        </div>
      )}

      {/* ── Assistant tasks ──────────────────────────── */}
      {scope === "assistant" && (
        <>
          {assistantTasks.length === 0 ? (
            <div className={`text-center py-12 ${t.colors.textMuted}`}>
              <Sparkles size={20} className="mx-auto mb-2 opacity-50" />
              <p className="text-sm">No assistant tasks yet</p>
              <p className="text-xs mt-1 opacity-70">
                Use the input below to create one
              </p>
            </div>
          ) : (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles size={16} className={t.colors.textMuted} />
                <h2 className={`text-sm font-medium ${t.colors.text}`}>
                  Assistant
                </h2>
                <span className={`text-xs ${t.colors.textMuted}`}>
                  ({assistantTasks.length})
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {assistantTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    isRunning={runningTaskId === task.id}
                    onToggle={() => handleToggle(task.id)}
                    onDelete={() => handleDelete(task.id)}
                    onRunNow={() => handleRunNow(task.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Project tasks ────────────────────────────── */}
      {scope === "project" && (
        <>
          {projectGroupKeys.length === 0 ? (
            <div className={`text-center py-12 ${t.colors.textMuted}`}>
              <span className="text-xl block mb-2">📂</span>
              <p className="text-sm">No project tasks yet</p>
              <p className="text-xs mt-1 opacity-70">
                Use the input below to create one
              </p>
            </div>
          ) : (
            projectGroupKeys.map((key) => (
              <div key={key} className="mb-6">
                {/* Group header */}
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-base">
                    {key === "_general" ? "🌐" : "📂"}
                  </span>
                  <h2 className={`text-sm font-medium ${t.colors.text}`}>
                    {getProjectName(key)}
                  </h2>
                  <span className={`text-xs ${t.colors.textMuted}`}>
                    ({projectGroups[key].length})
                  </span>
                </div>

                {/* Tasks in group */}
                <div className="flex flex-col gap-2">
                  {projectGroups[key].map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      isRunning={runningTaskId === task.id}
                      onToggle={() => handleToggle(task.id)}
                      onDelete={() => handleDelete(task.id)}
                      onRunNow={() => handleRunNow(task.id)}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {/* ── Bottom chat input with scope-aware selector ─ */}
      <div className={`mt-8 pt-6 ${t.colors.border} border-t`}>
        <p className={`text-xs ${t.colors.textMuted} mb-2 text-center`}>
          Describe a task and AI will set it up for you
        </p>
        <div className="flex gap-2 items-center">
          {/* Project selector — only visible for project scope */}
          {scope === "project" && (
            <ProjectSelector
              selectedProjectId={selectedProjectId}
              onSelect={(id, name) => {
                setSelectedProjectId(id);
                setSelectedProjectName(name);
              }}
            />
          )}

          {/* Assistant badge — only visible for assistant scope */}
          {scope === "assistant" && (
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} ${t.colors.textMuted}`}
            >
              <Sparkles size={12} />
              Assistant
            </div>
          )}

          {/* Task input */}
          <input
            type="text"
            value={taskInput}
            onChange={(e) => setTaskInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && taskInput.trim()) {
                handleSend(taskInput.trim());
                setTaskInput("");
              }
            }}
            disabled={needsProject}
            placeholder={
              scope === "assistant"
                ? `"Check my email every morning"...`
                : `"Back up my projects every night"...`
            }
            className={`flex-1 ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${t.fontFamily} disabled:opacity-40`}
          />
          <button
            onClick={() => {
              if (taskInput.trim()) {
                handleSend(taskInput.trim());
                setTaskInput("");
              }
            }}
            disabled={!taskInput.trim() || needsProject}
            className={`${t.colors.accent} ${t.colors.accentHover} ${
              theme === "highContrast" ? "text-black" : "text-white"
            } px-3 py-2 ${t.borderRadius} flex items-center disabled:opacity-50`}
          >
            <Send size={16} />
          </button>
        </div>

        {/* No project warning (only for project scope) */}
        {needsProject && (
          <p className="text-xs text-amber-400/80 mt-1.5 text-center">
            Select a project so the task knows what to work on
          </p>
        )}
      </div>
    </div>
  );
}

// ── Scope pill toggle (reused in header) ──────────────────────

function ScopePill({
  scope,
  onScopeChange,
  theme: t,
  themeName,
}: {
  scope: TaskScope;
  onScopeChange: (s: TaskScope) => void;
  theme: any;
  themeName: string;
}) {
  const isProject = scope === "project";

  return (
    <div
      className={`inline-flex ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} p-0.5`}
    >
      <button
        onClick={() => onScopeChange("project")}
        className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium ${t.borderRadius} transition-all duration-200 ${
          isProject
            ? `${t.colors.accent} ${themeName === "highContrast" ? "text-black" : "text-white"} shadow-sm`
            : `${t.colors.textMuted} hover:bg-white/5`
        }`}
      >
        <span className="text-xs">📂</span>
        Project
      </button>
      <button
        onClick={() => onScopeChange("assistant")}
        className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium ${t.borderRadius} transition-all duration-200 ${
          !isProject
            ? `${t.colors.accent} ${themeName === "highContrast" ? "text-black" : "text-white"} shadow-sm`
            : `${t.colors.textMuted} hover:bg-white/5`
        }`}
      >
        <Sparkles size={11} />
        Assistant
      </button>
    </div>
  );
}

export default TasksPage;