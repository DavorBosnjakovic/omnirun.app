import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, Trash2, Wrench, Pencil, Coins, X, Image, MessageSquarePlus, Globe, AlertCircle, ChevronDown, FileText, Paperclip } from "lucide-react";
import elipseDark from "../../assets/elipse_transparent_dark.svg";
import elipseLight from "../../assets/elipse_transparent_light.svg";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../../stores/settingsStore";
import { useChatStore } from "../../stores/chatStore";
import { useProjectStore } from "../../stores/projectStore";
import { useChatHistoryStore } from "../../stores/chatHistoryStore";
import { useUsageStore } from "../../stores/usageStore";
import { themes } from "../../config/themes";
import MarkdownRenderer from "./MarkdownRenderer";
import { sendMessage } from "../../services/aiService";
import { writeFile, readDirectory } from "../../services/fileService";
import { updateManifestEntry, getRelativePath } from "../../services/manifestService";
import { parseToolCalls, executeToolCalls, formatToolResults, generateToolSummary, generateResultSummary } from "../../services/toolService";
import { initContext, loadContext, saveContext, addRecentChange, compressSession, contextToPromptString, type ProjectContext as ContextData, type ProviderConfig } from "../../services/contextService";
import { extractObservations } from "../../services/memoryService";
import { useAuthStore } from "../../stores/authStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { getErrors, clearErrors, onErrorsChange } from "../../services/errorCapture";
import { useDiffStore } from "../../stores/diffStore";
import { useElementSelectionStore } from "../../stores/elementSelectionStore";
import DiffViewer from "../diff/DiffViewer";
import OmnirunSpinner from "./OmnirunSpinner";
import type { MessageImage } from "../../stores/chatStore";

const MAX_TOOL_ITERATIONS = 10;


// ── Collapsible tool action display ────────────────────────────
// Shows a compact one-liner per action (e.g. "Edited: styles.css").
// Details like "(replaced 145 chars with 138 chars)" and stdout
// are hidden behind a dropdown arrow to keep the chat clean.

