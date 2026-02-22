import { useState, useRef, useEffect } from "react";
import { MessageSquarePlus, Trash2, Search, MessageSquare, X, MoreVertical, Pin, PinOff, Pencil, Download } from "lucide-react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useProjectStore } from "../../stores/projectStore";
import { useChatStore } from "../../stores/chatStore";
import { useChatHistoryStore } from "../../stores/chatHistoryStore";
import type { ChatConversation } from "../../stores/chatHistoryStore";
import { themes } from "../../config/themes";

function ChatHistory() {
  const { theme } = useSettingsStore();
  const { currentProject } = useProjectStore();
  const { messages, clearMessages } = useChatStore();
  const {
    currentChatId,
    conversations,
    searchQuery,
    setCurrentChatId,
    setSearchQuery,
    loadConversations,
    saveConversation,
    deleteConversation,
    renameConversation,
    pinConversation,
    exportConversation,
    getFilteredConversations,
  } = useChatHistoryStore();

  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const t = themes[theme];

  // Load conversations when project changes
  useEffect(() => {
    if (currentProject?.id) {
      loadConversations(currentProject.id);
    }
  }, [currentProject?.id, loadConversations]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus rename input when it appears
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Auto-dismiss delete confirmation after 3 seconds
  useEffect(() => {
    if (confirmDeleteId) {
      deleteTimerRef.current = setTimeout(() => {
        setConfirmDeleteId(null);
      }, 3000);
    }
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, [confirmDeleteId]);

  // No project open
  if (!currentProject) {
    return (
      <div className={`${t.colors.textMuted} text-sm p-2 ${t.fontFamily}`}>
        Open a project to see chats
      </div>
    );
  }

  const filtered = getFilteredConversations();

  const handleNewChat = () => {
    // Save current chat first if it has messages
    if (messages.length > 0 && currentProject?.id) {
      saveConversation(currentProject.id, messages);
    }
    clearMessages();
    setCurrentChatId(null);
  };

  const handleLoadChat = (conv: ChatConversation) => {
    // Don't reload if already active
    if (currentChatId === conv.id) return;

    // Save current chat before switching
    if (messages.length > 0 && currentProject?.id) {
      saveConversation(currentProject.id, messages);
    }

    // Load the selected conversation
    useChatStore.getState().setMessages(conv.messages);
    setCurrentChatId(conv.id);
  };

  const handleRenameStart = (conv: ChatConversation) => {
    setRenamingId(conv.id);
    setRenameValue(conv.title);
    setMenuOpenId(null);
  };

  const handleRenameSubmit = (chatId: string) => {
    if (renameValue.trim() && currentProject?.id) {
      renameConversation(currentProject.id, chatId, renameValue);
    }
    setRenamingId(null);
  };

  const handlePin = (chatId: string) => {
    if (currentProject?.id) {
      pinConversation(currentProject.id, chatId);
    }
    setMenuOpenId(null);
  };

  const handleExport = (chatId: string) => {
    exportConversation(chatId);
    setMenuOpenId(null);
  };

  const handleDelete = (chatId: string) => {
    setMenuOpenId(null);

    if (confirmDeleteId === chatId) {
      // Second click — actually delete
      deleteConversation(currentProject.id, chatId);
      if (currentChatId === chatId) {
        clearMessages();
        setCurrentChatId(null);
      }
      setConfirmDeleteId(null);
    } else {
      // First click — ask for confirmation
      setConfirmDeleteId(chatId);
    }
  };

  // Format relative time
  const formatTime = (timestamp: number): string => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return "Just now";
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return new Date(timestamp).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* New Chat button */}
      <button
        onClick={handleNewChat}
        className={`w-full flex items-center justify-center gap-2 py-2 px-3 text-sm ${t.borderRadius} ${t.colors.border} border ${t.colors.text} hover:${t.colors.bgTertiary} transition-colors`}
      >
        <MessageSquarePlus size={16} />
        New Chat
      </button>

      {/* Search bar — only show when 5+ conversations */}
      {conversations.length >= 5 && (
        <div className="relative">
          <Search
            size={14}
            className={`absolute left-2 top-1/2 -translate-y-1/2 ${t.colors.textMuted}`}
          />
          <input
            type="text"
            placeholder="Search chats..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={`w-full pl-7 pr-7 py-1.5 text-xs ${t.borderRadius} ${t.colors.bgTertiary} ${t.colors.border} border ${t.colors.text} placeholder:${t.colors.textMuted} focus:outline-none`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className={`absolute right-2 top-1/2 -translate-y-1/2 ${t.colors.textMuted} hover:${t.colors.text}`}
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Chat list */}
      {filtered.length === 0 ? (
        <div className={`${t.colors.textMuted} text-xs p-2 text-center`}>
          {searchQuery ? "No chats match your search" : "No chats yet — start typing!"}
        </div>
      ) : (
        <div className="space-y-0.5">
          {filtered.map((conv) => (
            <div
              key={conv.id}
              className={`group relative flex items-center ${t.borderRadius} ${
                currentChatId === conv.id
                  ? t.colors.bgTertiary
                  : `hover:${t.colors.bgTertiary}`
              }`}
            >
              {/* Chat item — click to load */}
              <button
                onClick={() => handleLoadChat(conv)}
                className={`flex-1 text-left px-3 py-2 min-w-0 ${
                  currentChatId === conv.id ? t.colors.text : t.colors.textMuted
                }`}
              >
                {/* Title row */}
                {renamingId === conv.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameSubmit(conv.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onBlur={() => handleRenameSubmit(conv.id)}
                    onClick={(e) => e.stopPropagation()}
                    className={`w-full text-sm px-1 py-0.5 ${t.borderRadius} ${t.colors.bgSecondary} ${t.colors.border} border ${t.colors.text} focus:outline-none`}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    {conv.isPinned ? (
                      <Pin size={14} className="shrink-0 opacity-60" />
                    ) : (
                      <MessageSquare size={14} className="shrink-0" />
                    )}
                    <span className="text-sm truncate">{conv.title}</span>
                  </div>
                )}

                {/* Meta row */}
                <div className={`text-xs ${t.colors.textMuted} ml-6 mt-0.5`}>
                  {formatTime(conv.updatedAt)} · {conv.messages.length} msg{conv.messages.length !== 1 ? "s" : ""}
                </div>
              </button>

              {/* Delete confirmation indicator */}
              {confirmDeleteId === conv.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(conv.id);
                  }}
                  className={`p-1.5 mr-1 ${t.borderRadius} shrink-0 text-red-500`}
                  title="Click again to delete"
                >
                  <Trash2 size={14} />
                </button>
              )}

              {/* Three-dot menu button — visible on hover */}
              {confirmDeleteId !== conv.id && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpenId(menuOpenId === conv.id ? null : conv.id);
                  }}
                  className={`p-1.5 mr-1 ${t.borderRadius} shrink-0 transition-opacity opacity-0 group-hover:opacity-100 ${t.colors.textMuted} hover:${t.colors.text}`}
                >
                  <MoreVertical size={14} />
                </button>
              )}

              {/* Dropdown menu */}
              {menuOpenId === conv.id && (
                <div
                  ref={menuRef}
                  className={`absolute right-0 top-full mt-1 z-50 ${t.colors.bgSecondary} ${t.colors.border} border ${t.borderRadius} shadow-lg min-w-[170px]`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePin(conv.id);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${t.colors.text} hover:${t.colors.bgTertiary}`}
                  >
                    {conv.isPinned ? <PinOff size={14} /> : <Pin size={14} />}
                    {conv.isPinned ? "Unpin" : "Pin to Top"}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameStart(conv);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${t.colors.text} hover:${t.colors.bgTertiary}`}
                  >
                    <Pencil size={14} />
                    Rename
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleExport(conv.id);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${t.colors.text} hover:${t.colors.bgTertiary}`}
                  >
                    <Download size={14} />
                    Export as Markdown
                  </button>
                  <div className={`${t.colors.border} border-t my-1`} />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(conv.id);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 text-red-500 hover:${t.colors.bgTertiary}`}
                  >
                    <Trash2 size={14} />
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default ChatHistory;