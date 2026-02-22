// ============================================================
// DiffViewer - Inline Approval Component
// ============================================================
// Shows file changes with Approve/Reject buttons.
// Renders inline in the chat area when AI wants to modify files.

import { useState } from "react";
import { Check, X, FilePlus, FileEdit, Trash2, FileOutput, ChevronDown, ChevronRight } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useDiffStore } from "../../stores/diffStore";
import { themes } from "../../config/themes";
import type { PendingDiff } from "../../stores/diffStore";

function DiffViewer() {
  const { theme } = useSettingsStore();
  const { pendingDiff, approve, reject } = useDiffStore();
  const [expanded, setExpanded] = useState(true);
  const t = themes[theme];

  if (!pendingDiff) return null;

  const { action, filePath, oldContent, newContent, searchText, replaceText } = pendingDiff;

  const actionConfig = {
    create: {
      icon: <FilePlus size={16} className="text-green-400" />,
      label: "New File",
      color: "border-green-500/40",
      headerBg: "bg-green-500/10",
    },
    rewrite: {
      icon: <FileOutput size={16} className="text-amber-400" />,
      label: "Rewrite File",
      color: "border-amber-500/40",
      headerBg: "bg-amber-500/10",
    },
    edit: {
      icon: <FileEdit size={16} className="text-blue-400" />,
      label: "Edit File",
      color: "border-blue-500/40",
      headerBg: "bg-blue-500/10",
    },
    delete: {
      icon: <Trash2 size={16} className="text-red-400" />,
      label: "Delete",
      color: "border-red-500/40",
      headerBg: "bg-red-500/10",
    },
  };

  const config = actionConfig[action];

  // ─── Diff Content Rendering ────────────────────────────────

  const renderDiffContent = () => {
    if (!expanded) return null;

    switch (action) {
      case "create":
        return renderNewFile(newContent || "");

      case "edit":
        return renderEditDiff(searchText || "", replaceText || "");

      case "rewrite":
        return renderRewriteDiff(oldContent, newContent || "");

      case "delete":
        return renderDeleteWarning();

      default:
        return null;
    }
  };

  const renderNewFile = (content: string) => {
    const lines = content.split("\n");
    const preview = lines.slice(0, 30);
    const hasMore = lines.length > 30;

    return (
      <div className={`${t.colors.bg} ${t.borderRadius} overflow-hidden`}>
        <pre className="text-xs p-3 overflow-x-auto font-mono leading-relaxed max-h-[300px] overflow-y-auto">
          {preview.map((line, i) => (
            <div key={i} className="flex">
              <span className={`select-none w-8 text-right pr-2 ${t.colors.textMuted} opacity-50`}>
                {i + 1}
              </span>
              <span className="text-green-400/90">{line || " "}</span>
            </div>
          ))}
          {hasMore && (
            <div className={`${t.colors.textMuted} italic mt-1 pl-8`}>
              ... {lines.length - 30} more lines
            </div>
          )}
        </pre>
      </div>
    );
  };

  const renderEditDiff = (search: string, replace: string) => {
    return (
      <div className={`${t.colors.bg} ${t.borderRadius} overflow-hidden`}>
        <div className="text-xs p-3 font-mono space-y-2 max-h-[300px] overflow-y-auto">
          {/* Removed lines */}
          <div>
            <span className={`text-xs ${t.colors.textMuted} uppercase tracking-wide`}>Remove:</span>
            <pre className="mt-1 p-2 bg-red-500/10 border border-red-500/20 rounded text-red-300 whitespace-pre-wrap break-words leading-relaxed">
              {search}
            </pre>
          </div>
          {/* Added lines */}
          <div>
            <span className={`text-xs ${t.colors.textMuted} uppercase tracking-wide`}>Replace with:</span>
            <pre className="mt-1 p-2 bg-green-500/10 border border-green-500/20 rounded text-green-300 whitespace-pre-wrap break-words leading-relaxed">
              {replace}
            </pre>
          </div>
        </div>
      </div>
    );
  };

  const renderRewriteDiff = (oldText: string | null, newText: string) => {
    const oldLines = oldText ? oldText.split("\n").length : 0;
    const newLines = newText.split("\n").length;
    const oldSize = oldText ? oldText.length : 0;
    const newSize = newText.length;

    return (
      <div className={`${t.colors.bg} ${t.borderRadius} overflow-hidden`}>
        <div className="text-xs p-3 space-y-2">
          {/* Summary stats */}
          <div className={`flex gap-4 ${t.colors.textMuted}`}>
            {oldText && (
              <span className="text-red-400">
                − {oldLines} lines ({formatSize(oldSize)})
              </span>
            )}
            <span className="text-green-400">
              + {newLines} lines ({formatSize(newSize)})
            </span>
          </div>

          {/* New content preview */}
          <div>
            <span className={`text-xs ${t.colors.textMuted} uppercase tracking-wide`}>New content:</span>
            <pre className="mt-1 font-mono p-2 bg-green-500/10 border border-green-500/20 rounded text-green-300/80 whitespace-pre-wrap break-words leading-relaxed max-h-[200px] overflow-y-auto">
              {newText.slice(0, 2000)}
              {newText.length > 2000 && `\n\n... ${newText.length - 2000} more characters`}
            </pre>
          </div>
        </div>
      </div>
    );
  };

  const renderDeleteWarning = () => {
    const lineCount = oldContent ? oldContent.split("\n").length : 0;
    const size = oldContent ? oldContent.length : 0;

    return (
      <div className={`${t.colors.bg} ${t.borderRadius} overflow-hidden`}>
        <div className="text-xs p-3">
          <div className="flex items-center gap-2 text-red-400">
            <Trash2 size={14} />
            <span>
              This will permanently delete <strong>{filePath}</strong>
              {lineCount > 0 && ` (${lineCount} lines, ${formatSize(size)})`}
            </span>
          </div>
          <p className={`mt-1.5 ${t.colors.textMuted}`}>
            A snapshot is saved automatically — you can restore from Time Machine.
          </p>
        </div>
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────

  return (
    <div className={`flex gap-3 justify-start`}>
      {/* Icon column */}
      <div
        className={`w-8 h-8 ${t.colors.bgTertiary} ${t.borderRadius} flex items-center justify-center flex-shrink-0`}
      >
        {config.icon}
      </div>

      {/* Diff card */}
      <div
        className={`max-w-[80%] ${t.borderRadius} border-l-2 ${config.color} overflow-hidden`}
        style={{ minWidth: "320px" }}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-3 py-2 ${config.headerBg} cursor-pointer`}
          onClick={() => setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            {expanded ? (
              <ChevronDown size={14} className={t.colors.textMuted} />
            ) : (
              <ChevronRight size={14} className={t.colors.textMuted} />
            )}
            <span className={`text-xs font-semibold uppercase tracking-wide ${t.colors.textMuted}`}>
              {config.label}
            </span>
            <span className={`text-sm font-medium ${t.colors.text}`}>{filePath}</span>
          </div>
        </div>

        {/* Diff content */}
        {renderDiffContent()}

        {/* Approve / Reject buttons */}
        <div className={`flex items-center gap-2 px-3 py-2 border-t ${t.colors.border}`}>
          <button
            onClick={approve}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 ${t.borderRadius} bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors`}
          >
            <Check size={14} />
            Approve
          </button>
          <button
            onClick={reject}
            className={`inline-flex items-center gap-1.5 px-4 py-1.5 ${t.borderRadius} ${t.colors.bgTertiary} hover:bg-red-500/20 ${t.colors.text} hover:text-red-400 text-sm font-medium transition-colors border ${t.colors.border}`}
          >
            <X size={14} />
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default DiffViewer;