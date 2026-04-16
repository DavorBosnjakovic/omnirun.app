import { ExternalLink, PanelRightClose, FileCode, Copy, Check, Globe, RefreshCw, Pencil, Save, X, Download, Terminal, AlertCircle, Loader, Monitor, Tablet, Smartphone, Play, Square, MousePointer, Rocket, Settings } from "lucide-react";
import { useState, useEffect, useRef } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import { useChatStore } from "../../stores/chatStore";
import { themes } from "../../config/themes";
import { readFile, writeFile, readDirectory } from "../../services/fileService";
import { updateManifestEntry, getRelativePath } from "../../services/manifestService";
import { detectProjectType, ProjectDetection } from "../../services/projectDetector";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useElementSelectionStore } from "../../stores/elementSelectionStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useDeployStore } from "../../stores/deployStore";
import DeployTargetPicker from "../deploy/DeployTargetPicker";
import { useDeployTargetStore } from "../../stores/deployTargetStore";
import { listConnectedDeployProviders } from "../../services/deploymentService";
import FloatingActionBar from "./FloatingActionBar";

interface PreviewAreaProps {
  onClose: () => void;
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];

// Responsive viewport presets
type ViewportSize = "desktop" | "tablet" | "mobile";
const VIEWPORT_PRESETS: Record<ViewportSize, { width: number | null; label: string; icon: typeof Monitor }> = {
  desktop: { width: null, label: "Desktop", icon: Monitor },      // null = full width
  tablet:  { width: 768, label: "Tablet (768px)", icon: Tablet },
  mobile:  { width: 375, label: "Mobile (375px)", icon: Smartphone },
};

// Preview states for the universal preview system
type PreviewStatus =
  | "detecting"        // Checking project type
  | "static"           // Using axum static server
  | "needs-install"    // Framework project missing node_modules/deps
  | "installing"       // Running npm/yarn/pnpm install (or pip, flutter pub get, etc.)
  | "starting-dev"     // Dev server is spinning up
  | "dev-running"      // Dev server is running, iframe loaded
  | "native-app"       // Native app project (Tauri, Electron, Flutter, Rust, etc.) — no iframe
  | "native-running"   // Native app process is running — show output panel
  | "non-web"          // Not a web project
  | "error";           // Something went wrong

// ── Phone Mockup Component ───────────────────────────────────
// Pure CSS phone frame with notch, status bar, and home indicator.
// Wraps any content (iframe, native output panel, etc.) in a
// realistic mobile device bezel that matches the app theme.

interface PhoneMockupProps {
  children: React.ReactNode;
  theme: ReturnType<typeof useSettingsStore.getState>["theme"];
  t: (typeof themes)[keyof typeof themes];
}

