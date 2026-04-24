import { useState } from "react";
import { Clock, Send, Sparkles } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { themes } from "../../config/themes";
import ProjectSelector from "./ProjectSelector";
import type { TaskScope } from "../../stores/taskStore";

interface TaskEmptyStateProps {
  onSuggestionClick?: (suggestion: string) => void;
  selectedProjectId: string | null;
  selectedProjectName: string;
  onProjectSelect: (id: string, name: string) => void;
  scope: TaskScope;
  onScopeChange: (scope: TaskScope) => void;
}

const projectSuggestions = [
  "Back up my projects every night",
  "Deploy my site every Friday at 5pm",
  "Email me a weekly cost summary",
  "Clean up temp files every night",
  "Check my site for broken links weekly",
];

const assistantSuggestions = [
  "Check my email every morning and summarize",
  "Send me a daily calendar digest at 8am",
  "Remind me to stand up every 2 hours",
  "Send a weekly summary of my inbox",
  "Check for new emails from my boss every hour",
];

function TaskEmptyState({
  onSuggestionClick,
  selectedProjectId,
  selectedProjectName,
  onProjectSelect,
  scope,
  onScopeChange,
}: TaskEmptyStateProps) {
  const { theme } = useSettingsStore();
  const t = themes[theme];
  const [taskInput, setTaskInput] = useState("");

  const isProject = scope === "project";
  const suggestions = isProject ? projectSuggestions : assistantSuggestions;

  const handleSend = (message: string) => {
    if (message.trim() && onSuggestionClick) {
      onSuggestionClick(message.trim());
    }
  };

  // Needs a project selected only for project-scope tasks
  const needsProject = isProject && !selectedProjectId;

  return (
    <div className="max-w-md mx-auto w-full py-16 text-center">
      {/* Icon */}
      <div className={`inline-flex items-center justify-center w-14 h-14 ${t.colors.bgSecondary} ${t.borderRadius} mb-5`}>
        <Clock size={28} className={t.colors.textMuted} />
      </div>

      {/* Title */}
      <h2 className={`text-lg font-semibold ${t.colors.text} mb-2`}>
        No tasks yet
      </h2>
      <p className={`text-sm ${t.colors.textMuted} mb-6`}>
        Here are some ideas to get started:
      </p>

      {/* ── Scope selector + project dropdown ──────────── */}
      <div className="flex flex-col items-center gap-3 mb-6">
        <span className={`text-xs ${t.colors.textMuted}`}>Create tasks for:</span>

        {/* Segmented pill toggle */}
        <div
          className={`inline-flex ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} p-0.5`}
        >
          <button
            onClick={() => onScopeChange("project")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium ${t.borderRadius} transition-all duration-200 ${
              isProject
                ? `${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"} shadow-sm`
                : `${t.colors.textMuted} hover:${t.colors.text} hover:bg-white/5`
            }`}
          >
            <span className="text-sm">📂</span>
            Project
          </button>
          <button
            onClick={() => onScopeChange("assistant")}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium ${t.borderRadius} transition-all duration-200 ${
              !isProject
                ? `${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"} shadow-sm`
                : `${t.colors.textMuted} hover:${t.colors.text} hover:bg-white/5`
            }`}
          >
            <Sparkles size={13} />
            Assistant
          </button>
        </div>

        {/* Project dropdown — only visible when scope is project */}
        {isProject && (
          <ProjectSelector
            selectedProjectId={selectedProjectId}
            onSelect={onProjectSelect}
            compact={true}
          />
        )}
      </div>

      {/* No project warning (only for project scope) */}
      {needsProject && (
        <p className="text-xs text-amber-400/80 mb-4">
          Pick a project above first
        </p>
      )}

      {/* Assistant scope info */}
      {!isProject && (
        <p className={`text-xs ${t.colors.textMuted} mb-4 opacity-70`}>
          Assistant tasks run globally — email, calendar, personal automations
        </p>
      )}

      {/* Suggestion chips */}
      <div className="flex flex-col gap-2 mb-8">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => handleSend(suggestion)}
            disabled={needsProject}
            className={`w-full text-left px-4 py-3 text-sm ${t.colors.bgSecondary} ${t.colors.text} ${t.colors.border} border ${t.borderRadius} hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            <span className={t.colors.textMuted}>💡 </span>
            "{suggestion}"
          </button>
        ))}
      </div>

      {/* Chat input */}
      <p className={`text-xs ${t.colors.textMuted} mb-2`}>
        Or describe your own:
      </p>
      <div className="flex gap-2">
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
            isProject
              ? `"Sync to Google Drive every Sunday"...`
              : `"Summarize my inbox every morning"...`
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
    </div>
  );
}

export default TaskEmptyState;