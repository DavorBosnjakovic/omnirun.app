import { create } from "zustand";

export interface MessageImage {
  id: string;
  base64: string;     // base64-encoded image data (without the data:... prefix)
  mimeType: string;   // e.g. "image/png", "image/jpeg"
  name?: string;       // optional filename for drag-dropped files
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  images?: MessageImage[];
}

interface ChatState {
  messages: Message[];
  isLoading: boolean;
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  clearMessages: () => void;
  setLoading: (loading: boolean) => void;
}

export const useChatStore = create<ChatState>((set) => ({
  messages: [],
  isLoading: false,
  addMessage: (message) =>
    set((state) => ({
      messages: [...state.messages, message],
    })),
  setMessages: (messages) => set({ messages }),
  clearMessages: () => set({ messages: [] }),
  setLoading: (loading) => set({ isLoading: loading }),
}));