import { useState, useRef, useCallback } from "react";
import {
  Zap,
  ChevronDown,
  Clock,
  History,
  Rocket,
  Activity,
  ListChecks,
  Package,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSnapshotStore } from "../../stores/snapshotStore";
import { themes } from "../../config/themes";

interface ToolsDropdownProps {
  onNavigate: (page: string) => void;
}

function ToolsDropdown({ onNavigate }: ToolsDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { theme } = useSettingsStore();
  const { toggle: toggleTimeMachine } = useSnapshotStore();
  const t = themes[theme];

  // Auto-close after mouse leaves
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const handleMouseLeave = useCallback(() => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 250);
  }, []);

  // TODO: wire these up to real stores once built
  const taskCount = 0;
  const failedTasks = 0;
  const healthIssues = 0;

  const hasNotification = failedTasks > 0 || healthIssues > 0;

  const handleItemClick = (action: string) => {
    setIsOpen(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);

    switch (action) {
      case "tasks":
        onNavigate("tasks");
        break;
      case "timemachine":
        toggleTimeMachine();
        break;
      case "deploy":
        onNavigate("deploy");
        break;
      case "health":
        onNavigate("health");
        break;
      case "routines":
        onNavigate("routines");
        break;
    }
  };

  return (
    <div className="relative" onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`px-4 py-2 ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.text} text-sm flex items-center gap-2 hover:bg-white/20 transition-colors relative`}
      >
        <Zap size={16} />
        Tools
        <ChevronDown size={14} />

        {/* Notification badge */}
        {hasNotification && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full" />
        )}
      </button>

      {isOpen && (
        <div
          className={`absolute right-0 mt-1 w-56 ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-lg z-50`}
        >
          {/* Scheduled Tasks */}
          <button
            onClick={() => handleItemClick("tasks")}
            className={`w-full px-3 py-2.5 text-sm text-left flex items-center gap-3 ${t.colors.text} hover:bg-white/10 transition-colors`}
          >
            <Clock size={16} />
            <span className="flex-1">Scheduled Tasks</span>
            {taskCount > 0 && (
              <span className={`text-xs ${t.colors.textMuted}`}>
                ({taskCount})
              </span>
            )}
            {failedTasks > 0 && (
              <span className="text-xs text-amber-400">
                ⚠️ {failedTasks} failed
              </span>
            )}
          </button>

          {/* Time Machine */}
          <button
            onClick={() => handleItemClick("timemachine")}
            className={`w-full px-3 py-2.5 text-sm text-left flex items-center gap-3 ${t.colors.text} hover:bg-white/10 transition-colors`}
          >
            <History size={16} />
            <span className="flex-1">Time Machine</span>
          </button>

          {/* Deploy */}
          <button
            onClick={() => handleItemClick("deploy")}
            className={`w-full px-3 py-2.5 text-sm text-left flex items-center gap-3 ${t.colors.text} hover:bg-white/10 transition-colors`}
          >
            <Rocket size={16} />
            <span className="flex-1">Deploy</span>
          </button>

          {/* Health Checks */}
          <button
            onClick={() => handleItemClick("health")}
            className={`w-full px-3 py-2.5 text-sm text-left flex items-center gap-3 ${t.colors.text} hover:bg-white/10 transition-colors`}
          >
            <Activity size={16} />
            <span className="flex-1">Health Checks</span>
            {healthIssues > 0 && (
              <span className="text-xs text-red-400">
                🔴 {healthIssues} issues
              </span>
            )}
          </button>

          {/* Routines */}
          <button
            onClick={() => handleItemClick("routines")}
            className={`w-full px-3 py-2.5 text-sm text-left flex items-center gap-3 ${t.colors.text} hover:bg-white/10 transition-colors`}
          >
            <ListChecks size={16} />
            <span className="flex-1">Routines</span>
          </button>

          {/* Separator */}
          <div className={`${t.colors.border} border-t my-1`} />

          {/* More coming soon */}
          <div
            className={`px-3 py-2.5 text-sm flex items-center gap-3 ${t.colors.textMuted} opacity-50 cursor-default`}
          >
            <Package size={16} />
            <span>More coming soon</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default ToolsDropdown;