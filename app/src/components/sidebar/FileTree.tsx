import { useState, useRef, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  MoreVertical,
  Trash2,
  History,
  FolderOpen as OpenFolder,
} from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import { useSnapshotStore } from "../../stores/snapshotStore";
import { themes } from "../../config/themes";
import { FileEntry, deletePath, readDirectory } from "../../services/fileService";
import { generateManifest } from "../../services/manifestService";

interface FileTreeItemProps {
  entry: FileEntry;
  depth: number;
}

function FileTreeItem({ entry, depth }: FileTreeItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme } = useSettingsStore();
  const { selectedFile, setSelectedFile, projectPath, setFileTree, setManifest } = useProjectStore();
  const { open: openTimeMachine, setFilterFile } = useSnapshotStore();
  const t = themes[theme];

  const isSelected = selectedFile?.path === entry.path;

  // Close menu when clicking outside
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmDelete(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const handleClick = () => {
    if (entry.is_dir) {
      setIsOpen(!isOpen);
    } else {
      setSelectedFile(entry);
    }
  };

  const handleDelete = async () => {
    try {
      await deletePath(entry.path);

      // Clear selected file if it was the deleted one
      if (selectedFile?.path === entry.path) {
        setSelectedFile(null);
      }

      // Refresh file tree
      if (projectPath) {
        const files = await readDirectory(projectPath, 3);
        setFileTree(files);
        const manifest = await generateManifest(projectPath, files);
        setManifest(manifest);
      }
    } catch (error) {
      console.error("Failed to delete:", error);
    }

    setMenuOpen(false);
    setConfirmDelete(false);
  };

  const handleViewHistory = () => {
    // Get relative path for filter
    if (projectPath) {
      const normProject = projectPath.replace(/\//g, "\\").replace(/\\+$/, "");
      const normPath = entry.path.replace(/\//g, "\\");
      const relative = normPath.startsWith(normProject)
        ? normPath.slice(normProject.length + 1)
        : entry.path;
      setFilterFile(relative);
    }
    openTimeMachine();
    setMenuOpen(false);
  };

  const handleOpenInExplorer = async () => {
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(entry.path);
    } catch (error) {
      console.error("Failed to open in explorer:", error);
    }
    setMenuOpen(false);
  };

  return (
    <div>
      <div
        className="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => {
          setIsHovered(false);
          if (!menuOpen) {
            setConfirmDelete(false);
          }
        }}
      >
        <div
          onClick={handleClick}
          className={`flex items-center gap-1 pr-2 py-1 cursor-pointer ${t.borderRadius} ${
            isSelected ? t.colors.bgTertiary : `hover:${t.colors.bgTertiary}`
          }`}
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {entry.is_dir ? (
            <>
              {isOpen ? (
                <ChevronDown size={14} className={t.colors.textMuted} />
              ) : (
                <ChevronRight size={14} className={t.colors.textMuted} />
              )}
              {isOpen ? (
                <FolderOpen size={16} className="text-yellow-500" />
              ) : (
                <Folder size={16} className="text-yellow-500" />
              )}
            </>
          ) : (
            <>
              <span style={{ width: 14 }} />
              <File size={16} className={t.colors.textMuted} />
            </>
          )}
          <span className={`text-sm truncate flex-1 ${t.colors.text}`}>{entry.name}</span>

          {/* Three-dot menu button — visible on hover */}
          {isHovered && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setMenuPosition({ top: rect.bottom + 4, left: rect.right - 160 });
                setMenuOpen(!menuOpen);
                setConfirmDelete(false);
              }}
              className={`p-0.5 ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text} flex-shrink-0`}
            >
              <MoreVertical size={14} />
            </button>
          )}
        </div>

        {/* Dropdown menu */}
        {menuOpen && (
          <div
            ref={menuRef}
            className={`fixed z-50 ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-lg min-w-[160px]`}
            style={{ top: menuPosition.top, left: menuPosition.left }}
          >
            {!entry.is_dir && (
              <button
                onClick={handleViewHistory}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${t.colors.text} hover:${t.colors.bgTertiary}`}
              >
                <History size={14} />
                View History
              </button>
            )}
            <button
              onClick={handleOpenInExplorer}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${t.colors.text} hover:${t.colors.bgTertiary}`}
            >
              <OpenFolder size={14} />
              Open in Explorer
            </button>
            <div className={`${t.colors.border} border-t my-1`} />

            {/* Delete with confirmation */}
            {confirmDelete ? (
              <div className={`px-3 py-2`}>
                <p className={`text-xs ${t.colors.textMuted} mb-2`}>
                  Delete{" "}
                  <span className="text-red-400 font-medium">
                    {entry.name}
                  </span>
                  {entry.is_dir ? " and all its contents" : ""}?
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleDelete}
                    className={`flex-1 px-2 py-1 text-xs ${t.borderRadius} bg-red-600 text-white hover:bg-red-500`}
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className={`flex-1 px-2 py-1 text-xs ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.textMuted}`}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 text-red-500 hover:${t.colors.bgTertiary}`}
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {entry.is_dir && isOpen && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeItem key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function FileTree() {
  const { fileTree } = useProjectStore();
  const { theme } = useSettingsStore();
  const t = themes[theme];

  if (fileTree.length === 0) {
    return (
      <div className={`${t.colors.textMuted} text-sm p-2`}>
        Open a project to see files
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {fileTree.map((entry) => (
        <FileTreeItem key={entry.path} entry={entry} depth={0} />
      ))}
    </div>
  );
}

export default FileTree;