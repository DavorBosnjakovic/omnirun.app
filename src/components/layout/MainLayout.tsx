import { useState, useCallback, useEffect, useRef } from "react";
import { PanelRight, ArrowLeft } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSnapshotStore } from "../../stores/snapshotStore";
import { useProjectStore } from "../../stores/projectStore";
import { themes } from "../../config/themes";
import { watchProject, unwatchProject, readDirectory } from "../../services/fileService";
import { generateManifest } from "../../services/manifestService";
import Topbar from "../topbar/Topbar";
import Sidebar from "../sidebar/Sidebar";
import ChatArea from "../chat/ChatArea";
import PreviewArea from "../preview/PreviewArea";
import SettingsLayout from "../settings/SettingsLayout";
import TimeMachine from "../timemachine/TimeMachine";
import TerminalPanel from "../terminal/TerminalPanel";
import TasksPage from "../tasks/TasksPage";

function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");

  // Tools page navigation (null = chat view, "tasks" | "deploy" | "health" | "routines")
  const [toolsPage, setToolsPage] = useState<string | null>(null);

  // Message to auto-send when switching back to chat (e.g. from task suggestions)
  const [pendingChatMessage, setPendingChatMessage] = useState<string | null>(null);

  // Vertical divider (chat <-> preview)
  const [chatWidth, setChatWidth] = useState(50);
  const [isDraggingVertical, setIsDraggingVertical] = useState(false);

  // Horizontal divider (editor area <-> terminal)
  const [terminalHeight, setTerminalHeight] = useState(30);
  const [isDraggingHorizontal, setIsDraggingHorizontal] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);

  const { theme, mode } = useSettingsStore();
  const { isOpen: timeMachineOpen } = useSnapshotStore();
  const { projectPath, setFileTree, setManifest, setExternalFileChange } = useProjectStore();
  const t = themes[theme];

  const showTerminal = mode === "technical" && terminalOpen;

  // ── File watcher — refresh tree on external changes ──────
  const watcherPathRef = useRef<string | null>(null);

  useEffect(() => {
    // Clean up previous watcher
    if (watcherPathRef.current && watcherPathRef.current !== projectPath) {
      unwatchProject();
    }

    if (!projectPath) {
      watcherPathRef.current = null;
      return;
    }

    watcherPathRef.current = projectPath;
    const watchPath = projectPath;

    watchProject(watchPath, async (changedPaths) => {
      console.log("[watcher] Files changed externally:", changedPaths.length);

      // Refresh file tree
      try {
        const files = await readDirectory(watchPath, 3);
        setFileTree(files);

        // Regenerate manifest
        const manifest = await generateManifest(watchPath, files);
        setManifest(manifest);
      } catch (err) {
        console.error("[watcher] Failed to refresh file tree:", err);
      }

      // Check if the currently selected file (in edit mode) was changed externally
      const { selectedFile } = useProjectStore.getState();
      if (selectedFile && !selectedFile.is_dir) {
        const selectedNorm = selectedFile.path.replace(/\\/g, "/");
        const wasChanged = changedPaths.some(
          (p) => p.replace(/\\/g, "/") === selectedNorm
        );
        if (wasChanged) {
          setExternalFileChange({ path: selectedFile.path, timestamp: Date.now() });
        }
      }
    });

    return () => {
      unwatchProject();
      watcherPathRef.current = null;
    };
  }, [projectPath]);

  // --- Vertical divider handlers (chat <-> preview) ---
  const handleVerticalMouseDown = useCallback(() => {
    setIsDraggingVertical(true);
  }, []);

  // --- Horizontal divider handlers (editor <-> terminal) ---
  const handleHorizontalMouseDown = useCallback(() => {
    setIsDraggingHorizontal(true);
  }, []);

  // --- Unified mouse up ---
  const handleMouseUp = useCallback(() => {
    setIsDraggingVertical(false);
    setIsDraggingHorizontal(false);
  }, []);

  // --- Unified mouse move ---
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (isDraggingVertical) {
        const container = e.currentTarget;
        const rect = container.getBoundingClientRect();
        const sidebarWidth = sidebarOpen ? 256 : 48;
        const availableWidth = rect.width - sidebarWidth;
        const mouseX = e.clientX - rect.left - sidebarWidth;
        const newChatWidth = Math.min(
          Math.max((mouseX / availableWidth) * 100, 20),
          80
        );
        setChatWidth(newChatWidth);
      }

      if (isDraggingHorizontal) {
        const container = e.currentTarget;
        const rect = container.getBoundingClientRect();
        const topbarHeight = 48;
        const availableHeight = rect.height - topbarHeight;
        const mouseY = e.clientY - rect.top - topbarHeight;
        // Terminal height is measured from bottom, so invert
        const newTerminalPercent =
          ((availableHeight - mouseY) / availableHeight) * 100;
        setTerminalHeight(Math.min(Math.max(newTerminalPercent, 10), 70));
      }
    },
    [isDraggingVertical, isDraggingHorizontal, sidebarOpen]
  );

  const handleSettingsClick = (tab: string = "general") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
    setToolsPage(null);
  };

  const handleToolsNavigate = (page: string) => {
    setToolsPage(page);
    setSettingsOpen(false);
  };

  const handleBackToChat = () => {
    setToolsPage(null);
  };

  const handleSendToChat = (message: string, switchToProjectPath?: string) => {
    // If a project path is provided (e.g. from Tasks page), switch to that project
    // so the AI operates on the correct project files and context
    if (switchToProjectPath) {
      const { projects, setCurrentProject, setProjectPath } = useProjectStore.getState();
      const targetProject = projects.find(
        (p) => p.path === switchToProjectPath || p.id === switchToProjectPath
      );
      if (targetProject) {
        setCurrentProject(targetProject);
        setProjectPath(targetProject.path);
      }
    }
    setPendingChatMessage(message);
    setToolsPage(null);
    setSettingsOpen(false);
  };

  return (
    <div
      className={`flex flex-col h-screen ${t.colors.bg} ${t.colors.text} ${t.fontFamily} select-none`}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Top bar */}
      <Topbar
        terminalOpen={terminalOpen}
        onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
        onToolsNavigate={handleToolsNavigate}
        onSettingsClick={() => handleSettingsClick()}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - always visible */}
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onSettingsClick={handleSettingsClick}
        />

        {/* Settings view */}
        {settingsOpen ? (
          <SettingsLayout
            onClose={() => setSettingsOpen(false)}
            initialTab={settingsTab}
          />
        ) : toolsPage ? (
          /* Tools page view — replaces chat area */
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Back to Chat header */}
            <div className={`flex items-center gap-2 px-4 py-3 ${t.colors.border} border-b`}>
              <button
                onClick={handleBackToChat}
                className={`flex items-center gap-1.5 text-sm ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
              >
                <ArrowLeft size={16} />
                Back to Chat
              </button>
            </div>

            {/* Tools page content */}
            <div className="flex-1 overflow-y-auto p-6">
              {toolsPage === "tasks" && <TasksPage onSendToChat={handleSendToChat} />}
              {toolsPage === "deploy" && (
                <div className={`${t.colors.textMuted} text-center py-20`}>
                  <p className="text-lg mb-2">Deploy</p>
                  <p className="text-sm">Coming soon</p>
                </div>
              )}
              {toolsPage === "health" && (
                <div className={`${t.colors.textMuted} text-center py-20`}>
                  <p className="text-lg mb-2">Health Checks</p>
                  <p className="text-sm">Coming soon</p>
                </div>
              )}
              {toolsPage === "routines" && (
                <div className={`${t.colors.textMuted} text-center py-20`}>
                  <p className="text-lg mb-2">Routines</p>
                  <p className="text-sm">Coming soon</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* ── Upper area: Chat + Preview ── */}
            <div
              className="flex overflow-hidden"
              style={{
                height: showTerminal
                  ? `${100 - terminalHeight}%`
                  : "100%",
              }}
            >
              {/* Chat area */}
              <div
                className={`flex flex-col ${t.colors.border} ${previewOpen ? "border-r" : ""}`}
                style={{
                  width: previewOpen ? `${chatWidth}%` : "100%",
                }}
              >
                <ChatArea
                  onSettingsClick={handleSettingsClick}
                  pendingMessage={pendingChatMessage}
                  onPendingMessageConsumed={() => setPendingChatMessage(null)}
                />
              </div>

              {previewOpen && (
                <>
                  {/* Vertical resize handle */}
                  <div
                    className={`w-1 cursor-col-resize ${isDraggingVertical ? "bg-blue-500" : t.colors.bgSecondary} hover:bg-blue-500 transition-colors`}
                    onMouseDown={handleVerticalMouseDown}
                  />
                  {/* Preview area */}
                  <div className="flex-1 flex flex-col">
                    <PreviewArea onClose={() => setPreviewOpen(false)} />
                  </div>
                </>
              )}

              {/* Preview toggle button (when closed) */}
              {!previewOpen && (
                <button
                  onClick={() => setPreviewOpen(true)}
                  className={`w-10 ${t.colors.bgSecondary} ${t.colors.text} flex items-center justify-center hover:opacity-80`}
                >
                  <PanelRight size={20} />
                </button>
              )}

              {/* Time Machine panel */}
              {timeMachineOpen && <TimeMachine />}
            </div>

            {/* ── Horizontal resize divider + Terminal ── */}
            {showTerminal && (
              <>
                <div
                  className={`h-1 cursor-row-resize ${isDraggingHorizontal ? "bg-blue-500" : t.colors.bgSecondary} hover:bg-blue-500 transition-colors`}
                  onMouseDown={handleHorizontalMouseDown}
                />
                <div
                  className={`overflow-hidden ${t.colors.border} border-t`}
                  style={{ height: `${terminalHeight}%` }}
                >
                  <TerminalPanel />
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default MainLayout;