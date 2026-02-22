import { useState, useRef, useEffect } from "react";
import { PanelLeftClose, PanelLeft, FolderPlus, Folder, FileCode, MessageSquare, Settings, HelpCircle, MoreVertical, Trash2, FolderOpen, RefreshCw } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import { themes } from "../../config/themes";
import { readDirectory } from "../../services/fileService";
import { generateManifest } from "../../services/manifestService";
import { dbService } from "../../services/dbService";
import FileTree from "../sidebar/FileTree";
import ChatHistory from "../sidebar/ChatHistory";
import NewProjectModal from "../newproject/NewProjectModal";

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onSettingsClick: (tab?: string) => void;
}

function Sidebar({ isOpen, onToggle, onSettingsClick }: SidebarProps) {
  const [activeTab, setActiveTab] = useState<"projects" | "files" | "chats">("projects");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { theme } = useSettingsStore();
  const { projects, currentProject, projectPath, setCurrentProject, setProjectPath, setFileTree, setManifest, addProject, removeProject } = useProjectStore();
  const t = themes[theme];

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNewProject = () => {
    setNewProjectModalOpen(true);
  };

  const handleProjectReady = async (selectedPath: string, folderName: string, templateId?: string, templateName?: string) => {
    try {
      const project = {
        id: Date.now().toString(),
        name: folderName,
        path: selectedPath,
        templateId,
        templateName,
      };

      addProject(project);
      setCurrentProject(project);
      setProjectPath(selectedPath);

      // Tell Rust backend about the project path
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_project_path", { path: selectedPath });

      const files = await readDirectory(selectedPath, 3);
      setFileTree(files);

      // Generate manifest for the new project
      const manifest = await generateManifest(selectedPath, files);
      setManifest(manifest);

      setActiveTab("files");
      setNewProjectModalOpen(false);
    } catch (error) {
      console.error("Failed to set up project:", error);
    }
  };

  const handleOpenProject = async (project: { id: string; name: string; path: string }) => {
    try {
      setCurrentProject(project);
      setProjectPath(project.path);
      useProjectStore.getState().setSelectedFile(null);
      
      // Tell Rust backend about the project path (security scope)
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_project_path", { path: project.path });
      
      const files = await readDirectory(project.path, 3);
      setFileTree(files);
      
      // Generate manifest for the opened project
      const manifest = await generateManifest(project.path, files);
      setManifest(manifest);
    } catch (error) {
      console.error("Failed to open project:", error);
    }
  };

  const handleDeleteProject = (projectId: string) => {
    removeProject(projectId);
    if (currentProject?.id === projectId) {
      setCurrentProject(null);
      setProjectPath(null);
      setFileTree([]);
      setManifest(null);
      dbService.setLastProjectId("").catch(() => {});
    }
    setMenuOpen(null);
  };

  // Auto-select a project on startup if none is selected
  const startupRan = useRef(false);
  useEffect(() => {
    if (startupRan.current || currentProject || projects.length === 0) return;
    startupRan.current = true;

    // Try to reopen the last used project, fall back to first in list
    dbService.getLastProjectId().then((lastId) => {
      const target = (lastId && projects.find((p) => p.id === lastId)) || projects[0];
      if (target) {
        handleOpenProject(target);
      }
    }).catch(() => {
      // Fallback: just open the first project
      if (projects[0]) handleOpenProject(projects[0]);
    });
  }, [projects, currentProject]);

  const handleRefreshFiles = async () => {
    if (!projectPath) return;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("set_project_path", { path: projectPath });
      
      const files = await readDirectory(projectPath, 3);
      setFileTree(files);
      
      // Regenerate manifest on refresh
      const manifest = await generateManifest(projectPath, files);
      setManifest(manifest);
    } catch (error) {
      console.error("Failed to refresh files:", error);
    }
    setMenuOpen(null);
  };

  const handleOpenInExplorer = async (path: string) => {
    try {
      const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
      await revealItemInDir(path);
    } catch (error) {
      console.error("Failed to open in explorer:", error);
    }
    setMenuOpen(null);
  };

  return (
    <>
      <div className={`${isOpen ? "w-64" : "w-12"} ${t.colors.bgSecondary} ${t.colors.border} border-r flex flex-col transition-all duration-300 ${t.glow}`}>
      {/* Toggle button */}
      <button
        onClick={onToggle}
        className={`h-12 ${t.colors.text} hover:opacity-70 flex items-center justify-center`}
      >
        {isOpen ? <PanelLeftClose size={20} /> : <PanelLeft size={20} />}
      </button>

      {/* Tabs */}
      {isOpen && (
        <div className={`flex gap-1 px-2 ${t.colors.border} border-b`}>
          <button
            onClick={() => setActiveTab("projects")}
            className={`flex-1 py-2 px-2 text-xs flex items-center justify-center gap-1.5 rounded-t-lg ${
              activeTab === "projects"
                ? `${t.colors.bgTertiary} ${t.colors.text}`
                : `${t.colors.bg} ${t.colors.textMuted} hover:${t.colors.text}`
            }`}
          >
            <Folder size={14} />
            Projects
          </button>
          <button
            onClick={() => setActiveTab("files")}
            className={`flex-1 py-2 px-2 text-xs flex items-center justify-center gap-1.5 rounded-t-lg ${
              activeTab === "files"
                ? `${t.colors.bgTertiary} ${t.colors.text}`
                : `${t.colors.bg} ${t.colors.textMuted} hover:${t.colors.text}`
            }`}
          >
            <FileCode size={14} />
            Files
          </button>
          <button
            onClick={() => setActiveTab("chats")}
            className={`flex-1 py-2 px-2 text-xs flex items-center justify-center gap-1.5 rounded-t-lg ${
              activeTab === "chats"
                ? `${t.colors.bgTertiary} ${t.colors.text}`
                : `${t.colors.bg} ${t.colors.textMuted} hover:${t.colors.text}`
            }`}
          >
            <MessageSquare size={14} />
            Chats
          </button>
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 overflow-y-auto p-2">
        {isOpen && activeTab === "projects" && (
          <div>
            {projects.length === 0 ? (
              <div className={`${t.colors.textMuted} text-sm p-2 ${t.fontFamily}`}>
                No projects yet
              </div>
            ) : (
              <div className="space-y-1">
                {projects.map((project) => (
                  <div
                    key={project.id}
                    className={`relative flex items-center ${t.borderRadius} ${
                      currentProject?.id === project.id
                        ? `${t.colors.bgTertiary}`
                        : `hover:${t.colors.bgTertiary}`
                    }`}
                  >
                    <button
                      onClick={() => handleOpenProject(project)}
                      className={`flex-1 text-left px-3 py-2 text-sm flex items-center gap-2 ${
                        currentProject?.id === project.id
                          ? t.colors.text
                          : t.colors.textMuted
                      }`}
                    >
                      <Folder size={16} />
                      <span className="truncate">{project.name}</span>
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(menuOpen === project.id ? null : project.id);
                      }}
                      className={`p-2 ${t.colors.textMuted} hover:${t.colors.text}`}
                    >
                      <MoreVertical size={16} />
                    </button>

                    {/* Dropdown menu */}
                    {menuOpen === project.id && (
                      <div
                        ref={menuRef}
                        className={`absolute right-0 top-full mt-1 z-50 ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-lg min-w-[160px]`}
                      >
                        <button
                          onClick={() => handleOpenInExplorer(project.path)}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${t.colors.text} hover:${t.colors.bgTertiary}`}
                        >
                          <FolderOpen size={14} />
                          Open in Explorer
                        </button>
                        <button
                          onClick={() => {
                            if (currentProject?.id === project.id) {
                              handleRefreshFiles();
                            } else {
                              handleOpenProject(project);
                            }
                          }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${t.colors.text} hover:${t.colors.bgTertiary}`}
                        >
                          <RefreshCw size={14} />
                          Refresh Files
                        </button>
                        <div className={`${t.colors.border} border-t my-1`} />
                        <button
                          onClick={() => handleDeleteProject(project.id)}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 text-red-500 hover:${t.colors.bgTertiary}`}
                        >
                          <Trash2 size={14} />
                          Remove Project
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {isOpen && activeTab === "files" && (
          <div>
            {projectPath && (
              <div className="flex items-center justify-end mb-1">
                <button
                  onClick={handleRefreshFiles}
                  className={`p-1 ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text} hover:${t.colors.bgTertiary}`}
                  title="Sync files"
                >
                  <RefreshCw size={14} />
                </button>
              </div>
            )}
            <FileTree />
          </div>
        )}
        {isOpen && activeTab === "chats" && (
          <ChatHistory />
        )}
      </div>

      {/* Bottom section */}
      <div className={`${t.colors.border} border-t`}>
        {/* Settings & Help */}
        <div className={`${isOpen ? "px-3 py-2" : "px-1 py-2"} space-y-0.5`}>
          <button
            onClick={() => onSettingsClick("general")}
            className={`w-full flex items-center gap-2.5 ${isOpen ? "px-2" : "justify-center"} py-1.5 ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
            title="Settings"
          >
            <Settings size={18} />
            {isOpen && <span className="text-sm">Settings</span>}
          </button>
          <button
            onClick={() => onSettingsClick("about")}
            className={`w-full flex items-center gap-2.5 ${isOpen ? "px-2" : "justify-center"} py-1.5 ${t.borderRadius} ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
            title="Help"
          >
            <HelpCircle size={18} />
            {isOpen && <span className="text-sm">Help</span>}
          </button>
        </div>

        {/* New project button */}
        {isOpen && (
          <div className="p-3 pt-1">
            <button
              onClick={handleNewProject}
              className={`w-full ${t.colors.accent} ${t.colors.accentHover} ${theme === "highContrast" ? "text-black" : "text-white"} py-2 px-4 ${t.borderRadius} flex items-center justify-center gap-2 ${t.fontFamily}`}
            >
              <FolderPlus size={18} />
              New Project
            </button>
          </div>
        )}
      </div>
      </div>

      {/* New Project Modal — rendered outside sidebar to avoid transform/overflow issues */}
      <NewProjectModal
        isOpen={newProjectModalOpen}
        onClose={() => setNewProjectModalOpen(false)}
        onProjectReady={handleProjectReady}
      />
    </>
  );
}

export default Sidebar;