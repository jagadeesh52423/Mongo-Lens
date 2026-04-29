import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useEditorBridgeStore } from './editorBridge';

beforeEach(() => {
  useEditorBridgeStore.setState({ controller: null, hasSelection: false });
});

describe('editorBridge store', () => {
  it('starts with null controller and no selection', () => {
    const s = useEditorBridgeStore.getState();
    expect(s.controller).toBeNull();
    expect(s.hasSelection).toBe(false);
  });

  it('registers and clears the controller', () => {
    const ctrl = {
      replaceSelection: vi.fn(),
      insertAtCursor: vi.fn(),
      appendToEnd: vi.fn(),
      focus: vi.fn(),
    };
    useEditorBridgeStore.getState().setController(ctrl);
    expect(useEditorBridgeStore.getState().controller).toBe(ctrl);
    useEditorBridgeStore.getState().setController(null);
    expect(useEditorBridgeStore.getState().controller).toBeNull();
  });

  it('updates hasSelection', () => {
    useEditorBridgeStore.getState().setHasSelection(true);
    expect(useEditorBridgeStore.getState().hasSelection).toBe(true);
    useEditorBridgeStore.getState().setHasSelection(false);
    expect(useEditorBridgeStore.getState().hasSelection).toBe(false);
  });
});
