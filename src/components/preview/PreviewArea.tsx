import { ExternalLink, PanelRightClose, FileCode, Copy, Check, Globe, RefreshCw, Pencil, Save, X, Download, Terminal, AlertCircle, Loader } from "lucide-react";
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

interface PreviewAreaProps {
  onClose: () => void;
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".ico"];

// Preview states for the universal preview system
type PreviewStatus =
  | "detecting"        // Checking project type
  | "static"           // Using axum static server
  | "needs-install"    // Framework project missing node_modules
  | "installing"       // Running npm/yarn/pnpm install
  | "starting-dev"     // Dev server is spinning up
  | "dev-running"      // Dev server is running, iframe loaded
  | "non-web"          // Not a web project
  | "error";           // Something went wrong

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
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Universal preview state
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>("detecting");
  const [detection, setDetection] = useState<ProjectDetection | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [installOutput, setInstallOutput] = useState<string>("");

  const { theme } = useSettingsStore();
  const { selectedFile, projectPath, fileTree, setFileTree, manifest, setManifest, setBuildError, autoFixCount, resetAutoFix, externalFileChange, setExternalFileChange } = useProjectStore();
  const { isLoading: aiIsLoading } = useChatStore();
  const prevAiLoadingRef = useRef(false);
  const [errorPollTrigger, setErrorPollTrigger] = useState(0);
  const previewVersionRef = useRef(0);
  const t = themes[theme];

  const isImageFile = selectedFile ? IMAGE_EXTENSIONS.some(ext =>
    selectedFile.name.toLowerCase().endsWith(ext)
  ) : false;

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
                await new Promise((r) => setTimeout(r, 2000));
              }
              if (previewVersionRef.current !== thisVersion) return;
              const port = await invoke<number>("start_preview_server", { path: projectPath });
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
      if (previewStatus !== "dev-running" && previewStatus !== "installing") {
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

  // ── Dev server management ─────────────────────────────────

  const startDevServer = async (det: ProjectDetection, oldPort: number | null = null, version: number = 0) => {
    if (!projectPath || !det.devCommand || !det.portPattern) return;

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
        const sep = projectPath.includes("/") ? "/" : "\\";
        // Windows: find and kill processes using ports 3000-3010
        await invoke("execute_command", {
          command: 'for /f "tokens=5" %a in (\'netstat -aon ^| findstr ":300[0-9] " ^| findstr LISTENING\') do taskkill /PID %a /F 2>nul',
          cwd: projectPath,
        }).catch(() => {});

        // 4. Clean framework lock files that prevent restart
        //    Next.js: .next/dev/lock — left behind when process is force-killed
        if (det.framework === "Next.js") {
          const lockPath = `${projectPath}${sep}.next${sep}dev${sep}lock`;
          await invoke("delete_path", { path: lockPath }).catch(() => {});
          console.log("[preview] Cleaned .next/dev/lock");
        }
      } catch {
        // Non-critical — continue even if cleanup fails
      }

      if (isStale()) return;

      // 5. Start the new dev server
      console.log("[preview] Starting dev server:", det.devCommand);
      setStatusMessage(`Starting ${det.framework} dev server...`);

      const port = await invoke<number>("start_dev_server", {
        command: det.devCommand,
        cwd: projectPath,
        portPattern: det.portPattern.source,
      });

      if (isStale()) return;
      console.log("[preview] Dev server reported port:", port);

      // 6. Wait for initial compilation
      setStatusMessage(`Waiting for ${det.framework} to compile...`);
      await new Promise((r) => setTimeout(r, 3000));
      if (isStale()) return;

      // 7. Show the preview
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
          const port = await invoke<number>("start_preview_server", { path: projectPath });
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
    }
  };

  const handleInstallDependencies = async () => {
    if (!projectPath || !detection || !detection.installCommand) return;

    // Re-verify package.json still exists — AI may have changed the project
    try {
      const pkgPath = projectPath.includes("/")
        ? `${projectPath}/package.json`
        : `${projectPath}\\package.json`;
      await invoke("read_file", { path: pkgPath });
    } catch {
      // package.json gone — re-run detection instead of installing
      console.log("[preview] package.json missing before install, re-detecting...");
      await reDetectAndSwitch();
      return;
    }

    setPreviewStatus("installing");
    setStatusMessage(`Running ${detection.installCommand}...`);
    setInstallOutput("");

    try {
      const result = await invoke<{ stdout: string; stderr: string; exit_code: number }>("execute_command", {
        command: detection.installCommand,
        cwd: projectPath,
      });

      if (result.exit_code !== 0) {
        // Install failed
        const output = (result.stderr || result.stdout || "Unknown error").trim();
        setPreviewStatus("error");
        setStatusMessage("Install failed");
        setInstallOutput(output);
        return;
      }

      // Install succeeded — refresh file tree (node_modules appeared) and start dev server
      try {
        const files = await readDirectory(projectPath, 3);
        setFileTree(files);
      } catch { /* non-critical */ }

      // Update detection — no longer needs install
      const updatedDetection = { ...detection, needsInstall: false };
      setDetection(updatedDetection);

      await startDevServer(updatedDetection);
    } catch (err: any) {
      setPreviewStatus("error");
      setStatusMessage(err.toString());
    }
  };

  const handleRetry = async () => {
    setInstallOutput("");
    // Always re-detect from scratch — project may have changed
    await reDetectAndSwitch();
  };

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
    // User wants the version from disk — reload the file
    if (!selectedFile) return;
    try {
      const content = await readFile(selectedFile.path);
      setFileContent(content);
      setEditContent(content);
    } catch (err) {
      console.error("Failed to reload file:", err);
    }
    setShowConflict(false);
  };

  const handleSave = async () => {
    if (!selectedFile || !projectPath || saving) return;

    setSaving(true);
    try {
      await writeFile(selectedFile.path, editContent);

      // Update local state with saved content
      setFileContent(editContent);
      setIsEditing(false);

      // Refresh file tree
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
            <button
              onClick={() => setPreviewMode("file")}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium ${t.borderRadius} transition-colors truncate max-w-[160px] ${
                previewMode === "file"
                  ? `${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"}`
                  : `${t.colors.textMuted} hover:${t.colors.text}`
              }`}
              title={selectedFile.name}
            >
              <FileCode size={13} className="flex-shrink-0" />
              <span className="truncate">{selectedFile.name}</span>
            </button>
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
              <div className={`flex flex-col items-center justify-center h-full gap-3 p-6 ${t.colors.textMuted}`}>
                <RefreshCw size={24} className="animate-spin" />
                <div className="text-center">
                  <p className={`text-sm font-medium ${t.colors.text}`}>Installing dependencies...</p>
                  <p className="text-xs mt-1">{statusMessage}</p>
                  <p className="text-xs mt-2 opacity-60">This may take a minute</p>
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

            {/* Non-web project */}
            {previewStatus === "non-web" && (
              <div className={`flex flex-col items-center justify-center h-full gap-3 p-6 ${t.colors.textMuted}`}>
                <Terminal size={32} className="opacity-50" />
                <div className="text-center max-w-xs">
                  <p className={`text-sm font-medium ${t.colors.text} mb-2`}>
                    No web preview available
                  </p>
                  <p className="text-sm">
                    This project doesn't have a web preview. Run it from the terminal below, or ask the AI to run it for you.
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
                <iframe
                  ref={iframeRef}
                  key={refreshKey}
                  src={`http://localhost:${serverPort}?_r=${refreshKey}`}
                  className="w-full h-full border-0 bg-white"
                  title="Live Preview"
                />
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
    </div>
  );
}

export default PreviewArea;