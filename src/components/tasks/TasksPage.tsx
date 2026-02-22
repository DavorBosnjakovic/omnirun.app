import { useState, useEffect } from "react";
import {
  Clock,
  Play,
  Pause,
  Trash2,
  Loader2,
  Send,
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
  getTasksGrouped,
  formatNextRun,
  formatRunStatus,
  type ScheduledTask,
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

  // Group tasks by project
  const grouped = getTasksGrouped(tasks);
  const groupKeys = Object.keys(grouped);

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
    if (selectedProjectId && selectedProjectName) {
      addRecentProject(selectedProjectId);
      finalMessage = `[Scheduled Task Request — Project: ${selectedProjectName}] Use the create_scheduled_task tool to set up this task: ${finalMessage}`;
    } else {
      finalMessage = `[Scheduled Task Request] Use the create_scheduled_task tool to set up this task: ${finalMessage}`;
    }
    onSendToChat(finalMessage, selectedProjectId || undefined);
  };

  // Empty state
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
      />
    );
  }

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
      </div>

      {/* Loading */}
      {isLoading && tasks.length === 0 && (
        <div className={`flex items-center justify-center py-20 ${t.colors.textMuted}`}>
          <Loader2 size={20} className="animate-spin mr-2" />
          Loading tasks...
        </div>
      )}

      {/* Task groups */}
      {groupKeys.map((key) => (
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
              ({grouped[key].length})
            </span>
          </div>

          {/* Tasks in group */}
          <div className="flex flex-col gap-2">
            {grouped[key].map((task) => (
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
      ))}

      {/* Bottom chat input with project selector */}
      <div className={`mt-8 pt-6 ${t.colors.border} border-t`}>
        <p className={`text-xs ${t.colors.textMuted} mb-2 text-center`}>
          Describe a task and AI will set it up for you
        </p>
        <div className="flex gap-2 items-center">
          {/* Project selector */}
          <ProjectSelector
            selectedProjectId={selectedProjectId}
            onSelect={(id, name) => {
              setSelectedProjectId(id);
              setSelectedProjectName(name);
            }}
          />

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
            placeholder={`"Back up my projects every night"...`}
            className={`flex-1 ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 ${t.fontFamily}`}
          />
          <button
            onClick={() => {
              if (taskInput.trim()) {
                handleSend(taskInput.trim());
                setTaskInput("");
              }
            }}
            disabled={!taskInput.trim()}
            className={`${t.colors.accent} ${t.colors.accentHover} ${
              theme === "highContrast" ? "text-black" : "text-white"
            } px-3 py-2 ${t.borderRadius} flex items-center disabled:opacity-50`}
          >
            <Send size={16} />
          </button>
        </div>

        {/* No project warning */}
        {!selectedProjectId && projects.length > 0 && (
          <p className="text-xs text-amber-400/80 mt-1.5 text-center">
            Select a project so the task knows what to work on
          </p>
        )}
      </div>
    </div>
  );
}

export default TasksPage;