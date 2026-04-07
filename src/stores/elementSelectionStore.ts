import { create } from "zustand";

export interface SelectedElement {
  selector: string;
  tagName: string;
  textContent: string;
  computedStyles: {
    color: string;
    backgroundColor: string;
    fontFamily: string;
    fontSize: string;
    fontWeight: string;
    padding: string;
    margin: string;
    borderRadius: string;
  };
  rect: { top: number; left: number; width: number; height: number };
}

interface ElementSelectionState {
  selectMode: boolean;
  selectedElements: SelectedElement[];
  pendingChatInput: string | null;
  pendingImage: { base64: string; mimeType: string } | null;

  setSelectMode: (on: boolean) => void;
  setSelectedElements: (elements: SelectedElement[]) => void;
  addSelectedElement: (element: SelectedElement) => void;
  clearSelection: () => void;
  setPendingChatInput: (message: string | null) => void;
  setPendingImage: (img: { base64: string; mimeType: string } | null) => void;
}

export const useElementSelectionStore = create<ElementSelectionState>((set) => ({
  selectMode: false,
  selectedElements: [],
  pendingChatInput: null,
  pendingImage: null,

  setSelectMode: (on) => set({ selectMode: on, selectedElements: [], pendingChatInput: null, pendingImage: null }),
  setSelectedElements: (elements) => set({ selectedElements: elements }),
  addSelectedElement: (element) =>
    set((state) => ({ selectedElements: [...state.selectedElements, element] })),
  clearSelection: () => set({ selectedElements: [], pendingChatInput: null, pendingImage: null }),
  setPendingChatInput: (message) => set({ pendingChatInput: message }),
  setPendingImage: (img) => set({ pendingImage: img }),
}));