function PhoneMockup({ children, theme, t }: PhoneMockupProps) {
  // Dynamic bezel color — slightly lighter than bgSecondary so the frame pops
  const bezelBg = theme === "light" || theme === "sepia" ? "#1C1C1E" : "#2A2A2E";
  const bezelBorder = theme === "light" || theme === "sepia" ? "#3A3A3C" : "#3A3A3E";
  const statusBarBg = theme === "light" || theme === "sepia" ? "#1C1C1E" : "#1A1A1E";

  return (
    <div className="flex flex-col items-center h-full py-4 px-2 overflow-auto"
      style={{ background: "transparent" }}
    >
      {/* Phone body */}
      <div
        className="relative flex flex-col flex-1 min-h-0"
        style={{
          width: 393,
          maxWidth: "100%",
          background: bezelBg,
          borderRadius: 44,
          border: `3px solid ${bezelBorder}`,
          boxShadow: "0 8px 40px rgba(0,0,0,0.35), 0 2px 8px rgba(0,0,0,0.2)",
          padding: "12px 4px",
          overflow: "hidden",
        }}
      >
        {/* Notch / Dynamic Island */}
        <div
          style={{
            position: "absolute",
            top: 12,
            left: "50%",
            transform: "translateX(-50%)",
            width: 120,
            height: 28,
            background: "#000",
            borderRadius: 20,
            zIndex: 20,
          }}
        />

        {/* Status bar (time, signal, battery) */}
        <div
          className="flex items-center justify-between px-8 flex-shrink-0"
          style={{
            height: 44,
            background: statusBarBg,
            borderRadius: "40px 40px 0 0",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif",
            position: "relative",
            zIndex: 10,
          }}
        >
          <span style={{ opacity: 0.9 }}>9:41</span>
          <div style={{ width: 120 }} /> {/* Space for notch */}
          <div className="flex items-center gap-1.5" style={{ opacity: 0.9 }}>
            {/* Signal bars */}
            <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
              <rect x="0" y="8" width="3" height="4" rx="0.5" fill="#fff" />
              <rect x="4.5" y="5" width="3" height="7" rx="0.5" fill="#fff" />
              <rect x="9" y="2" width="3" height="10" rx="0.5" fill="#fff" />
              <rect x="13" y="0" width="3" height="12" rx="0.5" fill="#fff" />
            </svg>
            {/* Battery */}
            <svg width="24" height="12" viewBox="0 0 24 12" fill="none">
              <rect x="0.5" y="0.5" width="20" height="11" rx="2" stroke="#fff" strokeOpacity="0.4" />
              <rect x="2" y="2" width="16" height="8" rx="1" fill="#34C759" />
              <rect x="22" y="3.5" width="2" height="5" rx="1" fill="#fff" fillOpacity="0.4" />
            </svg>
          </div>
        </div>

        {/* Screen content area */}
        <div
          className="flex-1 min-h-0 overflow-hidden"
          style={{
            background: "#fff",
            borderRadius: "0 0 36px 36px",
          }}
        >
          {children}
        </div>

        {/* Home indicator */}
        <div
          className="flex justify-center flex-shrink-0"
          style={{ paddingTop: 6, paddingBottom: 2 }}
        >
          <div
            style={{
              width: 134,
              height: 5,
              borderRadius: 100,
              background: "rgba(255,255,255,0.25)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function PreviewArea({ onClose }: PreviewAreaProps) {
  const [tooltip, setTooltip] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);

  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [showConflict, setShowConflict] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Live preview state
  const [previewMode, setPreviewMode] = useState<"file" | "live">("live");
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [viewportSize, setViewportSize] = useState<ViewportSize>("desktop");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Universal preview state
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("detecting");
  const [detection, setDetection] = useState<ProjectDetection | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [installOutput, setInstallOutput] = useState<string>("");
  const [nativeOutput, setNativeOutput] = useState<string>("");
  const [nativeRunning, setNativeRunning] = useState(false);

  const { theme } = useSettingsStore();
  const { selectedFile, setSelectedFile, projectPath, fileTree, setFileTree, manifest, setManifest, setBuildError, autoFixCount, resetAutoFix, externalFileChange, setExternalFileChange } = useProjectStore();
  const { isLoading: aiIsLoading } = useChatStore();
  const prevAiLoadingRef = useRef(false);
  const [errorPollTrigger, setErrorPollTrigger] = useState(0);
  const previewVersionRef = useRef(0);
  const [installElapsed, setInstallElapsed] = useState(0);
  const installTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const t = themes[theme];

  // ── Deploy button (shows when a deploy provider is connected) ──
  const currentProject = useProjectStore((s) => s.currentProject);
  const projectConnections = useConnectionsStore((s) => s.projectConnections);
  const startDeploy = useDeployStore((s) => s.startDeploy);
  const deployTargets = useDeployTargetStore((s) => s.targets);
  const setDeployTarget = useDeployTargetStore((s) => s.setTarget);
  const [pickerOpen, setPickerOpen] = useState(false);

  const connectedDeployProviders = currentProject
    ? listConnectedDeployProviders(currentProject.id)
    : [];
  // Touch projectConnections so this block re-renders when connections change.
  void projectConnections;
  const canDeploy = connectedDeployProviders.length > 0;

  const savedTarget = currentProject ? deployTargets[currentProject.id] : null;

  const runDeploy = () => {
    if (!currentProject || !projectPath) return;
    // deployProject reads target from store; no need to pass provider here.
    startDeploy({
      projectId: currentProject.id,
      projectPath,
      projectName: savedTarget?.remoteProjectName || currentProject.name || 'omnirun-project',
      cloudflareAccountId: savedTarget?.cloudflareAccountId,
    });
  };

  const handleDeploy = () => {
    if (!currentProject || !projectPath) return;
    // No saved target yet → show picker to pick provider + remote project.
    if (!savedTarget) {
      setPickerOpen(true);
    } else {
      runDeploy();
    }
  };

  // "Change target" — explicitly open the picker regardless of saved state.
  const handleChangeTarget = () => {
    if (!currentProject) return;
    setPickerOpen(true);
  };

  // Resolved path: may differ from projectPath if the app lives in a subdirectory
  const activePath = detection?.resolvedPath || projectPath;

  // Element selection
  const { selectMode, setSelectMode, selectedElements, setSelectedElements, addSelectedElement, clearSelection } = useElementSelectionStore();
  const [iframeRect, setIframeRect] = useState<DOMRect | null>(null);
  const [devServerPort, setDevServerPort] = useState<number | null>(null); // Direct dev server port (for non-select mode)
  const proxyServerPortRef = useRef<number | null>(null); // Our proxy server port (for select mode with dev servers)

  const isImageFile = selectedFile ? IMAGE_EXTENSIONS.some(ext =>
    selectedFile.name.toLowerCase().endsWith(ext)
  ) : false;

  // Whether the detected project is a mobile app (phone mockup in preview)
  const isMobileApp = detection?.isMobileApp ?? false;

  // ── Auto-switch viewport based on project type ──
  useEffect(() => {
    if (isMobileApp) {
      setViewportSize("mobile");
    } else {
      setViewportSize("desktop");
    }
  }, [isMobileApp]);

  // ── Detect project type and start appropriate server ──────

  useEffect(() => {
    if (!projectPath) return;

    previewVersionRef.current += 1;
    const thisVersion = previewVersionRef.current;
    const oldPort = serverPort;
    let cancelled = false;

    const initPreview = async () => {
      setPreviewStatus("detecting");
      setServerPort(null);
      setDevServerPort(null);
      proxyServerPortRef.current = null;
      setStatusMessage("");
      setInstallOutput("");
      setError(null);
      resetAutoFix();

      try {
        const result = await detectProjectType(projectPath);
        if (cancelled || previewVersionRef.current !== thisVersion) return;
        setDetection(result);

        switch (result.type) {
          case "static":
            setPreviewStatus("static");
            setStatusMessage("Starting preview server...");
            try {
              if (oldPort) {
                await invoke("stop_dev_server").catch(() => {});
                await invoke("set_preview_proxy", { targetPort: null }).catch(() => {});
                await new Promise((r) => setTimeout(r, 2000));
              }
              if (previewVersionRef.current !== thisVersion) return;
              const port = await invoke<number>("start_preview_server", { path: result.resolvedPath || projectPath });
              if (!cancelled && previewVersionRef.current === thisVersion) {
                setServerPort(port);
                setRefreshKey((k) => k + 1);
                setStatusMessage("");
              }
            } catch (err: any) {
              if (!cancelled && previewVersionRef.current === thisVersion) {
                setPreviewStatus("error");
                setStatusMessage(err.toString());
              }
            }
            break;

          case "framework":
            if (result.needsInstall) {
              if (aiIsLoading) {
                setPreviewStatus("detecting");
                setStatusMessage("AI is working, waiting to detect project...");
              } else {
                setPreviewStatus("needs-install");
                setStatusMessage(`This ${result.framework} project needs dependencies installed.`);
              }
            } else {
              await startDevServer(result, oldPort, thisVersion);
            }
            break;

          case "native-app":
            if (result.needsInstall) {
              if (aiIsLoading) {
                setPreviewStatus("detecting");
                setStatusMessage("AI is working, waiting to detect project...");
              } else {
                setPreviewStatus("needs-install");
                setStatusMessage(`This ${result.framework} project needs dependencies installed.`);
              }
            } else {
              setPreviewStatus("native-app");
              setNativeOutput("");
              setNativeRunning(false);
            }
            break;

          case "non-web":
            setPreviewStatus("non-web");
            break;
        }
      } catch (err: any) {
        if (!cancelled && previewVersionRef.current === thisVersion) {
          setPreviewStatus("error");
          setStatusMessage(err.toString());
        }
      }
    };

    initPreview();

    return () => {
      cancelled = true;
      invoke("stop_preview_server").catch(() => {});
      invoke("stop_dev_server").catch(() => {});
    };
  }, [projectPath]);

  // Stop all servers on component unmount (app closing)
  useEffect(() => {
    return () => {
      invoke("stop_preview_server").catch(() => {});
      invoke("stop_dev_server").catch(() => {});
    };
  }, []);

  // Auto-refresh live preview when file tree changes (static mode)
  useEffect(() => {
    if (previewMode === "live" && serverPort && (previewStatus === "static" || previewStatus === "dev-running")) {
      setRefreshKey((k) => k + 1);
    }
  }, [fileTree]);

  // Re-detect project type when AI finishes streaming (isLoading: true → false)
  useEffect(() => {
    const wasLoading = prevAiLoadingRef.current;
    prevAiLoadingRef.current = aiIsLoading;

    // Only act when AI just finished (true → false)
    if (wasLoading && !aiIsLoading && projectPath) {
      // Re-detect if not already in a healthy running state
      if (previewStatus !== "dev-running" && previewStatus !== "installing" && previewStatus !== "native-running") {
        console.log("[preview] AI finished streaming, re-detecting project type...");
        reDetectAndSwitch();
      }

      // Trigger build error poll (for dev-running servers)
      setErrorPollTrigger((n) => n + 1);
    }
  }, [aiIsLoading]);

  // ── Poll for build errors after AI finishes writing ──────
  useEffect(() => {
    // Skip the initial render (trigger is 0)
    if (errorPollTrigger === 0) return;
    if (previewStatus !== "dev-running") return;
    if (autoFixCount >= 3) return;

    let cancelled = false;

    const pollForErrors = async () => {
      // Wait for dev server to rebuild (~3 seconds)
      await new Promise((r) => setTimeout(r, 3000));
      if (cancelled) return;

      try {
        const output = await invoke<string>("get_dev_server_output");
        if (cancelled || !output) return;

        // Look for error patterns in the dev server output
        const errorPatterns = [
          /error[:\s]/i,
          /Module not found/i,
          /Failed to compile/i,
          /Cannot resolve/i,
          /SyntaxError/i,
          /TypeError/i,
          /ReferenceError/i,
          /Cannot find module/i,
          /Unexpected token/i,
          /ENOENT/i,
        ];

        const hasError = errorPatterns.some((p) => p.test(output));
        if (!hasError) {
          // No errors — clear any previous build error state
          setBuildError(null);
          return;
        }

        // Extract the meaningful error lines (not the full output)
        const lines = output.split("\n");
        const errorLines: string[] = [];
        let capturing = false;

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Start capturing when we hit an error line
          if (errorPatterns.some((p) => p.test(trimmed))) {
            capturing = true;
          }

          if (capturing) {
            errorLines.push(trimmed);
            // Cap at 15 lines to keep token cost low
            if (errorLines.length >= 15) break;
          }
        }

        const errorText = errorLines.join("\n").slice(0, 1500); // Hard cap at 1500 chars
        if (errorText) {
          console.log("[preview] Build error detected, sending to AI...");
          setBuildError(errorText);
        }
      } catch (err) {
        console.error("[preview] Failed to poll dev server output:", err);
      }
    };

    pollForErrors();

    return () => { cancelled = true; };
  }, [errorPollTrigger]);

  // Switch to file view when a file is clicked, exit edit mode
  useEffect(() => {
    if (selectedFile && !selectedFile.is_dir) {
      setPreviewMode("file");
      setIsEditing(false);
      setShowConflict(false);
    }
  }, [selectedFile]);

  // ── Detect conflict: file changed externally while user is editing ──
  useEffect(() => {
    if (!externalFileChange || !isEditing || !selectedFile) return;

    // Check if the externally changed file matches what we're editing
    const editingPath = selectedFile.path.replace(/\\/g, "/");
    const changedPath = externalFileChange.path.replace(/\\/g, "/");

    if (editingPath === changedPath) {
      setShowConflict(true);
    }

    // Clear the external change so it doesn't re-trigger
    setExternalFileChange(null);
  }, [externalFileChange]);

  // ── Element selection: toggle server-side injection + switch iframe URL ──
  useEffect(() => {
    invoke("set_selection_mode", { enabled: selectMode }).catch(() => {});

    if (selectMode) {
      // For dev server projects: switch iframe to our proxy (which injects the script)
      if (devServerPort && proxyServerPortRef.current) {
        setServerPort(proxyServerPortRef.current);
      }
      // For static projects: same server, refresh injects the script
      setRefreshKey((k) => k + 1);
    } else {
      // Exiting select mode — try to tell iframe to clean up via postMessage
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "__omnirun-disable-selection" }, "*"
        );
      } catch { /* cross-origin, will refresh instead */ }
      // For dev server projects: switch iframe back to direct dev server (HMR works)
      if (devServerPort) {
        setServerPort(devServerPort);
      }
      // Refresh to get clean HTML without the overlay script
      setRefreshKey((k) => k + 1);
    }
  }, [selectMode]);

  // ── Element selection: listen for postMessage from iframe ──
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (!e.data || e.data.type !== "__omnirun-element-selected") return;
      const { element, multiSelect } = e.data;
      if (multiSelect) {
        addSelectedElement(element);
      } else {
        setSelectedElements([element]);
      }
      // Update iframe rect for FloatingActionBar positioning
      if (iframeRef.current) {
        setIframeRect(iframeRef.current.getBoundingClientRect());
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // ── Turn off select mode when switching away from live preview or AI starts ──
  useEffect(() => {
    if (previewMode !== "live" || aiIsLoading) {
      setSelectMode(false);
    }
  }, [previewMode, aiIsLoading]);

  // ── Dev server management ─────────────────────────────────

  const startDevServer = async (det: ProjectDetection, oldPort: number | null = null, version: number = 0) => {
    if (!projectPath || !det.devCommand || !det.portPattern) return;
    const devPath = det.resolvedPath || projectPath;

    const isStale = () => version > 0 && previewVersionRef.current !== version;

    setPreviewStatus("starting-dev");
    setStatusMessage(`Starting ${det.framework} dev server...`);

    try {
      // 1. Stop static server
      await invoke("stop_preview_server").catch(() => {});
      if (isStale()) return;

      // 2. Kill old dev server via Rust and wait for port release
      console.log("[preview] Stopping old dev server, oldPort:", oldPort);
      await invoke("stop_dev_server").catch(() => {});

      if (oldPort) {
        setStatusMessage("Stopping previous server...");
        await new Promise((r) => setTimeout(r, 3000));
        if (isStale()) return;
      }

      // 3. Kill any orphaned node processes on common dev ports (3000-3010).
      //    On Windows, taskkill may not kill the entire process tree if npm
      //    spawns node through an intermediary shell. This is a safety net.
      try {
        const sep = devPath.includes("/") ? "/" : "\\";
        // Windows: find and kill processes using ports 3000-3010
        await invoke("execute_command", {
          command: 'for /f "tokens=5" %a in (\'netstat -aon ^| findstr ":300[0-9] " ^| findstr LISTENING\') do taskkill /PID %a /F 2>nul',
          cwd: devPath,
        }).catch(() => {});

        // 4. Clean framework lock files that prevent restart
        //    Next.js: .next/dev/lock — left behind when process is force-killed
        if (det.framework === "Next.js") {
          const lockPath = `${devPath}${sep}.next${sep}dev${sep}lock`;
          await invoke("delete_path", { path: lockPath }).catch(() => {});
          console.log("[preview] Cleaned .next/dev/lock");
        }
      } catch {
        // Non-critical — continue even if cleanup fails
      }

      if (isStale()) return;

      // 5. Start the new dev server (with EADDRINUSE retry)
      console.log("[preview] Starting dev server:", det.devCommand);
      setStatusMessage(`Starting ${det.framework} dev server...`);

      let port: number = 0;
      let lastErr: any = null;
      const maxRetries = 2;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            console.log(`[preview] Retry attempt ${attempt} after EADDRINUSE`);
            setStatusMessage(`Port in use — killing orphaned process and retrying...`);

            // Kill whatever is on common dev ports
            await invoke("execute_command", {
              command: 'for /f "tokens=5" %a in (\'netstat -aon ^| findstr ":300[0-9] " ^| findstr LISTENING\') do taskkill /PID %a /F 2>nul',
              cwd: devPath,
            }).catch(() => {});
            // Also try higher ports (3010-3020)
            await invoke("execute_command", {
              command: 'for /f "tokens=5" %a in (\'netstat -aon ^| findstr ":301[0-9] " ^| findstr LISTENING\') do taskkill /PID %a /F 2>nul',
              cwd: devPath,
            }).catch(() => {});

            // Wait for port to be released
            await new Promise((r) => setTimeout(r, 2000));
            if (isStale()) return;

            setStatusMessage(`Starting ${det.framework} dev server...`);
          }

          port = await invoke<number>("start_dev_server", {
            command: det.devCommand,
            cwd: devPath,
            portPattern: det.portPattern.source,
          });
          lastErr = null;
          break; // Success — exit retry loop
        } catch (err: any) {
          lastErr = err;
          const errStr = err?.toString?.() || "";
          if (!errStr.includes("EADDRINUSE") && !errStr.includes("address already in use")) {
            break; // Not a port conflict — don't retry
          }
        }
      }

      if (lastErr) throw lastErr;

      if (isStale()) return;
      console.log("[preview] Dev server reported port:", port);

      // 6. Wait for initial compilation
      setStatusMessage(`Waiting for ${det.framework} to compile...`);
      await new Promise((r) => setTimeout(r, 3000));
      if (isStale()) return;

      // 7. Set up proxy server for element selection support
      console.log("[preview] Setting up proxy server for dev server on port", port);
      setDevServerPort(port);
      await invoke("set_preview_proxy", { targetPort: port }).catch(() => {});
      try {
        const proxyPort = await invoke<number>("start_preview_server", { path: devPath });
        proxyServerPortRef.current = proxyPort;
        console.log("[preview] Proxy server ready on port", proxyPort);
      } catch (proxyErr) {
        console.warn("[preview] Proxy server failed to start (element selection won't work):", proxyErr);
        proxyServerPortRef.current = null;
      }

      // 8. Show the preview — iframe points directly to dev server (HMR works)
      console.log("[preview] Showing iframe on port", port);
      setServerPort(port);
      setPreviewStatus("dev-running");
      setStatusMessage("");
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      if (!isStale()) {
        console.error("[preview] startDevServer error:", err);
        setPreviewStatus("error");
        setStatusMessage(err.toString());
      }
    }
  };

  // ── Re-detect helper (used after AI finishes, retry, etc.) ──

  const reDetectAndSwitch = async () => {
    if (!projectPath) return;
    const fresh = await detectProjectType(projectPath);
    setDetection(fresh);
    switch (fresh.type) {
      case "static":
        setPreviewStatus("static");
        try {
          const port = await invoke<number>("start_preview_server", { path: fresh.resolvedPath || projectPath });
          setServerPort(port);
          setRefreshKey((k) => k + 1);
          setStatusMessage("");
        } catch (err: any) {
          setPreviewStatus("error");
          setStatusMessage(err.toString());
        }
        break;
      case "framework":
        if (fresh.needsInstall) {
          setPreviewStatus("needs-install");
          setStatusMessage(`This ${fresh.framework} project needs dependencies installed.`);
        } else {
          await startDevServer(fresh);
        }
        break;
      case "non-web":
        setPreviewStatus("non-web");
        break;
      case "native-app":
        if (fresh.needsInstall) {
          setPreviewStatus("needs-install");
          setStatusMessage(`This ${fresh.framework} project needs dependencies installed.`);
        } else {
          setPreviewStatus("native-app");
          setNativeOutput("");
          setNativeRunning(false);
        }
        break;
    }
  };

  const handleInstallDependencies = async () => {
    if (!projectPath || !detection || !detection.installCommand) return;
    const installPath = detection.resolvedPath || projectPath;

    // Re-verify the project marker still exists — AI may have changed the project
    // For npm projects check package.json, for others check their own marker
    const markerFile = getProjectMarkerFile(detection.framework);
    if (markerFile) {
      try {
        const sep = installPath.includes("/") ? "/" : "\\";
        await invoke("read_file", { path: `${installPath}${sep}${markerFile}` });
      } catch {
        // Marker gone — re-run detection instead of installing
        console.log(`[preview] ${markerFile} missing before install, re-detecting...`);
        await reDetectAndSwitch();
        return;
      }
    }

    setPreviewStatus("installing");
    setStatusMessage(`Running ${detection.installCommand}...`);
    setInstallOutput("");
    setInstallElapsed(0);

    // Start elapsed time counter so user knows it's working
    if (installTimerRef.current) clearInterval(installTimerRef.current);
    installTimerRef.current = setInterval(() => {
      setInstallElapsed((s) => s + 1);
    }, 1000);

    const stopTimer = () => {
      if (installTimerRef.current) {
        clearInterval(installTimerRef.current);
        installTimerRef.current = null;
      }
    };

    try {
      // 10-minute timeout — npm install should never take longer than this
      const TIMEOUT_MS = 10 * 60 * 1000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(
            `Install timed out after 10 minutes.\n\nTry running "${detection.installCommand}" manually in the terminal below.`
          )),
          TIMEOUT_MS
        )
      );

      const installPromise = invoke<{ stdout: string; stderr: string; exit_code: number }>("execute_command", {
        command: detection.installCommand,
        cwd: installPath,
      });

      const result = await Promise.race([installPromise, timeoutPromise]);
      stopTimer();

      if (result.exit_code !== 0) {
        // Install failed
        const output = (result.stderr || result.stdout || "Unknown error").trim();
        setPreviewStatus("error");
        setStatusMessage("Install failed");
        setInstallOutput(output);
        return;
      }

      // Install succeeded — refresh file tree and proceed
      try {
        const files = await readDirectory(projectPath, 3);
        setFileTree(files);
      } catch { /* non-critical */ }

      // Update detection — no longer needs install
      const updatedDetection = { ...detection, needsInstall: false };
      setDetection(updatedDetection);

      // For web frameworks → start dev server; for native apps → show status panel
      if (updatedDetection.type === "native-app") {
        setPreviewStatus("native-app");
        setNativeOutput("");
        setNativeRunning(false);
      } else {
        await startDevServer(updatedDetection);
      }
    } catch (err: any) {
      stopTimer();
      setPreviewStatus("error");
      setStatusMessage(err.message || err.toString());
    }
  };

  const handleRetry = async () => {
    setInstallOutput("");
    // Always re-detect from scratch — project may have changed
    await reDetectAndSwitch();
  };

  // ── Native app management ───────────────────────────────────

  /** Map framework name to the file we check before installing */
  const getProjectMarkerFile = (framework: string | null): string | null => {
    switch (framework) {
      case "Next.js": case "Nuxt": case "SvelteKit": case "Svelte":
      case "Astro": case "Vite": case "Create React App": case "Angular":
      case "Vue": case "Expo": case "Tauri": case "Electron":
      case "React Native":
        return "package.json";
      case "Flutter Web": case "Flutter":
        return "pubspec.yaml";
      case "Django":
        return "manage.py";
      case "FastAPI": case "Flask": case "Python":
        return "requirements.txt";
      case ".NET":
        return null; // *.csproj varies, skip marker check
      case "Rails":
        return "Gemfile";
      case "Laravel":
        return "composer.json";
      case "Go":
        return "go.mod";
      case "Rust":
        return "Cargo.toml";
      default:
        return "package.json";
    }
  };

  const nativeOutputRef = useRef<HTMLPreElement>(null);

  /** Run a native app process and stream output to the panel */
  const handleRunNativeApp = async () => {
    if (!detection || !detection.devCommand || !projectPath) return;
    const runPath = detection.resolvedPath || projectPath;

    setNativeRunning(true);
    setNativeOutput("");
    setPreviewStatus("native-running");

    try {
      const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>("execute_command", {
        command: detection.devCommand,
        cwd: runPath,
      });

      const output = [
        result.stdout ? result.stdout.trim() : "",
        result.stderr ? result.stderr.trim() : "",
      ].filter(Boolean).join("\n");

      setNativeOutput(output || `Process exited with code ${result.exit_code}`);
      setNativeRunning(false);
      setPreviewStatus("native-app");
    } catch (err: any) {
      setNativeOutput((prev) => prev + "\n" + err.toString());
      setNativeRunning(false);
      setPreviewStatus("native-app");
    }
  };

  /** Stop the native app process (kills the dev server process which is reused) */
  const handleStopNativeApp = async () => {
    try {
      await invoke("stop_dev_server").catch(() => {});
    } catch { /* ignore */ }
    setNativeRunning(false);
    setPreviewStatus("native-app");
    setNativeOutput((prev) => prev + "\n— Process stopped —");
  };

  // Auto-scroll native output to bottom
  useEffect(() => {
    if (nativeOutputRef.current) {
      nativeOutputRef.current.scrollTop = nativeOutputRef.current.scrollHeight;
    }
  }, [nativeOutput]);

  // ── Load file content ──────────────────────────────────────

  useEffect(() => {
    const loadFile = async () => {
      if (!selectedFile || selectedFile.is_dir) {
        setFileContent(null);
        setImageSrc(null);
        return;
      }

      if (isImageFile) {
        const assetUrl = convertFileSrc(selectedFile.path);
        setImageSrc(assetUrl);
        setFileContent(null);
        return;
      }

      setLoading(true);
      setError(null);
      setImageSrc(null);

      try {
        const content = await readFile(selectedFile.path);
        setFileContent(content);
      } catch (err: any) {
        setError(err.message || "Failed to load file");
        setFileContent(null);
      } finally {
        setLoading(false);
      }
    };

    loadFile();
  }, [selectedFile, isImageFile, fileTree]);

  // ── Handlers ───────────────────────────────────────────────

  const handleCopy = async () => {
    const content = isEditing ? editContent : fileContent;
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const handleRefresh = () => {
    if (previewMode === "live") {
      setRefreshKey((k) => k + 1);
    }
  };

  const handleOpenInBrowser = async () => {
    try {
      if (previewMode === "live" && serverPort) {
        await openUrl(`http://localhost:${serverPort}`);
      } else if (selectedFile && serverPort) {
        await openUrl(`http://localhost:${serverPort}/${selectedFile.name}`);
      }
    } catch (err) {
      console.error("Failed to open in browser:", err);
    }
  };

  const handleSwitchToLive = () => {
    setPreviewMode("live");
    setIsEditing(false);
  };

  const handleCloseFile = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedFile(null);
    setPreviewMode("live");
    setIsEditing(false);
    setFileContent(null);
    setImageSrc(null);
    setError(null);
  };

  // ── Edit handlers ──────────────────────────────────────────

  const handleStartEdit = () => {
    if (!fileContent) return;
    setEditContent(fileContent);
    setIsEditing(true);
    // Focus textarea after render
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditContent("");
    setShowConflict(false);
  };

  // ── Conflict resolution handlers ──────────────────────────

  const handleKeepMine = () => {
    // User wants to keep their in-editor version — just dismiss the prompt
    setShowConflict(false);
  };

  const handleLoadExternal = async () => {
    // User wants to load the new version from disk
    if (!selectedFile) return;
    try {
      const content = await readFile(selectedFile.path);
      setFileContent(content);
      setEditContent(content);
      setShowConflict(false);
    } catch (err: any) {
      console.error("Failed to load external version:", err);
    }
  };

  const handleSave = async () => {
    if (!selectedFile || !projectPath || saving) return;
    setSaving(true);
    setShowConflict(false);

    try {
      await writeFile(selectedFile.path, editContent);
      setFileContent(editContent);
      setIsEditing(false);

      // Refresh file tree to catch any new files
      try {
        const files = await readDirectory(projectPath, 3);
        setFileTree(files);
      } catch {
        // Non-critical
      }

      // Update manifest
      if (manifest) {
        const relativePath = getRelativePath(projectPath, selectedFile.path);
        const updatedManifest = updateManifestEntry(manifest, relativePath, editContent);
        setManifest(updatedManifest);
      }
    } catch (err: any) {
      console.error("Failed to save:", err);
      setError(`Failed to save: ${err.message || err}`);
    } finally {
      setSaving(false);
    }
  };

  // Handle keyboard shortcuts in editor
  const handleEditorKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
    // Escape to cancel
    if (e.key === "Escape") {
      handleCancelEdit();
    }
    // Tab inserts spaces instead of changing focus
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const newValue = editContent.substring(0, start) + "  " + editContent.substring(end);
      setEditContent(newValue);
      // Restore cursor position after React re-renders
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  // Check if content has been modified
  const hasChanges = isEditing && editContent !== fileContent;

  // Whether the live preview iframe should be shown
  const showIframe = previewMode === "live" && serverPort && (previewStatus === "static" || previewStatus === "dev-running");

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className={`flex flex-col h-full min-w-0 ${t.colors.bg}`}>
      {/* Header */}
      <div className={`h-12 px-3 flex justify-between items-center flex-shrink-0 ${t.colors.bgSecondary}`}>
        {/* Left: Mode tabs */}
        <div className="flex items-center gap-1 min-w-0">
          {/* Live Preview tab */}
          <button
            onClick={handleSwitchToLive}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium ${t.borderRadius} transition-colors ${
              previewMode === "live"
                ? `${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"}`
                : `${t.colors.textMuted} hover:${t.colors.text}`
            }`}
            title="Live website preview"
          >
            <Globe size={13} />
            Live
            {/* Show framework badge */}
            {detection?.framework && (
              <span className={`text-[10px] opacity-70`}>({detection.framework})</span>
            )}
          </button>

          {/* File View tab */}
          {selectedFile && !selectedFile.is_dir && (
            <div
              className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium ${t.borderRadius} transition-colors max-w-[180px] ${
                previewMode === "file"
                  ? `${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"}`
                  : `${t.colors.textMuted} hover:${t.colors.text}`
              }`}
              title={selectedFile.name}
            >
              <button
                onClick={() => setPreviewMode("file")}
                className="flex items-center gap-1.5 min-w-0"
              >
                <FileCode size={13} className="flex-shrink-0" />
                <span className="truncate">{selectedFile.name}</span>
              </button>
              <button
                onClick={handleCloseFile}
                className={`flex-shrink-0 ml-0.5 p-0.5 rounded transition-colors ${
                  previewMode === "file"
                    ? `${theme === "highContrast" ? "hover:bg-black/20" : "hover:bg-white/20"}`
                    : `hover:${t.colors.bgTertiary}`
                }`}
                title="Close file"
              >
                <X size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Right: Action buttons */}
        <div className="flex items-center gap-1 flex-shrink-0">

          {/* ── File mode buttons ── */}
          {previewMode === "file" && fileContent !== null && !isImageFile && (
            <>
              {isEditing ? (
                <>
                  {/* Save button */}
                  <div className="relative">
                    <button
                      onClick={handleSave}
                      disabled={saving || !hasChanges}
                      onMouseEnter={() => setTooltip("save")}
                      onMouseLeave={() => setTooltip(null)}
                      className={`p-2 ${t.borderRadius} flex items-center gap-1 text-xs font-medium transition-colors ${
                        hasChanges
                          ? "bg-green-600 hover:bg-green-700 text-white"
                          : `${t.colors.bgTertiary} ${t.colors.textMuted}`
                      } ${saving ? "opacity-50" : ""}`}
                    >
                      <Save size={14} />
                    </button>
                    {tooltip === "save" && (
                      <div className={`absolute right-0 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                        {saving ? "Saving..." : hasChanges ? "Save (Ctrl+S)" : "No changes"}
                      </div>
                    )}
                  </div>

                  {/* Cancel edit button */}
                  <div className="relative">
                    <button
                      onClick={handleCancelEdit}
                      onMouseEnter={() => setTooltip("cancel")}
                      onMouseLeave={() => setTooltip(null)}
                      className={`${t.colors.bgTertiary} hover:opacity-80 p-2 ${t.borderRadius} ${t.colors.text}`}
                    >
                      <X size={15} />
                    </button>
                    {tooltip === "cancel" && (
                      <div className={`absolute right-0 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                        Cancel editing (Esc)
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <>
                  {/* Edit button */}
                  <div className="relative">
                    <button
                      onClick={handleStartEdit}
                      onMouseEnter={() => setTooltip("edit")}
                      onMouseLeave={() => setTooltip(null)}
                      className={`${t.colors.bgTertiary} hover:opacity-80 p-2 ${t.borderRadius} ${t.colors.text}`}
                    >
                      <Pencil size={15} />
                    </button>
                    {tooltip === "edit" && (
                      <div className={`absolute right-0 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                        Edit file
                      </div>
                    )}
                  </div>

                  {/* Copy button */}
                  <div className="relative">
                    <button
                      onClick={handleCopy}
                      onMouseEnter={() => setTooltip("copy")}
                      onMouseLeave={() => setTooltip(null)}
                      className={`${t.colors.bgTertiary} hover:opacity-80 p-2 ${t.borderRadius} ${copied ? "text-green-500" : t.colors.text}`}
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                    {tooltip === "copy" && (
                      <div className={`absolute right-0 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                        {copied ? "Copied!" : "Copy to clipboard"}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Live mode buttons ── */}
          {previewMode === "live" && serverPort && (
            <>
              {/* Element select mode toggle */}
              <div className="relative">
                <button
                  onClick={() => {
                    const next = !selectMode;
                    setSelectMode(next);
                    if (!next) clearSelection();
                  }}
                  onMouseEnter={() => setTooltip("select")}
                  onMouseLeave={() => setTooltip(null)}
                  className={`p-2 ${t.borderRadius} transition-colors ${
                    selectMode
                      ? "bg-[#2DB87A] text-white"
                      : `${t.colors.bgTertiary} ${t.colors.text} hover:opacity-80`
                  }`}
                >
                  <MousePointer size={15} />
                </button>
                {tooltip === "select" && (
                  <div className={`absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                    {selectMode ? "Exit select mode" : "Select an element"}
                  </div>
                )}
              </div>

              {/* Viewport size switcher */}
              <div className={`flex items-center ${t.borderRadius} overflow-hidden border ${t.colors.border}`}>
                {(Object.entries(VIEWPORT_PRESETS) as [ViewportSize, typeof VIEWPORT_PRESETS[ViewportSize]][]).filter(([key]) => !isMobileApp || key === "mobile").map(([key, preset]) => {
                  const Icon = preset.icon;
                  const isActive = viewportSize === key;
                  return (
                    <div className="relative" key={key}>
                      <button
                        onClick={() => setViewportSize(key)}
                        onMouseEnter={() => setTooltip(`viewport-${key}`)}
                        onMouseLeave={() => setTooltip(null)}
                        className={`p-1.5 transition-colors ${
                          isActive
                            ? `${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"}`
                            : `${t.colors.bgTertiary} ${t.colors.textMuted} hover:${t.colors.text}`
                        }`}
                      >
                        <Icon size={14} />
                      </button>
                      {tooltip === `viewport-${key}` && (
                        <div className={`absolute left-1/2 -translate-x-1/2 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                          {preset.label}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="relative">
                <button
                  onClick={handleRefresh}
                  onMouseEnter={() => setTooltip("refresh")}
                  onMouseLeave={() => setTooltip(null)}
                  className={`${t.colors.bgTertiary} hover:opacity-80 p-2 ${t.borderRadius} ${t.colors.text}`}
                >
                  <RefreshCw size={15} />
                </button>
                {tooltip === "refresh" && (
                  <div className={`absolute right-0 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                    Refresh preview
                  </div>
                )}
              </div>
            </>
          )}

          {/* Open in Browser - always available when server is running */}
          {serverPort && (
            <div className="relative">
              <button
                onClick={handleOpenInBrowser}
                onMouseEnter={() => setTooltip("browser")}
                onMouseLeave={() => setTooltip(null)}
                className={`${t.colors.bgTertiary} hover:opacity-80 p-2 ${t.borderRadius} ${t.colors.text}`}
              >
                <ExternalLink size={15} />
              </button>
              {tooltip === "browser" && (
                <div className={`absolute right-0 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                  Open in Browser
                </div>
              )}
            </div>
          )}

          {/* Deploy button — direct deploy to Vercel / Netlify / Cloudflare */}
          {canDeploy && (
            <>
              <div className="relative">
                <button
                  onClick={handleDeploy}
                  onMouseEnter={() => setTooltip("deploy")}
                  onMouseLeave={() => setTooltip(null)}
                  className={`${t.colors.bgTertiary} hover:opacity-80 p-2 ${t.borderRadius} ${t.colors.text}`}
                >
                  <Rocket size={15} />
                </button>
                {tooltip === "deploy" && (
                  <div className={`absolute right-0 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                    {savedTarget
                      ? `Deploy to ${savedTarget.domain || savedTarget.remoteProjectName}`
                      : "Deploy"}
                  </div>
                )}
              </div>

              {/* Change target — only shown when a target is already saved */}
              {savedTarget && (
                <div className="relative">
                  <button
                    onClick={handleChangeTarget}
                    onMouseEnter={() => setTooltip("deploy-settings")}
                    onMouseLeave={() => setTooltip(null)}
                    className={`${t.colors.bgTertiary} hover:opacity-80 p-2 ${t.borderRadius} ${t.colors.textMuted}`}
                  >
                    <Settings size={14} />
                  </button>
                  {tooltip === "deploy-settings" && (
                    <div className={`absolute right-0 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                      Change deploy target
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Close preview */}
          <div className="relative">
            <button
              onClick={onClose}
              onMouseEnter={() => setTooltip("close")}
              onMouseLeave={() => setTooltip(null)}
              className={`${t.colors.bgTertiary} hover:opacity-80 p-2 ${t.borderRadius} ${t.colors.text}`}
            >
              <PanelRightClose size={15} />
            </button>
            {tooltip === "close" && (
              <div className={`absolute right-0 top-full mt-1 px-2 py-1 text-xs whitespace-nowrap ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} shadow-lg z-50`}>
                Close Preview
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Unsaved changes indicator */}
      {isEditing && hasChanges && !showConflict && (
        <div className={`px-3 py-1 text-xs ${t.colors.bgTertiary} border-b ${t.colors.border} flex items-center gap-2`}>
          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
          <span className={t.colors.textMuted}>Unsaved changes — Ctrl+S to save, Esc to cancel</span>
        </div>
      )}

      {/* External change conflict prompt */}
      {showConflict && (
        <div className={`px-3 py-2 text-xs border-b ${t.colors.border} flex items-center justify-between gap-2`} style={{ background: "rgba(234, 179, 8, 0.1)" }}>
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-500 flex-shrink-0" />
            <span className={t.colors.text}>
              This file was changed outside the app. Keep your version or load the new one?
            </span>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={handleKeepMine}
              className={`px-2.5 py-1 text-xs font-medium ${t.colors.bgTertiary} ${t.colors.text} ${t.borderRadius} hover:opacity-80`}
            >
              Keep mine
            </button>
            <button
              onClick={handleLoadExternal}
              className={`px-2.5 py-1 text-xs font-medium ${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"} ${t.borderRadius} hover:opacity-80`}
            >
              Load new version
            </button>
          </div>
        </div>
      )}

      {/* Content area */}
      <div className={`flex-1 overflow-auto min-h-0 ${t.colors.bg} select-text`}>

        {/* ── LIVE PREVIEW MODE ── */}
        {previewMode === "live" && (
          <>
            {/* Detecting project type */}
            {previewStatus === "detecting" && (
              <div className={`flex flex-col items-center justify-center h-full gap-2 ${t.colors.textMuted}`}>
                <RefreshCw size={20} className="animate-spin" />
                <p className="text-sm">{statusMessage || "Detecting project type..."}</p>
              </div>
            )}

            {/* Static server starting */}
            {previewStatus === "static" && !serverPort && (
              <div className={`flex flex-col items-center justify-center h-full gap-2 ${t.colors.textMuted}`}>
                <RefreshCw size={20} className="animate-spin" />
                <p className="text-sm">Starting preview server...</p>
              </div>
            )}

            {/* Framework: needs install */}
            {previewStatus === "needs-install" && detection && (
              <div className={`flex flex-col items-center justify-center h-full gap-4 p-6 ${t.colors.textMuted}`}>
                <Download size={32} className="opacity-50" />
                <div className="text-center max-w-sm">
                  <p className={`text-sm font-medium ${t.colors.text} mb-1`}>
                    {detection.framework} project detected
                  </p>
                  <p className="text-sm">
                    {statusMessage}
                  </p>
                  <p className="text-xs mt-1 opacity-70">
                    This will run <code className={`px-1.5 py-0.5 ${t.colors.bgTertiary} ${t.borderRadius}`}>{detection.installCommand}</code>
                  </p>
                </div>
                <button
                  onClick={handleInstallDependencies}
                  className={`px-4 py-2 text-sm font-medium ${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"} ${t.borderRadius} flex items-center gap-2`}
                >
                  <Download size={14} />
                  Install Dependencies
                </button>
              </div>
            )}

            {/* Framework: installing dependencies */}
            {previewStatus === "installing" && (
              <div className={`flex flex-col items-center justify-center h-full gap-4 p-6 ${t.colors.textMuted}`}>
                <RefreshCw size={24} className="animate-spin" />
                <div className="text-center max-w-xs">
                  <p className={`text-sm font-medium ${t.colors.text}`}>Installing dependencies...</p>
                  <p className="text-xs mt-1">{statusMessage}</p>
                  {/* Elapsed time — reassures user it's actively running */}
                  <p className={`text-xs mt-2 font-mono ${t.colors.textMuted}`}>
                    {Math.floor(installElapsed / 60) > 0
                      ? `${Math.floor(installElapsed / 60)}m ${installElapsed % 60}s elapsed`
                      : `${installElapsed}s elapsed`}
                  </p>
                  <p className="text-xs mt-2 opacity-60">
                    First install can take 3–5 minutes — packages are downloading.
                  </p>
                  <p className="text-xs mt-1 opacity-50">
                    You can watch progress in the terminal below.
                  </p>
                </div>
              </div>
            )}

            {/* Framework: starting dev server */}
            {previewStatus === "starting-dev" && (
              <div className={`flex flex-col items-center justify-center h-full gap-2 ${t.colors.textMuted}`}>
                <RefreshCw size={20} className="animate-spin" />
                <p className="text-sm">{statusMessage || "Starting dev server..."}</p>
              </div>
            )}

            {/* Native app — ready to run (not yet running) */}
            {previewStatus === "native-app" && (
              <div className={`flex flex-col h-full ${t.colors.textMuted}`}>
                {/* Header */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${t.colors.border}`}>
                  <div className="flex items-center gap-2">
                    <Terminal size={16} />
                    <span className={`text-sm font-medium ${t.colors.text}`}>
                      {detection?.framework || "Native App"}
                    </span>
                  </div>
                  <button
                    onClick={handleRunNativeApp}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm ${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"} ${t.borderRadius}`}
                  >
                    <Play size={14} />
                    Run
                  </button>
                </div>
                {/* Info + previous output */}
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-6">
                  {isMobileApp ? (
                    /* Mobile app: show phone mockup with placeholder screen */
                    <PhoneMockup theme={theme} t={t}>
                      <div className="flex flex-col items-center justify-center h-full gap-3 p-6" style={{ background: "#f5f5f7" }}>
                        <Smartphone size={32} className="opacity-30" style={{ color: "#1C1C1E" }} />
                        <div className="text-center">
                          <p className="text-sm font-medium mb-1" style={{ color: "#1C1C1E" }}>
                            {detection?.framework} App
                          </p>
                          <p className="text-xs" style={{ color: "#86868B" }}>
                            Click Run to launch on device or emulator
                          </p>
                        </div>
                      </div>
                    </PhoneMockup>
                  ) : (
                    /* Non-mobile native app: original layout */
                    <>
                      <Terminal size={32} className="opacity-50" />
                      <div className="text-center max-w-xs">
                        <p className={`text-sm font-medium ${t.colors.text} mb-2`}>
                          {detection?.framework} project detected
                        </p>
                        <p className="text-xs mb-1">
                          Run command: <code className={`px-1.5 py-0.5 ${t.colors.bgTertiary} ${t.borderRadius} text-xs`}>{detection?.devCommand}</code>
                        </p>
                        <p className="text-xs opacity-70 mt-3">
                          This app opens in its own window. Click Run to start it, or ask the AI to run it for you.
                        </p>
                      </div>
                      {/* Show previous output if any */}
                      {nativeOutput && (
                        <pre
                          ref={nativeOutputRef}
                          className={`text-xs w-full max-h-48 overflow-auto p-3 mt-2 ${t.colors.bgTertiary} ${t.borderRadius} ${t.colors.textMuted}`}
                          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                        >
                          {nativeOutput}
                        </pre>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Native app — currently running */}
            {previewStatus === "native-running" && (
              <div className={`flex flex-col h-full ${t.colors.textMuted}`}>
                {/* Header */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${t.colors.border}`}>
                  <div className="flex items-center gap-2">
                    <Loader size={16} className="animate-spin" />
                    <span className={`text-sm font-medium ${t.colors.text}`}>
                      {detection?.framework || "Native App"} — Running
                    </span>
                  </div>
                  <button
                    onClick={handleStopNativeApp}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-600 text-white ${t.borderRadius}`}
                  >
                    <Square size={14} />
                    Stop
                  </button>
                </div>
                {/* Live output — wrap in phone mockup for mobile apps */}
                {isMobileApp ? (
                  <div className="flex-1 min-h-0 overflow-auto">
                    <PhoneMockup theme={theme} t={t}>
                      <pre
                        ref={nativeOutputRef}
                        className="h-full overflow-auto p-3 text-xs"
                        style={{
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          background: "#1C1C1E",
                          color: "#98989D",
                        }}
                      >
                        {nativeOutput || "Starting process..."}
                      </pre>
                    </PhoneMockup>
                  </div>
                ) : (
                  <pre
                    ref={nativeOutputRef}
                    className={`flex-1 overflow-auto p-4 text-xs ${t.colors.bg} ${t.colors.textMuted}`}
                    style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                  >
                    {nativeOutput || "Starting process..."}
                  </pre>
                )}
              </div>
            )}

            {/* Non-web project (no framework detected at all) */}
            {previewStatus === "non-web" && (
              <div className={`flex flex-col items-center justify-center h-full gap-3 p-6 ${t.colors.textMuted}`}>
                <Terminal size={32} className="opacity-50" />
                <div className="text-center max-w-xs">
                  <p className={`text-sm font-medium ${t.colors.text} mb-2`}>
                    No preview available
                  </p>
                  <p className="text-sm">
                    Run it from the terminal below, or ask the AI to run it for you.
                  </p>
                </div>
              </div>
            )}

            {/* Error state */}
            {previewStatus === "error" && (
              <div className="flex flex-col items-center justify-center h-full gap-3 p-4">
                <AlertCircle size={24} className="text-red-500" />
                <p className="text-red-500 text-sm text-center max-w-sm">{statusMessage}</p>
                {installOutput && (
                  <pre
                    className={`text-xs max-w-full overflow-auto max-h-40 p-3 ${t.colors.bgTertiary} ${t.borderRadius} ${t.colors.textMuted} w-full`}
                    style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}
                  >
                    {installOutput}
                  </pre>
                )}
                <button
                  onClick={handleRetry}
                  className={`px-3 py-1.5 text-sm ${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"} ${t.borderRadius}`}
                >
                  Retry
                </button>
              </div>
            )}

            {/* No project open */}
            {!projectPath && (
              <div className={`flex flex-col items-center justify-center h-full ${t.colors.textMuted} ${t.fontFamily}`}>
                <Globe size={32} className="mb-3 opacity-50" />
                <p>No project open</p>
                <p className="text-sm mt-1">Open a project to see live preview</p>
              </div>
            )}

            {/* Live iframe — shown for both static and dev-running, with AI building overlay */}
            {showIframe && (
              <div className="relative w-full h-full">
                {viewportSize === "desktop" ? (
                  /* Desktop: full-width iframe */
                  <iframe
                    ref={iframeRef}
                    key={refreshKey}
                    src={`http://localhost:${serverPort}?_r=${refreshKey}`}
                    className="w-full h-full border-0 bg-white"
                    title="Live Preview"
                  />
                ) : viewportSize === "mobile" && isMobileApp ? (
                  /* Mobile app detected + mobile viewport: phone mockup frame */
                  <PhoneMockup theme={theme} t={t}>
                    <iframe
                      ref={iframeRef}
                      key={refreshKey}
                      src={`http://localhost:${serverPort}?_r=${refreshKey}`}
                      className="w-full h-full border-0"
                      title="Live Preview"
                      style={{ background: "#fff" }}
                    />
                  </PhoneMockup>
                ) : (
                  /* Tablet / Mobile (non-mobile-app): constrained iframe centered with device chrome */
                  <div className={`flex flex-col items-center h-full py-4 px-2 overflow-auto ${t.colors.bgSecondary}`}>
                    {/* Viewport width label */}
                    <div className={`text-xs mb-2 ${t.colors.textMuted} flex items-center gap-1.5`}>
                      {viewportSize === "tablet" ? <Tablet size={12} /> : <Smartphone size={12} />}
                      {VIEWPORT_PRESETS[viewportSize].label}
                    </div>
                    {/* Device frame */}
                    <div
                      className={`relative flex-1 min-h-0 border ${t.colors.border} ${t.borderRadius} overflow-hidden shadow-lg`}
                      style={{
                        width: `${VIEWPORT_PRESETS[viewportSize].width}px`,
                        maxWidth: "100%",
                      }}
                    >
                      <iframe
                        ref={iframeRef}
                        key={refreshKey}
                        src={`http://localhost:${serverPort}?_r=${refreshKey}`}
                        className="border-0 bg-white"
                        title="Live Preview"
                        style={{
                          width: `${VIEWPORT_PRESETS[viewportSize].width}px`,
                          height: "100%",
                        }}
                      />
                    </div>
                  </div>
                )}
                {aiIsLoading && (
                  <div className={`absolute inset-0 flex flex-col items-center justify-center z-10 ${t.colors.bg}`} style={{ opacity: 0.97 }}>
                    <Loader size={28} className={`animate-spin mb-3 ${t.colors.textMuted}`} />
                    <p className={`text-sm font-medium ${t.colors.text}`}>
                      AI is building your project...
                    </p>
                    <p className={`text-xs mt-1.5 ${t.colors.textMuted}`}>
                      Preview will update when ready
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── FILE VIEW MODE ── */}
        {previewMode === "file" && (
          <>
            {loading ? (
              <div className={`flex items-center justify-center h-full ${t.colors.textMuted}`}>
                Loading...
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full text-red-500 p-4">
                {error}
              </div>
            ) : !selectedFile ? (
              <div className={`flex flex-col items-center justify-center h-full ${t.colors.textMuted} ${t.fontFamily}`}>
                <p>No file selected</p>
                <p className="text-sm mt-2">Click a file to view its code</p>
              </div>
            ) : selectedFile.is_dir ? (
              <div className={`flex items-center justify-center h-full ${t.colors.textMuted}`}>
                Select a file to view
              </div>
            ) : isImageFile && imageSrc ? (
              <div className="flex items-center justify-center h-full p-4 overflow-auto">
                <img
                  src={imageSrc}
                  alt={selectedFile.name}
                  className="max-w-full max-h-full object-contain"
                  onError={() => {
                    console.error("Image failed to load:", imageSrc);
                    setError("Failed to load image");
                  }}
                />
              </div>
            ) : isEditing ? (
              /* ── Editable code view ── */
              <textarea
                ref={textareaRef}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                spellCheck={false}
                className={`w-full h-full p-4 text-sm resize-none border-0 outline-none ${t.colors.bg} ${t.colors.text}`}
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  tabSize: 2,
                  lineHeight: "1.6",
                }}
              />
            ) : fileContent ? (
              /* ── Read-only code view ── */
              <pre
                className={`p-4 text-sm h-full ${t.colors.text} whitespace-pre-wrap break-all`}
                style={{
                  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                  lineHeight: "1.6",
                }}
              >
                <code>{fileContent}</code>
              </pre>
            ) : null}
          </>
        )}
      </div>

      {/* Element selection floating action bar */}
      {selectMode && selectedElements.length > 0 && (
        <FloatingActionBar iframeRect={iframeRect} />
      )}

      {/* Deploy target picker — shown on first deploy, or when user clicks the gear */}
      {pickerOpen && currentProject && (
        <DeployTargetPicker
          omniProjectId={currentProject.id}
          omniProjectName={currentProject.name || 'omnirun-project'}
          availableProviders={connectedDeployProviders}
          onConfirm={(target) => {
            setPickerOpen(false);
            if (!currentProject) return;
            setDeployTarget(currentProject.id, target);
            // Defer one tick so the target is fully committed to the store
            // before deployProject reads it back.
            setTimeout(() => runDeploy(), 0);
          }}
          onCancel={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

export default PreviewArea;