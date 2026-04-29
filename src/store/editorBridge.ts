import { create } from 'zustand';

// implement this interface to add a new editor that can receive AI-driven mutations
export interface EditorController {
  replaceSelection(text: string): void;
  insertAtCursor(text: string): void;
  appendToEnd(text: string): void;
  focus(): void;
}

interface EditorBridgeState {
  controller: EditorController | null;
  hasSelection: boolean;
  setController: (c: EditorController | null) => void;
  setHasSelection: (v: boolean) => void;
}

export const useEditorBridgeStore = create<EditorBridgeState>((set) => ({
  controller: null,
  hasSelection: false,
  setController: (controller) => set({ controller }),
  setHasSelection: (hasSelection) => set({ hasSelection }),
}));
