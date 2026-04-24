import { useEffect, useState } from "react";
import {
  History,
  X,
  RotateCcw,
  FileEdit,
  Trash2,
  FilePlus,
  Filter,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSnapshotStore } from "../../stores/snapshotStore";
import { themes } from "../../config/themes";
import { readDirectory } from "../../services/fileService";
import { generateManifest } from "../../services/manifestService";
import type { Snapshot } from "../../services/snapshotService";

function TimeMachine() {
  const { theme } = useSettingsStore();
  const { projectPath, setFileTree, setManifest } = useProjectStore();
  const {
    groupedSnapshots,
    totalCount,
    filesTracked,
    isOpen,
    isLoading,
    filterFile,
    restoringId,
    close,
    setFilterFile,
    loadSnapshots,
    restore,
  } = useSnapshotStore();
  const t = themes[theme];

  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set());
  const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);

  // Load snapshots when panel opens
  useEffect(() => {
    if (isOpen && projectPath) {
      loadSnapshots(projectPath);
    }
  }, [isOpen, projectPath]);

  // Auto-dismiss notification
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [notification]);

  if (!isOpen) return null;

  const toggleDay = (date: string) => {
    setCollapsedDays((prev) => {
      const next = new Set(prev);
      if (next.has(date)) {
        next.delete(date);
      } else {
        next.add(date);
      }
      return next;
    });
  };

  const handleRestore = async (snapshotId: string) => {
    if (!projectPath) return;

    try {
      const restoredPath = await restore(projectPath, snapshotId);

      // Refresh file tree after restore
      const files = await readDirectory(projectPath, 3);
      setFileTree(files);
      const manifest = await generateManifest(projectPath, files);
      setManifest(manifest);

      setRestoreConfirm(null);
      setNotification(`Restored: ${restoredPath}`);
    } catch (error) {
      console.error("Restore failed:", error);
      setNotification(`Restore failed: ${error}`);
    }
  };

  const getActionIcon = (action: Snapshot["action"], isNewFile: boolean) => {
    if (isNewFile) return <FilePlus size={14} className="text-green-400" />;
    if (action === "delete") return <Trash2 size={14} className="text-red-400" />;
    if (action === "restore") return <RotateCcw size={14} className="text-blue-400" />;
    return <FileEdit size={14} className="text-amber-400" />;
  };

  const getActionLabel = (snap: Snapshot): string => {
    if (snap.label) return snap.label;
    if (snap.isNewFile) return `Created ${snap.fileName}`;
    if (snap.action === "delete") return `Deleted ${snap.fileName}`;
    if (snap.action === "restore") return `Restored ${snap.fileName}`;
    return `Modified ${snap.fileName}`;
  };

  const formatTime = (timestamp: number): string => {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  // Get unique files for filter dropdown
  const uniqueFiles = Array.from(
    new Set(
      useSnapshotStore
        .getState()
        .snapshots.map((s) => s.filePath)
    )
  ).sort();

  return (
    <div
      className={`w-80 ${t.colors.bgSecondary} border-l ${t.colors.border} flex flex-col h-full`}
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between px-3 py-2 border-b ${t.colors.border} ${t.colors.bgTertiary}`}
      >
        <div className="flex items-center gap-2">
          <History size={16} className="text-purple-400" />
          <h3 className={`text-sm font-semibold ${t.colors.text}`}>
            Time Machine
          </h3>
        </div>
        <button
          onClick={close}
          className={`p-1 ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text} hover:${t.colors.bgTertiary}`}
        >
          <X size={16} />
        </button>
      </div>

      {/* Stats bar */}
      <div
        className={`flex items-center justify-between px-3 py-1.5 border-b ${t.colors.border} text-xs ${t.colors.textMuted}`}
      >
        <span>{totalCount} snapshots</span>
        <span>{filesTracked} files tracked</span>
      </div>

      {/* Filter */}
      <div className={`px-3 py-2 border-b ${t.colors.border}`}>
        <div className="relative">
          <Filter
            size={12}
            className={`absolute left-2 top-1/2 -translate-y-1/2 ${t.colors.textMuted}`}
          />
          <select
            value={filterFile || "__all__"}
            onChange={(e) =>
              setFilterFile(
                e.target.value === "__all__" ? null : e.target.value
              )
            }
            className={`w-full pl-7 pr-2 py-1.5 text-xs ${t.colors.bg} ${t.colors.text} ${t.colors.border} border ${t.borderRadius} appearance-none cursor-pointer`}
          >
            <option value="__all__">All files</option>
            {uniqueFiles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div
          className={`mx-3 mt-2 px-3 py-2 text-xs ${t.borderRadius} bg-green-500/20 text-green-400 border border-green-500/30`}
        >
          {notification}
        </div>
      )}

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {isLoading ? (
          <div
            className={`flex items-center justify-center py-8 ${t.colors.textMuted} text-sm`}
          >
            <Clock size={16} className="animate-spin mr-2" />
            Loading history...
          </div>
        ) : groupedSnapshots.length === 0 ? (
          <div className={`text-center py-8 ${t.colors.textMuted} text-sm`}>
            <History size={32} className="mx-auto mb-3 opacity-40" />
            <p>No snapshots yet</p>
            <p className="text-xs mt-1">
              Changes will appear here automatically
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {groupedSnapshots.map((group) => (
              <div key={group.date}>
                {/* Day header */}
                <button
                  onClick={() => toggleDay(group.date)}
                  className={`flex items-center gap-1.5 w-full text-left mb-1.5`}
                >
                  {collapsedDays.has(group.date) ? (
                    <ChevronRight size={12} className={t.colors.textMuted} />
                  ) : (
                    <ChevronDown size={12} className={t.colors.textMuted} />
                  )}
                  <span
                    className={`text-xs font-semibold ${t.colors.textMuted} uppercase tracking-wide`}
                  >
                    {group.label}
                  </span>
                  <span className={`text-xs ${t.colors.textMuted} opacity-60`}>
                    ({group.snapshots.length})
                  </span>
                </button>

                {/* Snapshot entries */}
                {!collapsedDays.has(group.date) && (
                  <div className="space-y-1 ml-1">
                    {group.snapshots.map((snap) => (
                      <div
                        key={snap.id}
                        className={`group relative pl-4 border-l-2 ${
                          snap.action === "delete"
                            ? "border-red-500/40"
                            : snap.isNewFile
                            ? "border-green-500/40"
                            : snap.action === "restore"
                            ? "border-blue-500/40"
                            : "border-amber-500/40"
                        }`}
                      >
                        <div
                          className={`px-2 py-1.5 ${t.borderRadius} hover:${t.colors.bgTertiary} transition-colors`}
                        >
                          {/* Top row: icon + label + time */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-1.5 min-w-0 flex-1">
                              {getActionIcon(snap.action, snap.isNewFile)}
                              <span
                                className={`text-xs ${t.colors.text} leading-tight break-words`}
                              >
                                {getActionLabel(snap)}
                              </span>
                            </div>
                            <span
                              className={`text-xs ${t.colors.textMuted} whitespace-nowrap flex-shrink-0`}
                            >
                              {formatTime(snap.timestamp)}
                            </span>
                          </div>

                          {/* Bottom row: file path + size + restore */}
                          <div className="flex items-center justify-between mt-1">
                            <span
                              className={`text-xs ${t.colors.textMuted} truncate opacity-60`}
                              title={snap.filePath}
                            >
                              {snap.filePath}
                              {snap.fileSize > 0 && ` · ${formatSize(snap.fileSize)}`}
                            </span>

                            {/* Restore button — show on hover unless it's a "new file" with no content */}
                            {snap.snapshotFile && (
                              <>
                                {restoreConfirm === snap.id ? (
                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => handleRestore(snap.id)}
                                      disabled={restoringId === snap.id}
                                      className={`px-2 py-0.5 text-xs ${t.borderRadius} bg-amber-600 text-white hover:bg-amber-500 disabled:opacity-50`}
                                    >
                                      {restoringId === snap.id ? "..." : "Yes"}
                                    </button>
                                    <button
                                      onClick={() => setRestoreConfirm(null)}
                                      className={`px-2 py-0.5 text-xs ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.textMuted}`}
                                    >
                                      No
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => setRestoreConfirm(snap.id)}
                                    className={`opacity-0 group-hover:opacity-100 transition-opacity px-2 py-0.5 text-xs ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text} hover:${t.colors.bgTertiary}`}
                                    title="Restore to this point"
                                  >
                                    <RotateCcw size={12} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div
        className={`px-3 py-2 border-t ${t.colors.border} ${t.colors.bgTertiary}`}
      >
        <p className={`text-xs ${t.colors.textMuted} text-center`}>
          Every change is saved automatically. Restoring is always undoable.
        </p>
      </div>
    </div>
  );
}

export default TimeMachine;