import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Square, User, Bot, Trash2, Wrench, Pencil, Coins, X, Image, MessageSquarePlus, Globe, AlertCircle } from "lucide-react";
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
import { parseToolCalls, executeToolCalls, formatToolResults } from "../../services/toolService";
import { initContext, saveContext, addRecentChange, contextToPromptString, type ProjectContext as ContextData } from "../../services/contextService";
import { useDiffStore } from "../../stores/diffStore";
import DiffViewer from "../diff/DiffViewer";
import type { MessageImage } from "../../stores/chatStore";

const MAX_TOOL_ITERATIONS = 10;

// Allowed image types
const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function ChatArea({ onSettingsClick, pendingMessage, onPendingMessageConsumed }: {
  onSettingsClick?: (tab: string) => void;
  pendingMessage?: string | null;
  onPendingMessageConsumed?: () => void;
}) {
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<MessageImage[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showContinue, setShowContinue] = useState(false);
  const [isAutoFixing, setIsAutoFixing] = useState(false);
  const [projectContextData, setProjectContextData] = useState<ContextData | null>(null);
  const stoppedRef = useRef(false);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dragCounterRef = useRef(0);
  const { theme, timeFormat } = useSettingsStore();
  const { messages, isLoading, addMessage, setLoading, clearMessages } = useChatStore();
  const { currentProject, projectPath, fileTree, selectedFile, setFileTree, manifest, setManifest, buildError, autoFixCount, setBuildError, incrementAutoFix, resetAutoFix } = useProjectStore();
  const { saveConversation, currentChatId, setCurrentChatId } = useChatHistoryStore();
  const { session, trackAPICall } = useUsageStore();
  const { requestApproval, clear: clearDiffs } = useDiffStore();
  const t = themes[theme];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Scroll to bottom when a diff approval appears
  const pendingDiff = useDiffStore((s) => s.pendingDiff);
  useEffect(() => {
    if (pendingDiff) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [pendingDiff]);

  // Initialize project context when project path changes
  useEffect(() => {
    if (!projectPath) {
      setProjectContextData(null);
      return;
    }

    const init = async () => {
      try {
        // Get root file names for tech stack detection
        const rootFiles = fileTree?.map((f: any) => f.name) || [];
        const ctx = await initContext(projectPath, rootFiles);
        setProjectContextData(ctx);
      } catch (e) {
        console.error("Failed to init context:", e);
      }
    };

    init();
  }, [projectPath, fileTree]);

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

    if (imageFiles.length > 0) {
      await addImages(imageFiles);
      inputRef.current?.focus();
    }
  }, [addImages]);

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

  // Collapse incomplete code blocks and tool calls during streaming
  const getStreamingDisplay = (content: string): string => {
    // If there's an unclosed <tool_call> tag, hide everything from it onward
    const openTag = content.lastIndexOf("<tool_call>");
    const closeTag = content.lastIndexOf("</tool_call>");
    if (openTag !== -1 && (closeTag === -1 || closeTag < openTag)) {
      const textBefore = content.slice(0, openTag).trim();
      return textBefore || "⏳ Working on files...";
    }

    // Strip completed tool_call blocks
    const clean = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();

    // Count backtick fences
    const fences = clean.match(/```/g);
    if (!fences || fences.length % 2 === 0) return content; // All code blocks are closed

    // Odd number = unclosed code block. Show text before it + placeholder
    const originalBeforeFence = content.slice(0, content.lastIndexOf("```"));
    return originalBeforeFence + "```\n⏳ Writing code...\n```";
  };

  const handleSend = async (overrideMessage?: string) => {
    const messageText = overrideMessage || input.trim();
    if ((!messageText && pendingImages.length === 0) || isLoading) return;

    // Reset auto-fix counter when user sends a manual message (not auto-fix)
    if (!overrideMessage) {
      resetAutoFix();
    }

    setShowContinue(false);

    const userMessage = messageText;
    const userImages = pendingImages.length > 0 ? [...pendingImages] : undefined;
    setInput("");
    setPendingImages([]);
    
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
      let projectContext = undefined;
      if (projectPath) {
        projectContext = {
          path: projectPath,
          manifest: manifest,
          contextString: projectContextData ? contextToPromptString(projectContextData) : undefined,
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

        const result = await sendMessage(apiMessages, provider, (chunk) => {
          if (stoppedRef.current) return;
          fullResponse += chunk;
          const displayContent = getStreamingDisplay(fullResponse);
          useChatStore.setState((state) => ({
            messages: state.messages.map((m) =>
              m.id === assistantId ? { ...m, content: displayContent } : m
            ),
          }));
        }, projectContext, undefined, (reader) => { readerRef.current = reader; });

        fullResponse = result.text;

        // Update with full content (replaces streaming placeholders)
        useChatStore.setState((state) => ({
          messages: state.messages.map((m) =>
            m.id === assistantId ? { ...m, content: fullResponse } : m
          ),
        }));

        // Check if stopped during streaming
        if (stoppedRef.current) break;

        // Track usage for this API call
        if (result.usage.inputTokens > 0 || result.usage.outputTokens > 0) {
          trackAPICall({
            model: provider.model,
            provider: provider.id,
            inputTokens: result.usage.inputTokens,
            outputTokens: result.usage.outputTokens,
            cacheCreationTokens: result.usage.cacheCreationTokens,
            cacheReadTokens: result.usage.cacheReadTokens,
          });
        }

        // If no response came through streaming, try getting it from a non-streaming call
        if (!fullResponse) {
          const fallbackResult = await sendMessage(apiMessages, provider, undefined, projectContext);
          fullResponse = fallbackResult.text;

          // Track usage for fallback call
          if (fallbackResult.usage.inputTokens > 0 || fallbackResult.usage.outputTokens > 0) {
            trackAPICall({
              model: provider.model,
              provider: provider.id,
              inputTokens: fallbackResult.usage.inputTokens,
              outputTokens: fallbackResult.usage.outputTokens,
              cacheCreationTokens: fallbackResult.usage.cacheCreationTokens,
              cacheReadTokens: fallbackResult.usage.cacheReadTokens,
            });
          }

          useChatStore.setState((state) => ({
            messages: state.messages.map((m) =>
              m.id === assistantId ? { ...m, content: fullResponse } : m
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

        // Clean up the message — strip raw <tool_call> tags from display
        // During streaming, getStreamingDisplay hides them, but line 459 puts
        // the raw fullResponse back. This removes the tags permanently.
        const cleanedContent = (
          parsed.textBefore + (parsed.textAfter ? "\n" + parsed.textAfter : "")
        ).trim() || "⏳ Working on files...";
        useChatStore.setState((state) => ({
          messages: state.messages.map((m) =>
            m.id === assistantId ? { ...m, content: cleanedContent } : m
          ),
        }));

        // Can't execute tools without a project path
        if (!projectPath) break;

        // ── Execute tool calls ──────────────────────────────

        const toolNames = parsed.toolCalls.map((tc) => tc.name).join(", ");
        const hasSearch = parsed.toolCalls.some((tc) => tc.name === "web_search");

        // Add a tool execution status message
        const toolStatusId = (Date.now() + iterations + 1000).toString();
        addMessage({
          id: toolStatusId,
          role: "assistant",
          content: hasSearch ? `🔍 Searching...` : `🔧 Executing: ${toolNames}...`,
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
          projectContextData
        );

        currentManifest = updatedManifest;

        // Update manifest in store if changed
        if (updatedManifest) {
          setManifest(updatedManifest);
        }

        // Update context if write_context tool was used
        if (updatedContext) {
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
          if (projectContextData) {
            let ctx = updatedContext || projectContextData;
            for (const f of filesChanged) {
              const action = parsed.toolCalls.find(tc => {
                const p = tc.arguments.path || tc.arguments.paths?.[0];
                return p === f;
              });
              const verb = action?.name === "delete_file" ? "Deleted" : action?.name === "edit_file" ? "Edited" : "Updated";
              ctx = addRecentChange(ctx, `${verb} ${f}`);
            }
            setProjectContextData(ctx);
            saveContext(projectPath, ctx).catch(() => {});
          }
        }

        // Update tool status message with results
        const toolResultsSummary = results
          .map((r) => {
            if (r.tool === "web_search") {
              // Parse the AI-formatted result back into a chat-friendly format
              // The result starts with 'Search: "query"' or 'Web search error:'
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
            return r.success ? r.result.split("\n")[0] : `❌ ${r.result}`;
          })
          .join("\n");

        // Use 🔍 prefix if any search results, 🔧 otherwise
        const hasSearchResult = results.some((r) => r.tool === "web_search");
        useChatStore.setState((state) => ({
          messages: state.messages.map((m) =>
            m.id === toolStatusId ? { ...m, content: hasSearchResult ? toolResultsSummary : `🔧 ${toolResultsSummary}` } : m
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
            contextString: projectContextData ? contextToPromptString(projectContextData) : undefined,
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
      setLoading(false);

      // Auto-save conversation to chat history
      if (currentProject?.id) {
        const currentMessages = useChatStore.getState().messages;
        saveConversation(currentProject.id, currentMessages);
      }
    }
  };

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
    useChatStore.setState((state) => ({
      messages: state.messages.slice(0, messageIndex),
    }));

    // Focus input
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleSaveCodeBlock = async (code: string, filename: string) => {
    if (!projectPath) return;
    
    try {
      const fullPath = `${projectPath}\\${filename.replace(/\//g, "\\")}`;
      await writeFile(fullPath, code);
      
      // Refresh file tree
      const files = await readDirectory(projectPath, 3);
      setFileTree(files);

      // Update manifest with the new/modified file
      if (manifest) {
        const relativePath = getRelativePath(projectPath, fullPath);
        const updatedManifest = updateManifestEntry(manifest, relativePath, code);
        setManifest(updatedManifest);
      }

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
    // Strip tool_call blocks from display — show clean text only
    const cleanContent = content.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
    if (!cleanContent) return <span className={`${t.colors.textMuted} italic`}>Working with files...</span>;

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
            <span className={`text-sm font-medium ${t.colors.text}`}>Drop image here</span>
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
            {getActiveProviderDisplay()} ⚙
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
                    <div className={`w-8 h-8 ${(isTool || isSearch) ? t.colors.bgTertiary : t.colors.accent} ${t.borderRadius} flex items-center justify-center flex-shrink-0`}>
                      {isSearch
                        ? <Globe size={16} className="text-blue-400" />
                        : isTool 
                        ? <Wrench size={16} className={t.colors.textMuted} />
                        : <Bot size={18} className={theme === "highContrast" ? "text-black" : "text-white"} />
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
                    
                    <div className={`${t.fontFamily}`}>
                      {message.content 
                        ? (isSearch ? renderSearchMessage(message.content)
                          : message.role === "assistant" && !isTool ? renderMessage(message.content) : message.content)
                        : message.images && message.images.length > 0 
                          ? null
                          : "Thinking..."}
                    </div>
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
                      <div className={`w-8 h-8 ${t.colors.bgTertiary} ${t.borderRadius} flex items-center justify-center`}>
                        <User size={18} className={t.colors.text} />
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

      {/* Input area */}
      <div className="p-4">
        {/* Pending image chips */}
        {pendingImages.length > 0 && (
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
          </div>
        )}

        <div className="flex gap-2">
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
              disabled={!input.trim() && pendingImages.length === 0}
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