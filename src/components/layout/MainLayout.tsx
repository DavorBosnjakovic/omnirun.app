import { useState, useCallback, useEffect, useRef } from "react";
import { PanelRight, ArrowLeft } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useSnapshotStore } from "../../stores/snapshotStore";
import { useProjectStore } from "../../stores/projectStore";
import { themes } from "../../config/themes";
import { watchProject, unwatchProject, readDirectory } from "../../services/fileService";
import { generateManifest } from "../../services/manifestService";
import { refreshContext } from "../../services/contextService";
import Topbar from "../topbar/Topbar";
import Sidebar from "../sidebar/Sidebar";
import ChatArea from "../chat/ChatArea";
import PreviewArea from "../preview/PreviewArea";
import SettingsLayout from "../settings/SettingsLayout";
import TimeMachine from "../timemachine/TimeMachine";
import TerminalPanel from "../terminal/TerminalPanel";
import TasksPage from "../tasks/TasksPage";
import DeployPage from "../deploy/DeployPage";
import HealthChecksPage from "../health/HealthChecksPage";
import RoutinesPage from "../routines/RoutinesPage";
import HomePage from "../home/HomePage";
import AssistantSection from "../assistant/AssistantSection";
import VoiceCommandModal from "../voice/VoiceCommandModal";
import type { AppSection } from "../home/HomePage";
import { useVoiceStore } from "../../stores/voiceStore";

function MainLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("general");

  // Top-level section nav state
  const [activeSection, setActiveSection] = useState<AppSection>('home');

  // Tools page navigation within the Projects section
  const [toolsPage, setToolsPage] = useState<string | null>(null);

  // Message to auto-send when switching back to chat
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

  // ── File watcher — refresh tree on external changes ──────────────
  const watcherPathRef = useRef<string | null>(null);

  useEffect(() => {
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

      try {
        const files = await readDirectory(watchPath, 3);
        setFileTree(files);
        const manifest = await generateManifest(watchPath, files);
        setManifest(manifest);
      } catch (err) {
        console.error("[watcher] Failed to refresh file tree:", err);
      }

      const hasNonContextChanges = changedPaths.some(
        (p) => !p.replace(/\\/g, "/").includes("/.omnirun/")
      );
      if (hasNonContextChanges) {
        refreshContext(watchPath).catch((err) =>
          console.error("[watcher] Failed to refresh context:", err)
        );
      }

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

  // ── Voice navigation — let voice commands switch sections ──────
  useEffect(() => {
    const { setOnNavigate, setOnOpenSettings } = useVoiceStore.getState();
    setOnNavigate((section: string) => {
      const validSections: AppSection[] = ['home', 'projects', 'assistant', 'tasks'];
      if (validSections.includes(section as AppSection)) {
        handleSectionChange(section as AppSection);
      }
    });
    setOnOpenSettings((tab: string) => {
      handleSettingsClick(tab);
    });
    return () => {
      useVoiceStore.getState().setOnNavigate(null);
      useVoiceStore.getState().setOnOpenSettings(null);
    };
  }, []);

  // ── Listen for settings open events from child components ──
  useEffect(() => {
    const handler = (e: any) => handleSettingsClick(e.detail || 'general');
    window.addEventListener('omnirun-open-settings', handler);
    return () => window.removeEventListener('omnirun-open-settings', handler);
  }, []);

  // ── Listen for tools page navigation from child components ──
  // (Used by DeployModal's "View in OmniRun" button and similar
  // deep-links from anywhere in the app.)
  useEffect(() => {
    const handler = (e: any) => {
      const page = e.detail;
      if (typeof page === 'string') handleToolsNavigate(page);
    };
    window.addEventListener('omnirun-navigate-tools', handler);
    return () => window.removeEventListener('omnirun-navigate-tools', handler);
  }, []);

  // ── Divider drag handlers ─────────────────────────────────────────

  const handleVerticalMouseDown = useCallback(() => {
    setIsDraggingVertical(true);
  }, []);

  const handleHorizontalMouseDown = useCallback(() => {
    setIsDraggingHorizontal(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsDraggingVertical(false);
    setIsDraggingHorizontal(false);
  }, []);

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
        const newTerminalPercent =
          ((availableHeight - mouseY) / availableHeight) * 100;
        setTerminalHeight(Math.min(Math.max(newTerminalPercent, 10), 70));
      }
    },
    [isDraggingVertical, isDraggingHorizontal, sidebarOpen]
  );

  // ── Navigation handlers ───────────────────────────────────────────

  const handleSettingsClick = (tab: string = "general") => {
    setSettingsTab(tab);
    setSettingsOpen(true);
    setToolsPage(null);
  };

  const handleToolsNavigate = (page: string) => {
    if (page === "tasks") {
      setActiveSection('tasks');
      setSettingsOpen(false);
      return;
    }
    setToolsPage(page);
    setSettingsOpen(false);
    setActiveSection('projects');
  };

  const handleBackToChat = () => {
    setToolsPage(null);
  };

  const handleSendToChat = (message: string, switchToProjectPath?: string) => {
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
    setActiveSection('projects');
  };

  const handleSectionChange = (section: AppSection) => {
    setActiveSection(section);
    setSettingsOpen(false);
    if (section !== 'projects') {
      setToolsPage(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────

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
        {/* Sidebar */}
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onSettingsClick={handleSettingsClick}
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
        />

        {/* ── Settings overlay ── */}
        {settingsOpen ? (
          <SettingsLayout
            onClose={() => setSettingsOpen(false)}
            initialTab={settingsTab}
          />

        ) : activeSection === 'home' ? (
          <HomePage
            onNavigate={handleSectionChange}
            onSettingsClick={handleSettingsClick}
          />

        ) : activeSection === 'assistant' ? (
          <AssistantSection />

        ) : activeSection === 'tasks' ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-6">
              <TasksPage onSendToChat={handleSendToChat} />
            </div>
          </div>

        ) : (
          toolsPage ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className={`flex items-center gap-2 px-4 py-3 ${t.colors.border} border-b`}>
                <button
                  onClick={handleBackToChat}
                  className={`flex items-center gap-1.5 text-sm ${t.colors.textMuted} hover:${t.colors.text} transition-colors`}
                >
                  <ArrowLeft size={16} />
                  Back to Chat
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {toolsPage === "deploy" && (
                  <DeployPage
                    onSettingsClick={handleSettingsClick}
                    onSendToChat={(msg) => handleSendToChat(msg)}
                  />
                )}
                {toolsPage === "health" && (
                  <HealthChecksPage
                    onSettingsClick={handleSettingsClick}
                    onSendToChat={(msg) => handleSendToChat(msg)}
                  />
                )}
                {toolsPage === "routines" && (
                  <RoutinesPage
                    onSendToChat={(msg) => handleSendToChat(msg)}
                  />
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <div
                className="flex overflow-hidden"
                style={{ height: showTerminal ? `${100 - terminalHeight}%` : "100%" }}
              >
                <div
                  className={`flex flex-col ${t.colors.border} ${previewOpen ? "border-r" : ""}`}
                  style={{ width: previewOpen ? `${chatWidth}%` : "100%" }}
                >
                  <ChatArea
                    onSettingsClick={handleSettingsClick}
                    pendingMessage={pendingChatMessage}
                    onPendingMessageConsumed={() => setPendingChatMessage(null)}
                  />
                </div>

                {previewOpen && (
                  <>
                    <div
                      className={`w-1 cursor-col-resize ${isDraggingVertical ? "bg-blue-500" : t.colors.bgSecondary} hover:bg-blue-500 transition-colors`}
                      onMouseDown={handleVerticalMouseDown}
                    />
                    <div className="flex-1 flex flex-col">
                      <PreviewArea onClose={() => setPreviewOpen(false)} />
                    </div>
                  </>
                )}

                {!previewOpen && (
                  <div className={`w-12 ${t.colors.bgSecondary} ${t.colors.border} border-l flex flex-col items-center`}>
                    <button
                      onClick={() => setPreviewOpen(true)}
                      className={`h-12 w-full flex items-center justify-center ${t.colors.text} hover:opacity-70`}
                      title="Open Preview"
                    >
                      <PanelRight size={20} />
                    </button>
                  </div>
                )}

                {timeMachineOpen && <TimeMachine />}
              </div>

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
          )
        )}
      </div>

      {/* Voice command overlay — global, always rendered */}
      <VoiceCommandModal />
    </div>
  );
}

export default MainLayout;