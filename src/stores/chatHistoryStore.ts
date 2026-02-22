import { create } from "zustand";
import type { Message } from "./chatStore";
import { dbService } from "../services/dbService";

// A saved conversation
export interface ChatConversation {
  id: string;
  projectId: string;
  title: string;
  messages: Message[];
  createdAt: number;   // timestamp
  updatedAt: number;   // timestamp
  isPinned: boolean;
}

interface ChatHistoryState {
  // Current active chat id (null = new unsaved chat)
  currentChatId: string | null;

  // All conversations for the current project (loaded from SQLite)
  conversations: ChatConversation[];

  // Search filter
  searchQuery: string;

  // Actions
  setCurrentChatId: (id: string | null) => void;
  setSearchQuery: (query: string) => void;
  loadConversations: (projectId: string) => Promise<void>;
  saveConversation: (projectId: string, messages: Message[]) => Promise<void>;
  deleteConversation: (projectId: string, chatId: string) => Promise<void>;
  renameConversation: (projectId: string, chatId: string, newTitle: string) => Promise<void>;
  pinConversation: (projectId: string, chatId: string) => Promise<void>;
  exportConversation: (chatId: string) => void;
  getFilteredConversations: () => ChatConversation[];
}

// Generate a title from the first user message
function generateTitle(messages: Message[]): string {
  const firstUserMsg = messages.find((m) => m.role === "user");
  if (!firstUserMsg) return "New Chat";

  // Strip any markdown formatting for a clean title
  const clean = firstUserMsg.content
    .replace(/[#*_`~\[\]]/g, "")
    .replace(/\n/g, " ")
    .trim();

  if (clean.length <= 50) return clean;
  // Cut at last word boundary before 50 chars
  const truncated = clean.substring(0, 50);
  const lastSpace = truncated.lastIndexOf(" ");
  return (lastSpace > 20 ? truncated.substring(0, lastSpace) : truncated) + "\u2026";
}

// Sort: pinned first, then newest first within each group
function sortConversations(conversations: ChatConversation[]): ChatConversation[] {
  return [...conversations].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return b.updatedAt - a.updatedAt;
  });
}

export const useChatHistoryStore = create<ChatHistoryState>((set, get) => ({
  currentChatId: null,
  conversations: [],
  searchQuery: "",

  setCurrentChatId: (id) => set({ currentChatId: id }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  // Load all conversations for a project from SQLite
  loadConversations: async (projectId) => {
    try {
      const rows = await dbService.getChatHistory(projectId);
      const conversations: ChatConversation[] = rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        title: row.title,
        messages: row.messages.map((msg: any) => ({
          ...msg,
          timestamp: new Date(msg.timestamp),
        })),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        isPinned: row.isPinned,
      }));
      set({ conversations: sortConversations(conversations) });
    } catch (e) {
      console.error("Failed to load conversations from DB:", e);
      set({ conversations: [] });
    }
  },

  // Save current messages as a conversation (create or update)
  saveConversation: async (projectId, messages) => {
    // Don't save empty conversations
    if (messages.length === 0) return;

    const { currentChatId, conversations } = get();
    const now = Date.now();

    if (currentChatId) {
      // Update existing conversation
      const existing = conversations.find((c) => c.id === currentChatId);
      if (existing) {
        const newTitle = existing.title === "New Chat" ? generateTitle(messages) : undefined;
        const updatedConv: ChatConversation = {
          ...existing,
          messages,
          updatedAt: now,
          title: newTitle || existing.title,
        };

        // Update in SQLite
        try {
          await dbService.updateChatMessages(currentChatId, messages, newTitle);
        } catch (e) {
          console.error("Failed to update chat in DB:", e);
        }

        // Update in-memory state
        const updatedList = conversations.map((c) =>
          c.id === currentChatId ? updatedConv : c
        );
        set({ conversations: sortConversations(updatedList) });
      }
    } else {
      // Create new conversation
      const newConv: ChatConversation = {
        id: `chat_${now}_${Math.random().toString(36).substring(2, 8)}`,
        projectId,
        title: generateTitle(messages),
        messages,
        createdAt: now,
        updatedAt: now,
        isPinned: false,
      };

      // Save to SQLite
      try {
        await dbService.saveChat({
          id: newConv.id,
          projectId: newConv.projectId,
          title: newConv.title,
          messages: newConv.messages,
          isPinned: newConv.isPinned,
          createdAt: newConv.createdAt,
          updatedAt: newConv.updatedAt,
        });
      } catch (e) {
        console.error("Failed to save new chat to DB:", e);
      }

      set({
        currentChatId: newConv.id,
        conversations: sortConversations([...conversations, newConv]),
      });
    }
  },

  // Delete a conversation
  deleteConversation: async (projectId, chatId) => {
    // Delete from SQLite
    try {
      await dbService.deleteChat(projectId, chatId);
    } catch (e) {
      console.error("Failed to delete chat from DB:", e);
    }

    const { currentChatId, conversations } = get();
    const filtered = conversations.filter((c) => c.id !== chatId);
    const updates: Partial<ChatHistoryState> = {
      conversations: sortConversations(filtered),
    };

    // If we deleted the active chat, clear it
    if (currentChatId === chatId) {
      updates.currentChatId = null;
    }

    set(updates);
  },

  // Rename a conversation
  renameConversation: async (projectId, chatId, newTitle) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    // Update in SQLite
    try {
      await dbService.updateChatTitle(chatId, trimmed);
    } catch (e) {
      console.error("Failed to rename chat in DB:", e);
    }

    const { conversations } = get();
    const updatedList = conversations.map((c) =>
      c.id === chatId ? { ...c, title: trimmed } : c
    );
    set({ conversations: sortConversations(updatedList) });
  },

  // Toggle pin on a conversation
  pinConversation: async (projectId, chatId) => {
    const { conversations } = get();
    const conv = conversations.find((c) => c.id === chatId);
    if (!conv) return;

    const newPinned = !conv.isPinned;

    // Update in SQLite
    try {
      await dbService.updateChatPinned(chatId, newPinned);
    } catch (e) {
      console.error("Failed to update pin in DB:", e);
    }

    const updatedList = conversations.map((c) =>
      c.id === chatId ? { ...c, isPinned: newPinned } : c
    );
    set({ conversations: sortConversations(updatedList) });
  },

  // Export a conversation as Markdown and trigger download
  exportConversation: (chatId) => {
    const { conversations } = get();
    const conv = conversations.find((c) => c.id === chatId);
    if (!conv) return;

    // Build markdown content
    const lines: string[] = [];
    lines.push(`# ${conv.title}`);
    lines.push(`_Exported ${new Date().toLocaleString()}_`);
    lines.push("");

    conv.messages.forEach((msg) => {
      const role = msg.role === "user" ? "**You**" : "**AI**";
      const time = new Date(msg.timestamp).toLocaleString();
      lines.push(`### ${role} \u2014 ${time}`);
      lines.push("");
      lines.push(msg.content);
      lines.push("");
      lines.push("---");
      lines.push("");
    });

    const markdown = lines.join("\n");

    // Trigger download
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${conv.title.replace(/[^a-zA-Z0-9 ]/g, "").replace(/\s+/g, "-").toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // Get conversations filtered by search query
  getFilteredConversations: () => {
    const { conversations, searchQuery } = get();
    if (!searchQuery.trim()) return conversations;

    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  },
}));