function ToolActionLine({ content, theme: t, themeKey, mode }: {
  content: string;
  theme: any;
  themeKey: string;
  mode: "simple" | "technical";
}) {
  const [expanded, setExpanded] = useState(false);

  const separatorIdx = content.indexOf("\n---\n");
  const summary = separatorIdx !== -1 ? content.slice(0, separatorIdx) : content;
  const technicalDetails = separatorIdx !== -1 ? content.slice(separatorIdx + 5) : null;
  const summaryLines = summary.split("\n").filter(l => l.trim());

  // Parse each line into a clean label + optional detail string
  const parsed = summaryLines.map((line) => {
    const clean = line.replace(/^[\s🔧✏️✅❌⏭️🔍⚠️📁📂🗑️⏳]+/u, "").trim();

    // "Written path/to/file.css (123 chars)" → label: "Written: file.css", detail: "(123 chars)"
    const writeMatch = clean.match(/^(Writ(?:ing|ten))\s+(.+?)(\s+\(.+\))?$/i);
    if (writeMatch) {
      const verb = /^written/i.test(writeMatch[1]) ? "Written" : "Writing";
      const file = writeMatch[2].split(/[/\\]/).pop() || writeMatch[2];
      return { label: `${verb}: ${file}`, detail: writeMatch[3]?.trim() || null, raw: clean };
    }

    // "Edited styles.css (replaced 145 chars with 138 chars)" → label: "Edited: styles.css", detail: "(replaced...)"
    const editMatch = clean.match(/^(Edit(?:ing|ed))[:\s]+(.+?)(\s+\(.+\))?$/i);
    if (editMatch) {
      const verb = /^edited/i.test(editMatch[1]) ? "Edited" : "Editing";
      const file = editMatch[2].split(/[/\\]/).pop() || editMatch[2];
      return { label: `${verb}: ${file}`, detail: editMatch[3]?.trim() || null, raw: clean };
    }

    // "Reading path/to/file.css" → label: "Reading: file.css"
    const readMatch = clean.match(/^(Read(?:ing)?)\s+(.+?)$/i);
    if (readMatch) {
      const file = readMatch[2].split(/[/\\]/).pop() || readMatch[2];
      return { label: `Reading: ${file}`, detail: null, raw: clean };
    }

    // "Deleted path/to/file.css" → label: "Deleted: file.css"
    const deleteMatch = clean.match(/^(Delet(?:ing|ed))\s+(.+?)$/i);
    if (deleteMatch) {
      const file = deleteMatch[2].split(/[/\\]/).pop() || deleteMatch[2];
      return { label: `Deleted: ${file}`, detail: null, raw: clean };
    }

    // "Listed path/to/dir" → label: "Scanning: dir"
    const listMatch = clean.match(/^(List(?:ing|ed)?)\s+(.+?)$/i);
    if (listMatch) {
      const dir = listMatch[2].split(/[/\\]/).pop() || listMatch[2];
      return { label: `Scanning: ${dir}`, detail: null, raw: clean };
    }

    // "Created directory: path/to/dir" → label: "Created: dir"
    const mkdirMatch = clean.match(/^Created\s+(?:directory:?\s+)?(.+?)$/i);
    if (mkdirMatch) {
      const dir = mkdirMatch[1].split(/[/\\]/).pop() || mkdirMatch[1];
      return { label: `Created: ${dir}`, detail: null, raw: clean };
    }

    // "Running: npm install" → label: "Running command", detail: "npm install"
    const runMatch = clean.match(/^Running:\s*(.+)$/i);
    if (runMatch) return { label: "Running command", detail: runMatch[1], raw: clean };

    // "Searching: query" → label: "Searching the web", detail: "query"
    const searchMatch = clean.match(/^Search(?:ing)?:\s*(.+)$/i);
    if (searchMatch) return { label: "Searching the web", detail: searchMatch[1], raw: clean };

    // "Creating scheduled task: name" → label: "Creating task", detail: "name"
    const taskMatch = clean.match(/^Creating scheduled task:\s*(.+)$/i);
    if (taskMatch) return { label: "Creating task", detail: taskMatch[1], raw: clean };

    // Context saves
    if (clean.toLowerCase().includes("context")) return { label: "Saving context", detail: null, raw: clean };

    // stdout/stderr lines → always detail
    if (/^stdout:|^stderr:/i.test(clean)) return { label: null, detail: clean, raw: clean };

    // "Found X results" etc.
    if (clean.toLowerCase().includes("found")) return { label: clean, detail: null, raw: clean };

    // Done
    if (!clean || clean === "Done") return { label: "Done", detail: null, raw: clean };

    // Fallback — show truncated
    return { label: clean.length > 60 ? clean.slice(0, 57) + "…" : clean, detail: null, raw: clean };
  });

  // Deduplicate consecutive identical labels
  const deduped = parsed.filter((a, i) => i === 0 || a.label !== parsed[i - 1]?.label);

  // Collect all detail strings for the dropdown
  const allDetails = deduped
    .filter((a) => a.detail)
    .map((a) => a.label ? `${a.label} ${a.detail}` : a.detail!);

  // Also include technical details (after ---) if present
  if (technicalDetails) {
    allDetails.push(technicalDetails);
  }

  const hasDetails = allDetails.length > 0;

  // Only show items that have a label (stdout-only lines go to details)
  const visibleLines = deduped.filter((a) => a.label);

  return (
    <div className="space-y-0.5">
      {visibleLines.map((action, i) => (
        <div key={i} className="leading-snug text-sm">{action.label}</div>
      ))}
      {hasDetails && (
        <>
          <button
            onClick={() => setExpanded(!expanded)}
            className={`inline-flex items-center gap-1 mt-0.5 text-xs ${t.colors.textMuted} hover:${t.colors.text} transition-colors cursor-pointer`}
          >
            <ChevronDown
              size={10}
              className={`transition-transform duration-150 ${expanded ? "" : "-rotate-90"}`}
            />
            {expanded ? "Less" : "Details"}
          </button>
          {expanded && (
            <pre className={`mt-1 text-xs ${t.colors.textMuted} whitespace-pre-wrap opacity-70 max-h-[200px] overflow-y-auto`}>
              {allDetails.join("\n")}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

// Allowed image types
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

// Allowed text/document file extensions Claude can read
const ALLOWED_TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "html", "htm", "csv", "json", "xml",
  "pdf", "js", "jsx", "ts", "tsx", "css", "scss", "sass", "py", "rb",
  "java", "c", "cpp", "h", "go", "rs", "php", "sh", "bash", "yaml", "yml",
  "toml", "ini", "env", "sql", "graphql", "vue", "svelte", "astro",
]);

const isAllowedTextFile = (file: File | string): boolean => {
  const name = typeof file === "string" ? file : file.name;
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return ALLOWED_TEXT_EXTENSIONS.has(ext);
};

function ChatArea({ onSettingsClick, pendingMessage, onPendingMessageConsumed }: {
  onSettingsClick?: (tab: string) => void;
  pendingMessage?: string | null;
  onPendingMessageConsumed?: () => void;
}) {
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const [pendingTextFiles, setPendingTextFiles] = useState<{ id: string; name: string; content: string }[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showContinue, setShowContinue] = useState(false);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [isRouting, setIsRouting] = useState(false);
  const [consoleErrors, setConsoleErrors] = useState<string[]>(() => getErrors());
  const [projectContextData, setProjectContextData] = useState<ContextData | null>(null);
  const stoppedRef = useRef(false);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  // Typewriter effect refs — buffer incoming content, reveal gradually
  const typewriterTargetRef = useRef("");
  const typewriterRevealedRef = useRef(0);
  const typewriterRafRef = useRef<number | null>(null);
  const typewriterMsgIdRef = useRef<string | null>(null);
  // ✅ FIX: destructure smartRouting so the header can reflect it
  const { theme, timeFormat, mode, smartRouting, fontSize } = useSettingsStore();
  const { messages, isLoading, addMessage, setLoading, clearMessages } = useChatStore();
  const { currentProject, projectPath, fileTree, selectedFile, setFileTree, manifest, setManifest, buildError, autoFixCount, setBuildError, incrementAutoFix, resetAutoFix } = useProjectStore();
  const { saveConversation, currentChatId, setCurrentChatId } = useChatHistoryStore();
  const { session, trackAPICall } = useUsageStore();
  const { requestApproval, clear: clearDiffs } = useDiffStore();
  const t = themes[theme];

  // ── User avatar ────────────────────────────────────────────
  const { user, profile } = useAuthStore();
  const [avatarError, setAvatarError] = useState(false);
  const avatarUrl = profile?.avatar_url || null;
  const showAvatar = avatarUrl && !avatarError;

  useEffect(() => {
    setAvatarError(false);
  }, [profile?.avatar_url]);

  // ── Element selection: auto-send to AI (with optional reference image) ──
  const { pendingChatInput, setPendingChatInput, pendingImage, setPendingImage } = useElementSelectionStore();
  const elementMsgRef = useRef<string | null>(null);
  const elementImgRef = useRef<{ base64: string; mimeType: string } | null>(null);
  const [elementSendTrigger, setElementSendTrigger] = useState(0);

  useEffect(() => {
    if (pendingChatInput) {
      elementMsgRef.current = pendingChatInput;
      elementImgRef.current = pendingImage || null;
      setPendingChatInput(null);
      setPendingImage(null);
      setElementSendTrigger((n) => n + 1);
    }
  }, [pendingChatInput]);

  const getInitials = () => {
    const name = user?.displayName || profile?.display_name || user?.email || '';
    if (!name) return '?';
    const parts = name.split(/[\s@]+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0][0].toUpperCase();
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Subscribe to console errors from errorCapture service
  useEffect(() => {
    return onErrorsChange((errors) => setConsoleErrors(errors));
  }, []);

  // Cleanup typewriter animation on unmount
  useEffect(() => {
    return () => {
      if (typewriterRafRef.current !== null) {
        cancelAnimationFrame(typewriterRafRef.current);
      }
    };
  }, []);

  // Load project connections from DB when project changes
  useEffect(() => {
    if (currentProject?.id) {
      useConnectionsStore.getState().loadProjectConnectionsFromDB(currentProject.id);
    }
  }, [currentProject?.id]);

  // Scroll to bottom when a diff approval appears
  const pendingDiff = useDiffStore((s) => s.pendingDiff);
  useEffect(() => {
    if (pendingDiff) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [pendingDiff]);

  // Load existing project context from disk when project changes.
  // If no context.md exists yet, leave null — full scan runs on first message send
  // when the provider/API key is guaranteed to be available.
  useEffect(() => {
    if (!projectPath) {
      setProjectContextData(null);
      return;
    }

    const load = async () => {
      await invoke("set_project_path", { path: projectPath });
      const existing = await loadContext(projectPath);
      setProjectContextData(existing);
    };

    load().catch((e) => console.error("Failed to load context:", e));
  }, [projectPath]);

  // ── Auto-send pending message (from Tasks page suggestions) ──
  const lastPendingRef = useRef<string | null>(null);
  useEffect(() => {
    if (pendingMessage && !isLoading && pendingMessage !== lastPendingRef.current) {
      lastPendingRef.current = pendingMessage;
      handleSend(pendingMessage);
      onPendingMessageConsumed?.();
    }
  }, [pendingMessage]);

  // ── Auto-fix build errors from dev server ──────────────────
  const autoFixingRef = useRef(false);

  useEffect(() => {
    if (!buildError || isLoading || autoFixingRef.current) return;

    // If we've hit the cap, show a message asking the user instead of auto-sending
    if (autoFixCount >= 3) {
      addMessage({
        id: `autofix-cap-${Date.now()}`,
        role: "assistant",
        content: `⚠️ Still seeing build errors after ${autoFixCount} auto-fix attempts:\n\n\`\`\`\n${buildError.slice(0, 500)}\n\`\`\`\n\nWant me to keep trying? Send a message like "Yes, fix it" to continue.`,
        timestamp: new Date(),
      });
      setBuildError(null);
      return;
    }

    // Auto-send the error to the AI
    autoFixingRef.current = true;
    setIsAutoFixing(true);
    incrementAutoFix();

    const errorMessage = `Build error from the dev server:\n\n\`\`\`\n${buildError}\n\`\`\`\n\nPlease fix this error.`;

    // Clear the error so we don't re-trigger
    setBuildError(null);

    // Small delay so the UI can update
    setTimeout(() => {
      handleSend(errorMessage).finally(() => {
        autoFixingRef.current = false;
        setIsAutoFixing(false);
      });
    }, 300);
  }, [buildError, isLoading]);

  const formatCost = (cost: number) => {
    if (cost < 0.01) return "<$0.01";
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  // ─── Image helpers ────────────────────────────────────────────────

  const fileToMessageImage = useCallback((file: File): Promise<MessageImage | null> => {
    return new Promise((resolve) => {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        if (base64) {
          resolve({
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            base64,
            mimeType: file.type,
            name: file.name,
          });
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  }, []);

  const blobToMessageImage = useCallback((blob: Blob, mimeType?: string): Promise<MessageImage | null> => {
    return new Promise((resolve) => {
      const type = mimeType || blob.type;
      if (!ALLOWED_IMAGE_TYPES.includes(type)) {
        resolve(null);
        return;
      }

      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.split(",")[1];
        if (base64) {
          resolve({
            id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            base64,
            mimeType: type,
            name: "screenshot.png",
          });
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  }, []);

  const addImages = useCallback(async (files: File[]) => {
    const results = await Promise.all(files.map(fileToMessageImage));
    const valid = results.filter((r): r is MessageImage => r !== null);
    if (valid.length > 0) {
      setPendingImages((prev) => [...prev, ...valid]);
    }
  }, [fileToMessageImage]);

  const removeImage = useCallback((id: string) => {
    setPendingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  // ─── Paste handler (works anywhere in the chat area) ──────────────

  const handlePaste = useCallback(async (e: React.ClipboardEvent | ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageItems: DataTransferItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        imageItems.push(items[i]);
      }
    }

    if (imageItems.length === 0) return;

    e.preventDefault();

    for (const item of imageItems) {
      const blob = item.getAsFile();
      if (blob) {
        const img = await blobToMessageImage(blob, item.type);
        if (img) {
          setPendingImages((prev) => [...prev, img]);
        }
      }
    }

    inputRef.current?.focus();
  }, [blobToMessageImage]);

  // ─── Drag & drop handlers ────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer?.types.includes("Files")) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    const files = Array.from(e.dataTransfer?.files || []);
    const imageFiles = files.filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type));
    const textFiles = files.filter((f) => !ALLOWED_IMAGE_TYPES.includes(f.type) && isAllowedTextFile(f));

    if (imageFiles.length > 0) {
      await addImages(imageFiles);
    }

    if (textFiles.length > 0) {
      const newFiles = await Promise.all(
        textFiles.map(async (f) => ({
          id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          content: await f.text(),
        }))
      );
      setPendingTextFiles((prev) => [...prev, ...newFiles]);
    }

    if (imageFiles.length > 0 || textFiles.length > 0) {
      inputRef.current?.focus();
    }
  }, [addImages]);

  // ─── Tauri native file drop listener ────────────────────────────────────
  // Browser drag events (onDragEnter/onDrop) are intercepted by Tauri at the
  // OS level and never reach React. We must use Tauri's own file drop API.

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setup = async () => {
      try {
        const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const appWindow = getCurrentWebviewWindow();

        unlisten = await appWindow.onDragDropEvent(async (event) => {
          const type = event.payload.type;

          if (type === "over") {
            dragCounterRef.current = 1;
            setIsDragging(true);
          } else if (type === "leave" || type === "cancel") {
            dragCounterRef.current = 0;
            setIsDragging(false);
          } else if (type === "drop") {
            dragCounterRef.current = 0;
            setIsDragging(false);

            const paths: string[] = (event.payload as any).paths || [];
            if (paths.length === 0) return;

            // ── Text/document files ──────────────────────────────────────────
            const textPaths = paths.filter((p) => isAllowedTextFile(p));
            if (textPaths.length > 0) {
              const { readTextFile } = await import("@tauri-apps/plugin-fs");
              const newFiles = await Promise.all(
                textPaths.map(async (p) => {
                  const name = p.split(/[/\\]/).pop() || p;
                  const content = await readTextFile(p);
                  return { id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, name, content };
                })
              );
              setPendingTextFiles((prev) => [...prev, ...newFiles]);
            }

            // ── Image files ─────────────────────────────────────────
            const imgExtMap: Record<string, string> = {
              png: "image/png",
              jpg: "image/jpeg",
              jpeg: "image/jpeg",
              gif: "image/gif",
              webp: "image/webp",
            };
            const imgPaths = paths.filter((p) => {
              const ext = p.split(".").pop()?.toLowerCase() || "";
              return ext in imgExtMap;
            });
            if (imgPaths.length > 0) {
              const { readFile } = await import("@tauri-apps/plugin-fs");
              const imgs: MessageImage[] = [];
              for (const p of imgPaths) {
                const ext = p.split(".").pop()?.toLowerCase() || "";
                const mimeType = imgExtMap[ext] || "image/png";
                const bytes = await readFile(p);
                const base64 = btoa(
                  Array.from(bytes).map((b) => String.fromCharCode(b)).join("")
                );
                imgs.push({
                  id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  base64,
                  mimeType,
                  name: p.split(/[/\\]/).pop() || p,
                });
              }
              if (imgs.length > 0) setPendingImages((prev) => [...prev, ...imgs]);
            }

            inputRef.current?.focus();
          }
        });
      } catch {
        // Not in Tauri — browser drag events handle it instead
      }
    };

    setup();
    return () => unlisten?.();
  }, []);

  // ─── Global paste listener (so Ctrl+V works even without input focus) ──

  useEffect(() => {
    const listener = (e: ClipboardEvent) => {
      if (document.activeElement === inputRef.current) return;
      handlePaste(e as any);
    };
    document.addEventListener("paste", listener);
    return () => document.removeEventListener("paste", listener);
  }, [handlePaste]);

  // ─── Provider helpers ─────────────────────────────────────────────

  const getActiveProvider = () => {
    const activeProviderId = localStorage.getItem("ai-active-provider") || "anthropic";
    const savedProviders = localStorage.getItem("ai-providers");
    
    if (!savedProviders) return null;

    const providers = JSON.parse(savedProviders);
    const config = providers.find((p: any) => p.providerId === activeProviderId);
    
    if (!config || !config.apiKey) return null;

    return {
      id: activeProviderId,
      apiKey: config.apiKey,
      model: config.selectedModel,
    };
  };

  const getActiveProviderDisplay = () => {
    const activeProviderId = localStorage.getItem("ai-active-provider") || "anthropic";
    const savedProviders = localStorage.getItem("ai-providers");
    
    if (!savedProviders) return "No provider";

    const providers = JSON.parse(savedProviders);
    const config = providers.find((p: any) => p.providerId === activeProviderId);
    
    if (!config) return "No provider";

    const providerNames: Record<string, string> = {
      anthropic: "Claude",
      groq: "Groq",
      openai: "OpenAI",
      google: "Gemini",
      ollama: "Ollama",
    };

    const name = providerNames[activeProviderId] || activeProviderId;

    // ✅ FIX: when smart routing is active, show that label instead of the
    // static stored model — the actual model varies per-request at runtime
    if (activeProviderId === "anthropic" && smartRouting) {
      return `${name} • Smart Routing ⚡`;
    }

    const model = config.selectedModel?.split("-").slice(0, 2).join(" ") || "";
    return `${name} • ${model}`;
  };

  const handleStop = () => {
    stoppedRef.current = true;
    if (readerRef.current) {
      readerRef.current.cancel().catch(() => {});
      readerRef.current = null;
    }
    setLoading(false);
  };

  const handleContinue = () => {
    setShowContinue(false);
    handleSend("Continue where you left off.");
  };

  const handleFixConsoleErrors = () => {
    const errors = getErrors();
    if (!errors.length) return;
    clearErrors();
    const errorText = errors.slice(0, 10).join("\n\n");
    handleSend(`Fix these console errors I'm seeing in the app:\n\n\`\`\`\n${errorText}\n\`\`\``);
  };

  // Extract a human-readable action label from partial <tool_call> content
  const describeToolCall = (partial: string): string => {
    const nameMatch = partial.match(/"name"\s*:\s*"([^"]+)"/);
    const toolName = nameMatch?.[1];
    const pathMatch = partial.match(/"path"\s*:\s*"([^"]+)"/);
    const filePath = pathMatch?.[1];
    const fileName = filePath ? filePath.split(/[/\\]/).pop() : null;
    const queryMatch = partial.match(/"query"\s*:\s*"([^"]+)"/);

    if (!toolName) return "⏳ Working...";

    const labels: Record<string, string> = {
      edit_file:      fileName ? `✏️ Editing ${fileName}...`   : "✏️ Editing file...",
      create_file:    fileName ? `📝 Creating ${fileName}...`  : "📝 Creating file...",
      read_file:      fileName ? `📖 Reading ${fileName}...`   : "📖 Reading file...",
      delete_file:    fileName ? `🗑️ Deleting ${fileName}...`  : "🗑️ Deleting file...",
      list_directory: "📂 Listing directory...",
      web_search:     queryMatch?.[1] ? `🔍 Searching: ${queryMatch[1]}...` : "🔍 Searching the web...",
      write_context:  "💾 Saving context...",
    };

    return labels[toolName] ?? `⏳ ${toolName.replace(/_/g, " ")}...`;
  };

  // Collapse incomplete code blocks and tool calls during streaming
  const getStreamingDisplay = (content: string): string => {
    // Normalize <function_calls> → <tool_call> so one code path handles both
    const c = content
      .replace(/<function_calls>\s*/g, "<tool_call>")
      .replace(/<\/function_calls>/g, "</tool_call>");

    // Unclosed <tool_call> — show ONLY the action label, never the AI's chatter
    const openCallTag = c.lastIndexOf("<tool_call>");
    const closeCallTag = c.lastIndexOf("</tool_call>");
    if (openCallTag !== -1 && (closeCallTag === -1 || closeCallTag < openCallTag)) {
      return describeToolCall(c.slice(openCallTag));
    }

    // Unclosed <tool_result> — show ONLY the action label
    const openResultTag = c.lastIndexOf("<tool_result>");
    const closeResultTag = c.lastIndexOf("</tool_result>");
    if (openResultTag !== -1 && (closeResultTag === -1 || closeResultTag < openResultTag)) {
      const lastCall = c.slice(0, openResultTag).match(/<tool_call>([\s\S]*?)<\/tool_call>/g);
      return lastCall?.length ? describeToolCall(lastCall[lastCall.length - 1]) : "⏳ Working...";
    }

    // Strip all completed tool blocks (well-formed + malformed + orphaned)
    const clean = c
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
      .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, "")
      .replace(/<[^>]*tool_?call[^>]*>[\s\S]*?<\/[^>]*tool_?call[^>]*>/g, "")
      .replace(/<[^>]*tool_?result[^>]*>[\s\S]*?<\/[^>]*tool_?result[^>]*>/g, "")
      .replace(/\{"name"?\s*:\s*"(?:write_file|read_file|edit_file|list_directory|create_directory|delete_file|read_multiple_files|run_command|web_search|write_context|create_scheduled_task|connection)"[\s\S]*?\}\s*/g, "")
      .replace(/<\/tool_call>/g, "")
      .replace(/<\/tool_result>/g, "")
      .trim();

    // Count backtick fences
    const fences = clean.match(/```/g);
    if (!fences || fences.length % 2 === 0) return clean;

    // Unclosed code block
    const originalBeforeFence = c.slice(0, c.lastIndexOf("```"));
    return originalBeforeFence + "```\n⏳ Writing code...\n```";
  };

  // ── Typewriter effect ─────────────────────────────────────────
  // Buffers streamed content and reveals it gradually for a smooth
  // reading experience. API still streams at full speed internally.
  const CHARS_PER_FRAME = 3; // ~180 chars/sec at 60fps

  const startTypewriter = (msgId: string) => {
    typewriterMsgIdRef.current = msgId;
    typewriterTargetRef.current = "";
    typewriterRevealedRef.current = 0;

    const tick = () => {
      const target = typewriterTargetRef.current;
      const revealed = typewriterRevealedRef.current;

      if (revealed < target.length) {
        // Reveal next batch of characters
        const newRevealed = Math.min(revealed + CHARS_PER_FRAME, target.length);
        typewriterRevealedRef.current = newRevealed;

        const visibleContent = target.slice(0, newRevealed);
        const id = typewriterMsgIdRef.current;
        if (id) {
          useChatStore.setState((state) => ({
            messages: state.messages.map((m) =>
              m.id === id ? { ...m, content: visibleContent } : m
            ),
          }));
        }
      }

      typewriterRafRef.current = requestAnimationFrame(tick);
    };

    typewriterRafRef.current = requestAnimationFrame(tick);
  };

  const updateTypewriterTarget = (content: string) => {
    typewriterTargetRef.current = content;
  };

  const flushTypewriter = () => {
    // Stop the animation loop
    if (typewriterRafRef.current !== null) {
      cancelAnimationFrame(typewriterRafRef.current);
      typewriterRafRef.current = null;
    }

    // Show all remaining content immediately
    const id = typewriterMsgIdRef.current;
    const target = typewriterTargetRef.current;
    if (id && target) {
      typewriterRevealedRef.current = target.length;
      useChatStore.setState((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, content: target } : m
        ),
      }));
    }

    typewriterMsgIdRef.current = null;
  };

  const handleSend = async (overrideMessage?: string) => {
    const messageText = overrideMessage || input.trim();
    if ((!messageText && pendingImages.length === 0 && pendingTextFiles.length === 0) || isLoading) return;

    // Reset auto-fix counter when user sends a manual message (not auto-fix)
    if (!overrideMessage) {
      resetAutoFix();
    }

    setShowContinue(false);

    const textFileAppend = pendingTextFiles.length > 0
      ? "\n\n" + pendingTextFiles.map((f) => `**${f.name}:**\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n")
      : "";
    const userMessage = (messageText || "") + textFileAppend;
    const userImages = pendingImages.length > 0 ? [...pendingImages] : undefined;
    setInput("");
    setPendingImages([]);
    setPendingTextFiles([]);
    
    addMessage({
      id: Date.now().toString(),
      role: "user",
      content: userMessage,
      timestamp: new Date(),
      images: userImages,
    });

    setLoading(true);
    stoppedRef.current = false;

    try {
      const provider = getActiveProvider();

      if (!provider) {
        throw new Error("No API key configured. Go to Settings → API Keys to add one and set it as active.");
      }

      // Build project context (lean — no file tree, AI explores with tools)
      // If no context exists yet (first open), scan now — provider is guaranteed available here.
      let currentContext = projectContextData;
      if (!currentContext && projectPath) {
        try {
          const { context: ctx } = await initContext(projectPath, undefined, provider);
          currentContext = ctx;
          setProjectContextData(ctx);
        } catch (e) {
          console.error("Failed to scan project:", e);
        }
      }

      let projectContext = undefined;
      if (projectPath) {
        projectContext = {
          path: projectPath,
          manifest: manifest,
          contextString: currentContext ? contextToPromptString(currentContext) : undefined,
        };
      }

      // Build conversation history (include images)
      const existingMessages = messages
        .filter((m) => m.content && m.content.trim() !== "" && m.content !== "Thinking...")
        .map((m) => ({ 
          role: m.role as "user" | "assistant", 
          content: m.content,
          images: m.images,
        }));
      
      let apiMessages = [
        ...existingMessages,
        { role: "user" as const, content: userMessage, images: userImages }
      ];

      // ── Tool execution loop ──────────────────────────────
      let iterations = 0;
      let currentManifest = manifest;

      while (iterations < MAX_TOOL_ITERATIONS) {
        iterations++;

        // Check if stopped
        if (stoppedRef.current) break;

        // Create assistant message placeholder
        const assistantId = (Date.now() + iterations).toString();
        addMessage({
          id: assistantId,
          role: "assistant",
          content: "",
          timestamp: new Date(),
        });

        // Stream the AI response
        let fullResponse = "";

        // Don't show streaming text — keep the message empty (spinner shows).
        // Content is revealed all at once when streaming completes.

        setIsRouting(true);
        const result = await sendMessage(apiMessages, provider, (chunk) => {
          setIsRouting(false);
          if (stoppedRef.current) return;
          fullResponse += chunk;
        }, projectContext, undefined, (reader) => { readerRef.current = reader; });

        setIsRouting(false);
        fullResponse = result.text;

        // Reveal the full response at once (no typewriter)
        const displayContent = getStreamingDisplay(fullResponse);
        useChatStore.setState((state) => ({
          messages: state.messages.map((m) =>
            m.id === assistantId ? { ...m, content: displayContent } : m
          ),
        }));

        // Check if stopped during streaming
        if (stoppedRef.current) break;

        // Track usage for this API call
        if (result.usage.inputTokens > 0 || result.usage.outputTokens > 0) {
          trackAPICall({
            model: result.model || provider.model,
            provider: provider.id,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cacheCreationTokens: result.usage.cacheCreationTokens,
            cacheReadTokens: result.usage.cacheReadTokens,
            source: 'project',
            projectName: currentProject?.name ?? null,
          });
        }

        // If no response came through streaming, try getting it from a non-streaming call
        if (!fullResponse) {
          const fallbackResult = await sendMessage(apiMessages, provider, undefined, projectContext);
          fullResponse = fallbackResult.text;

          // Track usage for fallback call
          if (fallbackResult.usage.inputTokens > 0 || fallbackResult.usage.outputTokens > 0) {
            trackAPICall({
              model: fallbackResult.model || provider.model,
              provider: provider.id,
              inputTokens: fallbackResult.usage.inputTokens,
              outputTokens: fallbackResult.usage.outputTokens,
              cacheCreationTokens: fallbackResult.usage.cacheCreationTokens,
              cacheReadTokens: fallbackResult.usage.cacheReadTokens,
              source: 'project',
              projectName: currentProject?.name ?? null,
            });
          }

          useChatStore.setState((state) => ({
            messages: state.messages.map((m) =>
              m.id === assistantId ? { ...m, content: getStreamingDisplay(fullResponse) } : m
            ),
          }));
        }

        // Check if stopped during fallback
        if (stoppedRef.current) break;

        // Check for tool calls in the response
        const parsed = parseToolCalls(fullResponse);

        if (!parsed.hasToolCalls) {
          // No tool calls — we're done
          break;
        }

        // Delete the assistant's narration bubble — the tool status bubble is enough
        useChatStore.setState((state) => ({
          messages: state.messages.filter((m) => m.id !== assistantId),
        }));

        // Can't execute tools without a project path
        if (!projectPath) break;

        // ── Execute tool calls ──────────────────────────────

        const hasSearch = parsed.toolCalls.some((tc) => tc.name === "web_search");
        const actionSummaries = parsed.toolCalls
          .map((tc) => `${hasSearch && tc.name === "web_search" ? "🔍" : "✏️"} ${generateToolSummary(tc)}`)
          .join("\n");

        // Add a tool execution status message
        const toolStatusId = (Date.now() + iterations + 1000).toString();
        addMessage({
          id: toolStatusId,
          role: "assistant",
          content: hasSearch ? `🔍 ${actionSummaries}` : `🔧 ${actionSummaries}`,
          timestamp: new Date(),
        });

        // Check if stopped before executing tools
        if (stoppedRef.current) break;

        // Execute the tools
        const { results, updatedManifest, filesChanged, updatedContext } = await executeToolCalls(
          parsed.toolCalls,
          projectPath,
          currentManifest,
          requestApproval,
          currentContext
        );

        currentManifest = updatedManifest;

        // Update manifest in store if changed
        if (updatedManifest) {
          setManifest(updatedManifest);
        }

        // Update context if write_context tool was used
        if (updatedContext) {
          currentContext = updatedContext;
          setProjectContextData(updatedContext);
          // Save to disk
          saveContext(projectPath, updatedContext).catch(() => {});
        }

        // Refresh file tree if files were changed
        if (filesChanged.length > 0) {
          try {
            const files = await readDirectory(projectPath, 3);
            setFileTree(files);
          } catch {
            // Non-critical, continue
          }

          // Update context with recent changes
          if (currentContext) {
            let ctx = updatedContext || currentContext;
            for (const f of filesChanged) {
              const action = parsed.toolCalls.find(tc => {
                const p = tc.arguments.path || tc.arguments.paths?.[0];
                return p === f;
              });
              const verb = action?.name === "delete_file" ? "Deleted" : action?.name === "edit_file" ? "Edited" : "Updated";
              ctx = addRecentChange(ctx, `${verb} ${f}`);
            }
            currentContext = ctx;
            setProjectContextData(ctx);
            saveContext(projectPath, ctx).catch(() => {});
          }
        }

        // Update tool status message with results
        const resultSummaries = results
          .map((r) => {
            if (r.tool === "web_search") {
              // Parse the AI-formatted result back into a chat-friendly format
              if (r.result.startsWith("Web search error:") || r.result.includes("returned no results")) {
                return `🔍 ${r.result}`;
              }
              // Extract URLs from the result for clickable display
              const urls: string[] = [];
              const lines = r.result.split("\n");
              let queryLine = lines[0] || "";
              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
                  urls.push(trimmed);
                }
              }
              return `🔍 ${queryLine}${urls.length > 0 ? "\n" + urls.map((u, i) => `  ${i + 1}. ${u}`).join("\n") : ""}`;
            }
            const icon = r.success ? "✅" : "❌";
            return `${icon} ${generateResultSummary(r)}`;
          })
          .join("\n");

        // Full details for Technical mode expand
        const fullDetails = results
          .map((r) => `[${r.tool}] ${r.result.split("\n").slice(0, 5).join("\n")}`)
          .join("\n\n");

        // Use 🔍 prefix if any search results, 🔧 otherwise
        // The prefix MUST be preserved so isToolMessage() keeps detecting this
        // as a tool bubble — without it the content renders as raw markdown.
        const hasSearchResult = results.some((r) => r.tool === "web_search");
        const contentWithDetails = hasSearchResult
          ? `🔍 ${resultSummaries}`
          : `🔧 ${resultSummaries}\n---\n${fullDetails}`;

        useChatStore.setState((state) => ({
          messages: state.messages.map((m) =>
            m.id === toolStatusId ? { ...m, content: contentWithDetails } : m
          ),
        }));

        // Check if stopped after tool execution
        if (stoppedRef.current) break;

        // Build the tool results message and add to conversation
        const toolResultsMessage = formatToolResults(results);

        // Add the full exchange to API messages for context
        apiMessages = [
          ...apiMessages,
          { role: "assistant" as const, content: fullResponse },
          { role: "user" as const, content: toolResultsMessage },
        ];

        // Update project context with new manifest
        if (currentManifest) {
          projectContext = {
            path: projectPath,
            manifest: currentManifest,
            contextString: currentContext ? contextToPromptString(currentContext) : undefined,
          };
        }

        // Continue the loop — AI will process tool results
      }

      if (iterations >= MAX_TOOL_ITERATIONS) {
        addMessage({
          id: (Date.now() + 9999).toString(),
          role: "assistant",
          content: "⏸️ I've used all 10 tool steps for this turn. Click **Continue** to let me keep going, or send a new message.",
          timestamp: new Date(),
        });
        setShowContinue(true);
      }

    } catch (error: any) {
      if (stoppedRef.current) {
        // User stopped — don't show error
      } else {
        console.error("Chat error:", error);
        useChatStore.setState((state) => ({
          messages: state.messages.filter((m) => m.content && m.content !== "").concat({
            id: (Date.now() + 1).toString(),
            role: "assistant",
            content: `❌ Error: ${error.message}`,
            timestamp: new Date(),
          }),
        }));
      }
    } finally {
      stoppedRef.current = false;
      readerRef.current = null;
      setIsRouting(false);
      setLoading(false);

      // Auto-save conversation to chat history
      if (currentProject?.id) {
        const currentMessages = useChatStore.getState().messages;
        saveConversation(currentProject.id, currentMessages);

        // Silent background: extract observations for memory system
        if (currentMessages.length >= 4) {
          extractObservations(
            currentMessages.map((m) => ({ role: m.role, content: m.content })),
            'project'
          ).catch(() => {}); // fire-and-forget, never block
        }
      }
    }
  };

  // ── Element selection: fire handleSend once trigger increments ──
  useEffect(() => {
    if (elementSendTrigger > 0 && elementMsgRef.current) {
      const msg = elementMsgRef.current;
      const img = elementImgRef.current;
      elementMsgRef.current = null;
      elementImgRef.current = null;

      // If there's a reference image, add it to pendingImages before sending
      if (img) {
        setPendingImages([{
          id: `img_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          base64: img.base64,
          mimeType: img.mimeType,
          name: "reference.png",
        }]);
      }

      // Small delay to let React batch the pendingImages state update
      setTimeout(() => handleSend(msg), 50);
    }
  }, [elementSendTrigger]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle paste on the input field specifically
  const handleInputPaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    let hasImage = false;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith("image/")) {
        hasImage = true;
        break;
      }
    }

    if (!hasImage) return;

    e.preventDefault();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const blob = item.getAsFile();
        if (blob) {
          const img = await blobToMessageImage(blob, item.type);
          if (img) {
            setPendingImages((prev) => [...prev, img]);
          }
        }
      }
    }
  }, [blobToMessageImage]);

  const handleEditMessage = (messageId: string) => {
    if (isLoading) return;
    const message = messages.find((m) => m.id === messageId);
    if (!message) return;

    // Put message content back in the input
    setInput(message.content);

    // Restore images if any
    if (message.images && message.images.length > 0) {
      setPendingImages(message.images);
    }

    // Remove this message and everything after it
    const messageIndex = messages.findIndex((m) => m.id === messageId);
    if (messageIndex !== -1) {
      useChatStore.setState((state) => ({
        messages: state.messages.slice(0, messageIndex),
      }));
    }

    inputRef.current?.focus();
  };

  const handleSaveCodeBlock = async (filename: string, content: string) => {
    if (!projectPath) {
      addMessage({
        id: Date.now().toString(),
        role: "assistant",
        content: "❌ No project open. Open a project first to save files.",
        timestamp: new Date(),
      });
      return;
    }

    try {
      await writeFile(projectPath, filename, content);

      // Update manifest
      const relativePath = getRelativePath(projectPath, `${projectPath}/${filename}`);
      const updatedManifest = await updateManifestEntry(projectPath, relativePath, content, manifest || undefined);
      if (updatedManifest) setManifest(updatedManifest);

      // Refresh file tree
      const files = await readDirectory(projectPath, 3);
      setFileTree(files);

      addMessage({
        id: Date.now().toString(),
        role: "assistant",
        content: `✅ Saved: ${filename}`,
        timestamp: new Date(),
      });
    } catch (error: any) {
      addMessage({
        id: Date.now().toString(),
        role: "assistant",
        content: `❌ Failed to save: ${error.message}`,
        timestamp: new Date(),
      });
    }
  };

  // Parse message for code blocks and tool call blocks
  const renderMessage = (content: string) => {
    // Strip all tool block variants — well-formed, malformed, orphaned, and function_calls style
    let cleanContent = content
      .replace(/<function_calls>[\s\S]*?<\/function_calls>/g, "")
      .replace(/<function_calls>/g, "").replace(/<\/function_calls>/g, "")
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "")
      .replace(/<tool_result>[\s\S]*?<\/tool_result>/g, "")
      .replace(/<[^>]*tool_?call[^>]*>[\s\S]*?<\/[^>]*tool_?call[^>]*>/g, "")
      .replace(/<[^>]*tool_?result[^>]*>[\s\S]*?<\/[^>]*tool_?result[^>]*>/g, "")
      .replace(/<[^>]*tool_?call[^>]*>[\s\S]*/g, "")
      .replace(/<[^>]*tool_?result[^>]*>[\s\S]*/g, "")
      .replace(/\{"name"?\s*:\s*"(?:write_file|read_file|edit_file|list_directory|create_directory|delete_file|read_multiple_files|run_command|web_search|write_context|create_scheduled_task|connection)"[\s\S]*?\}\s*/g, "")
      .replace(/<\/tool_call>/g, "")
      .replace(/<\/tool_result>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!cleanContent) return <span className={`${t.colors.textMuted} italic`}>Working with files...</span>;

    // Simple mode: strip code blocks for clean reading
    if (mode === "simple") {
      cleanContent = cleanContent.replace(/```[\s\S]*?```/g, "").trim();
      cleanContent = cleanContent.replace(/`[^`]{40,}`/g, "").trim();
      cleanContent = cleanContent.replace(/\n{3,}/g, "\n\n").trim();
      if (!cleanContent) return <span className={`${t.colors.textMuted} italic`}>Changes applied.</span>;
    }

    return (
      <MarkdownRenderer
        content={cleanContent}
        theme={t}
        themeKey={theme}
        projectPath={projectPath}
        onSaveCodeBlock={handleSaveCodeBlock}
      />
    );
  };

  // Render images attached to a message
  const renderMessageImages = (images: MessageImage[]) => {
    return (
      <div className="flex flex-wrap gap-2 mb-2">
        {images.map((img) => (
          <img
            key={img.id}
            src={`data:${img.mimeType};base64,${img.base64}`}
            alt={img.name || "Attached image"}
            className={`max-w-[240px] max-h-[180px] object-contain ${t.borderRadius} cursor-pointer hover:opacity-90 transition-opacity`}
            onClick={() => {
              const win = window.open();
              if (win) {
                win.document.write(`<img src="data:${img.mimeType};base64,${img.base64}" style="max-width:100%;height:auto;" />`);
                win.document.title = img.name || "Image";
              }
            }}
          />
        ))}
      </div>
    );
  };

  // Detect tool status messages (🔧 prefix)
  const isToolMessage = (content: string) => content.startsWith("🔧");

  // Detect search result messages (🔍 prefix)
  const isSearchMessage = (content: string) => content.startsWith("🔍");

  // Render search results with clickable URLs
  const renderSearchMessage = (content: string) => {
    const lines = content.split("\n");
    return (
      <div className="space-y-0.5">
        {lines.map((line, i) => {
          const trimmed = line.trim();
          // Detect URLs and make them clickable
          if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            // Strip leading number+dot if present (e.g. "1. https://...")
            const url = trimmed.replace(/^\d+\.\s*/, "");
            const displayUrl = url.length > 60 ? url.slice(0, 57) + "…" : url;
            return (
              <div key={i} className="pl-2">
                <button
                  onClick={() => {
                    import("@tauri-apps/plugin-opener").then(({ open }) => open(url)).catch(() => window.open(url, "_blank"));
                  }}
                  className="text-blue-400 hover:text-blue-300 hover:underline text-xs break-all text-left cursor-pointer"
                  title={url}
                >
                  ↗ {displayUrl}
                </button>
              </div>
            );
          }
          // Check for "  1. https://..." pattern
          const numberedUrlMatch = trimmed.match(/^(\d+)\.\s*(https?:\/\/.+)$/);
          if (numberedUrlMatch) {
            const url = numberedUrlMatch[2];
            const displayUrl = url.length > 55 ? url.slice(0, 52) + "…" : url;
            return (
              <div key={i} className="pl-2">
                <button
                  onClick={() => {
                    import("@tauri-apps/plugin-opener").then(({ open }) => open(url)).catch(() => window.open(url, "_blank"));
                  }}
                  className="text-blue-400 hover:text-blue-300 hover:underline text-xs break-all text-left cursor-pointer"
                  title={url}
                >
                  ↗ {displayUrl}
                </button>
              </div>
            );
          }
          // Regular text line
          return <div key={i}>{line}</div>;
        })}
      </div>
    );
  };

  // ─── Attach button file handler ───────────────────────────────────
  const handleAttachFiles = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const imageFiles = files.filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type));
    const textFiles = files.filter((f) => !ALLOWED_IMAGE_TYPES.includes(f.type) && isAllowedTextFile(f));

    if (imageFiles.length > 0) await addImages(imageFiles);

    if (textFiles.length > 0) {
      const newFiles = await Promise.all(
        textFiles.map(async (f) => ({
          id: `txt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          name: f.name,
          content: await f.text(),
        }))
      );
      setPendingTextFiles((prev) => [...prev, ...newFiles]);
    }

    // Reset so the same file can be picked again
    e.target.value = "";
    inputRef.current?.focus();
  }, [addImages]);

  return (
    <div
      className={`flex flex-col h-full ${t.colors.bg} relative`}
      data-theme={theme}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-blue-500/10 border-2 border-dashed border-blue-500 rounded-lg pointer-events-none">
          <div className="flex flex-col items-center gap-2">
            <Image size={40} className="text-blue-500" />
            <span className={`text-sm font-medium ${t.colors.text}`}>Drop image or file here</span>
          </div>
        </div>
      )}

      {/* Chat header */}
      <div className={`px-4 py-2 ${t.colors.bgSecondary} ${t.colors.border} border-b flex justify-between items-center`}>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onSettingsClick?.("apikey")}
            className={`text-sm ${t.colors.textMuted} hover:${t.colors.text} cursor-pointer transition-colors`}
            title="Change AI provider"
          >
            {getActiveProviderDisplay()} {isRouting ? <span className="text-amber-400 animate-pulse">Routing...</span> : '⚙'}
          </button>
          {projectPath && (
            <span className={`text-xs px-2 py-0.5 ${t.colors.bgTertiary} ${t.borderRadius} ${t.colors.textMuted}`}>
              📁 {projectPath.split(/[/\\]/).pop()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Session cost indicator */}
          {session.totalCost > 0 && (
            <button
              onClick={() => onSettingsClick?.("usage")}
              className={`flex items-center gap-1.5 px-2 py-0.5 ${t.borderRadius} ${t.colors.bgTertiary} hover:opacity-80 transition-opacity`}
              title="Session usage — click for details"
            >
              <Coins size={13} className="text-amber-500" />
              <span className={`text-xs font-medium ${t.colors.text}`}>
                {formatCost(session.totalCost)}
              </span>
              <span className={`text-xs ${t.colors.textMuted}`}>
                · {session.entries.length} {session.entries.length === 1 ? "call" : "calls"}
              </span>
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={() => {
                if (currentProject?.id && messages.length > 0) {
                  saveConversation(currentProject.id, messages);
                }
                // Compress session: move progress + recent into "built"
                if (projectContextData && projectPath) {
                  const compressed = compressSession(projectContextData);
                  setProjectContextData(compressed);
                  saveContext(projectPath, compressed).catch(() => {});
                }
                clearMessages();
                setCurrentChatId(null);
                setShowContinue(false);
                clearDiffs();
              }}
              className={`p-1.5 ${t.colors.textMuted} hover:${t.colors.text} ${t.borderRadius} flex items-center gap-1`}
              title="New chat"
            >
              <MessageSquarePlus size={16} />
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={() => {
                // Compress session: move progress + recent into "built"
                if (projectContextData && projectPath) {
                  const compressed = compressSession(projectContextData);
                  setProjectContextData(compressed);
                  saveContext(projectPath, compressed).catch(() => {});
                }
                clearMessages();
                setCurrentChatId(null);
                setShowContinue(false);
                clearDiffs();
              }}
              className={`p-1 ${t.colors.textMuted} hover:${t.colors.text} ${t.borderRadius}`}
              title="Clear chat"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-4 select-text">
        {messages.length === 0 ? (
          <div className={`${t.colors.textMuted} text-center mt-8 ${t.fontFamily}`}>
            {projectPath 
              ? `Project loaded: ${projectPath.split(/[/\\]/).pop()}. Ask me to create or edit files!`
              : "Start a conversation, or open a project first..."
            }
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((message) => {
              const isTool = message.role === "assistant" && isToolMessage(message.content);
              const isSearch = message.role === "assistant" && isSearchMessage(message.content);

              return (
                <div
                  key={message.id}
                  className={`flex gap-3 group ${message.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  {message.role === "assistant" && (
                    <div className={`w-10 h-10 ${(isTool || isSearch) ? t.colors.bgTertiary : ""} ${t.borderRadius} flex items-center justify-center flex-shrink-0 overflow-hidden`}>
                      {isSearch
                        ? <Globe size={16} className="text-blue-400" />
                        : isTool 
                        ? <Wrench size={16} className={t.colors.textMuted} />
                        : <img src={theme === "light" || theme === "highContrast" ? elipseLight : elipseDark} alt="omnirun" className="w-10 h-10" />
                      }
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] px-4 py-2 break-words overflow-hidden ${t.borderRadius} ${
                      message.role === "user"
                        ? `${t.colors.accent} ${theme === "highContrast" ? "text-black" : "text-white"}`
                        : (isTool || isSearch)
                        ? `${t.colors.bgTertiary} ${t.colors.textMuted} text-sm`
                        : `${t.colors.bgSecondary} ${t.colors.text}`
                    }`}
                  >
                    {/* Render images if attached */}
                    {message.images && message.images.length > 0 && renderMessageImages(message.images)}
                    
                    <div className={`${t.fontFamily}`} style={{ fontSize: fontSize === "small" ? "13px" : fontSize === "large" ? "17px" : "15px" }}>
                      {message.content 
                        ? (isSearch ? renderSearchMessage(message.content)
                          : isTool ? <ToolActionLine content={message.content} theme={t} themeKey={theme} mode={mode} />
                          : message.role === "assistant" ? renderMessage(message.content) : message.content)
                        : message.images && message.images.length > 0 
                          ? null
                          : <div className="flex items-center gap-2">
                              <OmnirunSpinner textClass={t.colors.textMuted} />
                              {isLoading && message.id === messages[messages.length - 1]?.id && (
                                <span className={`text-sm ${t.colors.textMuted}`}>Working on it...</span>
                              )}
                            </div>}
                    </div>
                    {/* Streaming indicator — shows while AI is still generating and text has started */}
                    {isLoading && message.role === "assistant" && message.content && message.id === messages[messages.length - 1]?.id && !isTool && !isSearch && (
                      <div className="flex items-center gap-2 mt-2 pt-1.5 border-t border-current/5">
                        <OmnirunSpinner size={16} showTimer={true} textClass={`${t.colors.textMuted} opacity-70`} />
                      </div>
                    )}
                    <div className={`text-[10px] mt-1 opacity-50 ${
                      message.role === "user" ? "text-right" : ""
                    }`}>
                      {new Date(message.timestamp).toLocaleTimeString([], { 
                        hour: "2-digit", 
                        minute: "2-digit",
                        hour12: timeFormat === "12h",
                      })}
                    </div>
                  </div>
                  {message.role === "user" && (
                    <div className="flex flex-col items-center gap-1 flex-shrink-0">
                      <div className={`w-8 h-8 ${t.borderRadius} flex items-center justify-center overflow-hidden`} style={{ background: showAvatar ? 'transparent' : 'var(--action, #7C3AED)' }}>
                        {showAvatar ? (
                          <img src={avatarUrl!} alt="avatar" className="w-8 h-8 object-cover" onError={() => setAvatarError(true)} />
                        ) : (
                          <span className="text-white text-xs font-semibold">{getInitials()}</span>
                        )}
                      </div>
                      <button
                        onClick={() => handleEditMessage(message.id)}
                        className={`${t.colors.textMuted} hover:${t.colors.text} opacity-0 group-hover:opacity-100 transition-opacity`}
                        title="Edit message"
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <DiffViewer />
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Auto-fix indicator — shown when automatically fixing build errors */}
      {isAutoFixing && (
        <div className={`flex items-center justify-center gap-2 px-4 py-2 ${t.colors.bgSecondary} border-t ${t.colors.border}`}>
          <AlertCircle size={14} className="text-amber-500" />
          <span className={`text-xs ${t.colors.textMuted}`}>
            Fixing build error... (attempt {autoFixCount}/3)
          </span>
        </div>
      )}

      {/* Continue button — shown when AI hits iteration limit */}
      {showContinue && (
        <div className="flex justify-center px-4 py-2">
          <button
            onClick={handleContinue}
            className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-medium cursor-pointer transition-all duration-150"
            style={{
              border: '1px solid var(--accent-muted, var(--accent, #00DD55))',
              background: 'var(--accent-glow, rgba(0, 255, 102, 0.15))',
              color: 'var(--accent-bright, var(--accent, #00FF66))',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--accent-muted, var(--accent, #00AA44))';
              e.currentTarget.style.color = '#FFFFFF';
              e.currentTarget.style.borderColor = 'var(--accent-bright, var(--accent, #00FF66))';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'var(--accent-glow, rgba(0, 255, 102, 0.15))';
              e.currentTarget.style.color = 'var(--accent-bright, var(--accent, #00FF66))';
              e.currentTarget.style.borderColor = 'var(--accent-muted, var(--accent, #00DD55))';
            }}
          >
            <span>▶</span>
            <span>Continue</span>
          </button>
        </div>
      )}

      {/* Console error banner — shown when JS errors are captured */}
      {consoleErrors.length > 0 && !isLoading && (
        <div className={`flex items-center justify-between gap-3 px-4 py-2 border-t ${t.colors.border}`}
          style={{ background: "rgba(239, 68, 68, 0.08)" }}>
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
            <span className={`text-xs text-red-400 truncate`}>
              {consoleErrors.length} console error{consoleErrors.length > 1 ? "s" : ""} detected
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={handleFixConsoleErrors}
              className="text-xs px-3 py-1 rounded font-medium transition-colors"
              style={{
                background: "rgba(239, 68, 68, 0.15)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "#f87171",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.15)";
              }}
            >
              Fix errors
            </button>
            <button
              onClick={() => { clearErrors(); }}
              className={`text-xs ${t.colors.textMuted} hover:text-red-400 transition-colors`}
              title="Dismiss"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="p-4">
        {/* Pending image chips */}
        {(pendingImages.length > 0 || pendingTextFiles.length > 0) && (
          <div className="flex flex-wrap gap-2 mb-2">
            {pendingImages.map((img) => (
              <div
                key={img.id}
                className={`relative group/chip inline-flex items-center gap-1.5 px-2 py-1 ${t.borderRadius} ${t.colors.bgTertiary} border ${t.colors.border}`}
              >
                <img
                  src={`data:${img.mimeType};base64,${img.base64}`}
                  alt={img.name || "Image"}
                  className="w-8 h-8 object-cover rounded"
                />
                <span className={`text-xs ${t.colors.textMuted} max-w-[100px] truncate`}>
                  {img.name || "Image"}
                </span>
                <button
                  onClick={() => removeImage(img.id)}
                  className={`ml-0.5 p-0.5 ${t.borderRadius} hover:bg-red-500/20 text-red-400 hover:text-red-500 transition-colors`}
                  title="Remove image"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {pendingTextFiles.map((file) => (
              <div
                key={file.id}
                className={`relative group/chip inline-flex items-center gap-1.5 px-2 py-1 ${t.borderRadius} ${t.colors.bgTertiary} border ${t.colors.border}`}
              >
                <div className={`w-8 h-8 flex items-center justify-center rounded ${t.colors.bgSecondary}`}>
                  <FileText size={16} className={t.colors.textMuted} />
                </div>
                <span className={`text-xs ${t.colors.textMuted} max-w-[100px] truncate`}>
                  {file.name}
                </span>
                <button
                  onClick={() => setPendingTextFiles((prev) => prev.filter((f) => f.id !== file.id))}
                  className={`ml-0.5 p-0.5 ${t.borderRadius} hover:bg-red-500/20 text-red-400 hover:text-red-500 transition-colors`}
                  title="Remove file"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept="image/png,image/jpeg,image/gif,image/webp,.txt,.md,.markdown,.html,.htm,.csv,.json,.xml,.pdf,.js,.jsx,.ts,.tsx,.css,.scss,.sass,.py,.rb,.java,.c,.cpp,.h,.go,.rs,.php,.sh,.bash,.yaml,.yml,.toml,.ini,.env,.sql,.graphql,.vue,.svelte,.astro"
            onChange={handleAttachFiles}
          />

          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className={`self-end p-2 ${t.colors.textMuted} hover:${t.colors.text} ${t.borderRadius} transition-colors disabled:opacity-50`}
            title="Attach file"
          >
            <Paperclip size={18} />
          </button>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              // Auto-resize
              e.target.style.height = "auto";
              const newHeight = Math.min(e.target.scrollHeight, 200);
              e.target.style.height = newHeight + "px";
              // Only show scrollbar when content exceeds max height
              e.target.style.overflowY = e.target.scrollHeight > 200 ? "auto" : "hidden";
            }}
            onKeyDown={handleKeyDown}
            onPaste={handleInputPaste}
            placeholder={
              isLoading
                ? "Waiting for response..."
                : pendingImages.length > 0
                  ? "Add a message or just send the image..."
                  : "Type a message... (paste images with Ctrl+V)"
            }
            disabled={isLoading}
            rows={1}
            className={`flex-1 ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} ${t.borderRadius} px-4 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500 ${t.fontFamily} disabled:opacity-50 resize-none overflow-hidden`}
            style={{ maxHeight: "200px" }}
          />
          {isLoading ? (
            <button
              onClick={handleStop}
              className={`bg-red-600 hover:bg-red-700 text-white px-4 py-2 ${t.borderRadius} flex items-center gap-2 self-end`}
              title="Stop generating"
            >
              <Square size={18} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() && pendingImages.length === 0 && pendingTextFiles.length === 0}
              className={`${t.colors.accent} ${t.colors.accentHover} ${theme === "highContrast" ? "text-black" : "text-white"} px-4 py-2 ${t.borderRadius} flex items-center gap-2 disabled:opacity-50 self-end`}
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatArea;