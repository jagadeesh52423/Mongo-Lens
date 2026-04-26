# Save/Save As Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add "Save" (update existing) and "Save As" (create new) buttons to script editor with proper state tracking

**Architecture:** Extend EditorTab with optional savedScriptId/savedScriptTags fields, split ContextBar save button into two side-by-side buttons, track script association through tab lifecycle

**Tech Stack:** React, TypeScript, Zustand, Tauri IPC

---

## File Structure

**Files to modify:**
- `src/types.ts` — Add `savedScriptId` and `savedScriptTags` to EditorTab interface
- `src/components/saved-scripts/SavedScriptsPanel.tsx` — Set savedScriptId when opening from saved script
- `src/components/editor/ContextBar.tsx` — Split save into two buttons, conditionally render "Save"
- `src/components/editor/EditorArea.tsx` — Split handleSave into two handlers
- `src/__tests__/saved-scripts.test.tsx` — Add tests for savedScriptId behavior
- `src/__tests__/editor-area.test.tsx` — Add tests for Save/Save As handlers

**Existing dependencies (no changes):**
- `src/ipc.ts` — Already has `updateScript` (line 102-110)
- `src/components/saved-scripts/SaveScriptDialog.tsx` — Reuse for "Save As" prompt

---

### Task 1: Update EditorTab Type

**Files:**
- Modify: `src/types.ts:40-49`
- Test: `src/__tests__/types.test.tsx` (new file)

- [ ] **Step 1: Write failing test for EditorTab with savedScriptId**

Create `src/__tests__/types.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
import type { EditorTab } from '../types';

describe('EditorTab type', () => {
  it('should allow savedScriptId and savedScriptTags as optional fields', () => {
    const tabWithSavedScript: EditorTab = {
      id: 'script:abc-123',
      title: 'My Script',
      content: 'db.users.find({})',
      isDirty: false,
      type: 'script',
      connectionId: 'conn-1',
      database: 'testdb',
      savedScriptId: 'abc-123',
      savedScriptTags: 'query,users',
    };

    expect(tabWithSavedScript.savedScriptId).toBe('abc-123');
    expect(tabWithSavedScript.savedScriptTags).toBe('query,users');
  });

  it('should allow EditorTab without savedScriptId', () => {
    const tabWithoutSavedScript: EditorTab = {
      id: 'script:new-1',
      title: 'Untitled',
      content: '',
      isDirty: false,
      type: 'script',
    };

    expect(tabWithoutSavedScript.savedScriptId).toBeUndefined();
    expect(tabWithoutSavedScript.savedScriptTags).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test types.test.tsx`
Expected: Type error — savedScriptId and savedScriptTags do not exist on EditorTab

- [ ] **Step 3: Add savedScriptId and savedScriptTags to EditorTab**

Edit `src/types.ts:40-49`:

```typescript
export interface EditorTab {
  id: string;
  title: string;
  content: string;
  isDirty: boolean;
  type: 'script';
  connectionId?: string;
  database?: string;
  collection?: string;
  savedScriptId?: string;
  savedScriptTags?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test types.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/__tests__/types.test.tsx
git commit -m "feat(types): add savedScriptId and savedScriptTags to EditorTab"
```

---

### Task 2: Update SavedScriptsPanel to Set savedScriptId

**Files:**
- Modify: `src/components/saved-scripts/SavedScriptsPanel.tsx:77-86`
- Test: `src/__tests__/saved-scripts.test.tsx`

- [ ] **Step 1: Write failing test for savedScriptId on open**

Edit `src/__tests__/saved-scripts.test.tsx` and add:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SavedScriptsPanel } from '../components/saved-scripts/SavedScriptsPanel';
import * as ipc from '../ipc';
import { useEditorStore } from '../store/editor';

vi.mock('../ipc');

describe('SavedScriptsPanel savedScriptId', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null });
    vi.mocked(ipc.listScripts).mockResolvedValue([
      {
        id: 'script-1',
        name: 'Test Script',
        content: 'db.test.find({})',
        tags: 'test',
        connectionId: 'conn-1',
        createdAt: '2026-04-27T00:00:00Z',
      },
    ]);
  });

  it('should set savedScriptId and savedScriptTags when opening saved script', async () => {
    render(<SavedScriptsPanel />);
    await waitFor(() => screen.getByText('Test Script'));
    
    await userEvent.click(screen.getByText('Test Script'));
    
    const tabs = useEditorStore.getState().tabs;
    expect(tabs).toHaveLength(1);
    expect(tabs[0].savedScriptId).toBe('script-1');
    expect(tabs[0].savedScriptTags).toBe('test');
    expect(tabs[0].isDirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test saved-scripts.test.tsx`
Expected: FAIL — savedScriptId is undefined

- [ ] **Step 3: Update open() to include savedScriptId and savedScriptTags**

Edit `src/components/saved-scripts/SavedScriptsPanel.tsx:77-86`:

```typescript
function open(s: SavedScript) {
  const tab: EditorTab = {
    id: `script:${s.id}`,
    title: s.name,
    content: s.content,
    isDirty: false,
    type: 'script',
    savedScriptId: s.id,
    savedScriptTags: s.tags,
  };
  openTab(tab);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test saved-scripts.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/saved-scripts/SavedScriptsPanel.tsx src/__tests__/saved-scripts.test.tsx
git commit -m "feat(saved-scripts): set savedScriptId and savedScriptTags when opening script"
```

---

### Task 3: Split EditorArea Save Handlers

**Files:**
- Modify: `src/components/editor/EditorArea.tsx:119-123`
- Test: `src/__tests__/editor-area.test.tsx`

- [ ] **Step 1: Write failing tests for Save and Save As handlers**

Edit `src/__tests__/editor-area.test.tsx` and add:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorArea } from '../components/editor/EditorArea';
import * as ipc from '../ipc';
import { useEditorStore } from '../store/editor';
import { useConnectionsStore } from '../store/connections';

vi.mock('../ipc');

describe('EditorArea Save/Save As handlers', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null, savedScriptsVersion: 0 });
    useConnectionsStore.setState({
      connections: [{ id: 'conn-1', name: 'Test', createdAt: '2026-01-01' }],
      connectedIds: new Set(['conn-1']),
      activeConnectionId: 'conn-1',
      activeDatabase: 'testdb',
    });
    vi.mocked(ipc.listDatabases).mockResolvedValue(['testdb']);
  });

  it('handleSave should call updateScript with existing metadata', async () => {
    const updateScriptMock = vi.mocked(ipc.updateScript).mockResolvedValue({
      id: 'script-1',
      name: 'Existing Script',
      content: 'db.test.find({updated: true})',
      tags: 'original,tags',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T00:00:00Z',
    });

    useEditorStore.setState({
      tabs: [{
        id: 'tab-1',
        title: 'Existing Script',
        content: 'db.test.find({updated: true})',
        isDirty: true,
        type: 'script',
        connectionId: 'conn-1',
        database: 'testdb',
        savedScriptId: 'script-1',
        savedScriptTags: 'original,tags',
      }],
      activeTabId: 'tab-1',
    });

    render(<EditorArea />);
    await waitFor(() => screen.getByText('Existing Script'));

    const saveButton = screen.getByRole('button', { name: /^Save$/i });
    await userEvent.click(saveButton);

    expect(updateScriptMock).toHaveBeenCalledWith(
      'script-1',
      'Existing Script',
      'db.test.find({updated: true})',
      'original,tags',
      'conn-1'
    );
    
    const tab = useEditorStore.getState().tabs[0];
    expect(tab.isDirty).toBe(false);
  });

  it('handleSaveAs should prompt, create script, and update tab', async () => {
    vi.mocked(ipc.createScript).mockResolvedValue({
      id: 'new-script-id',
      name: 'New Script Name',
      content: 'db.test.find({})',
      tags: '',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T01:00:00Z',
    });

    useEditorStore.setState({
      tabs: [{
        id: 'tab-2',
        title: 'Untitled',
        content: 'db.test.find({})',
        isDirty: true,
        type: 'script',
        connectionId: 'conn-1',
        database: 'testdb',
      }],
      activeTabId: 'tab-2',
    });

    render(<EditorArea />);
    await waitFor(() => screen.getByText('Untitled'));

    const saveAsButton = screen.getByRole('button', { name: /Save As/i });
    await userEvent.click(saveAsButton);

    // Dialog should appear
    await waitFor(() => screen.getByRole('dialog'));
    
    const nameInput = screen.getByLabelText(/Name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'New Script Name');
    
    const saveDialogButton = screen.getByRole('button', { name: /^Save$/i });
    await userEvent.click(saveDialogButton);

    await waitFor(() => {
      expect(vi.mocked(ipc.createScript)).toHaveBeenCalledWith(
        'New Script Name',
        'db.test.find({})',
        '',
        'conn-1'
      );
    });

    const tab = useEditorStore.getState().tabs[0];
    expect(tab.savedScriptId).toBe('new-script-id');
    expect(tab.title).toBe('New Script Name');
    expect(tab.isDirty).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test editor-area.test.tsx`
Expected: FAIL — handleSave and handleSaveAs do not exist, buttons not found

- [ ] **Step 3: Split handleSave into two handlers**

Edit `src/components/editor/EditorArea.tsx`, replace lines 119-123 with:

```typescript
async function handleSave() {
  if (!active || active.type !== 'script' || !active.savedScriptId) return;
  try {
    const updated = await updateScript(
      active.savedScriptId,
      active.title,
      active.content,
      active.savedScriptTags ?? '',
      active.connectionId
    );
    updateTab(active.id, {
      isDirty: false,
      savedScriptTags: updated.tags,
    });
    bumpScriptsVersion();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    alert(`Failed to save: ${msg}\n\nTry "Save As" to create a new script instead.`);
  }
}

async function handleSaveAs(name: string, tags: string) {
  if (!active || active.type !== 'script') return;
  const created = await createScript(name, active.content, tags, active.connectionId);
  updateTab(active.id, {
    title: name,
    savedScriptId: created.id,
    savedScriptTags: created.tags,
    isDirty: false,
  });
  bumpScriptsVersion();
}
```

Add import for updateScript at top of file:

```typescript
import { runScript, cancelScript, createScript, updateScript } from '../../ipc';
```

- [ ] **Step 4: Update ContextBar props to pass both handlers**

Edit `src/components/editor/EditorArea.tsx`, find ContextBar usage (around line 197-209) and update:

```typescript
{active?.type === 'script' && (
  <ContextBar
    tabId={active.id}
    connectionId={active.connectionId}
    database={active.database}
    onConnectionChange={(id) =>
      updateTab(active.id, { connectionId: id, database: undefined })
    }
    onDatabaseChange={(db) => updateTab(active.id, { database: db })}
    modes={getExecutionModes()}
    onExecute={handleExecute}
    onSave={handleSave}
    onSaveAs={handleSaveAs}
    hasSavedScript={!!active.savedScriptId}
    isRunning={isRunning}
  />
)}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test editor-area.test.tsx`
Expected: FAIL — ContextBar does not accept onSaveAs/hasSavedScript props yet

Note: Test will pass after Task 4

- [ ] **Step 6: Commit**

```bash
git add src/components/editor/EditorArea.tsx src/__tests__/editor-area.test.tsx
git commit -m "feat(editor): split handleSave into Save and Save As handlers"
```

---

### Task 4: Update ContextBar to Show Save and Save As Buttons

**Files:**
- Modify: `src/components/editor/ContextBar.tsx:7-17,162-179`
- Test: `src/__tests__/context-bar.test.tsx` (new file)

- [ ] **Step 1: Write failing test for conditional Save button rendering**

Create `src/__tests__/context-bar.test.tsx`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextBar } from '../components/editor/ContextBar';
import { useConnectionsStore } from '../store/connections';

vi.mock('../ipc');

describe('ContextBar Save/Save As buttons', () => {
  const mockProps = {
    tabId: 'tab-1',
    connectionId: 'conn-1',
    database: 'testdb',
    onConnectionChange: vi.fn(),
    onDatabaseChange: vi.fn(),
    modes: [],
    onExecute: vi.fn(),
    onSave: vi.fn(),
    onSaveAs: vi.fn(),
    isRunning: false,
  };

  beforeEach(() => {
    useConnectionsStore.setState({
      connections: [{ id: 'conn-1', name: 'Test', createdAt: '2026-01-01' }],
      connectedIds: new Set(['conn-1']),
    });
  });

  it('should show both Save and Save As when hasSavedScript is true', () => {
    render(<ContextBar {...mockProps} hasSavedScript={true} />);
    
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save As/i })).toBeInTheDocument();
  });

  it('should show only Save As when hasSavedScript is false', () => {
    render(<ContextBar {...mockProps} hasSavedScript={false} />);
    
    expect(screen.queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save As/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test context-bar.test.tsx`
Expected: FAIL — hasSavedScript prop does not exist, buttons not rendered correctly

- [ ] **Step 3: Update ContextBar Props interface**

Edit `src/components/editor/ContextBar.tsx:7-17`:

```typescript
interface Props {
  tabId: string;
  connectionId: string | undefined;
  database: string | undefined;
  onConnectionChange: (id: string) => void;
  onDatabaseChange: (db: string) => void;
  modes: readonly ExecutionMode[];
  onExecute: (modeId: string) => void;
  onSave: () => Promise<void>;
  onSaveAs: (name: string, tags: string) => Promise<void>;
  hasSavedScript: boolean;
  isRunning: boolean;
}
```

- [ ] **Step 4: Update ContextBar implementation to use new props**

Edit `src/components/editor/ContextBar.tsx:39-49`:

```typescript
export function ContextBar({
  tabId,
  connectionId,
  database,
  onConnectionChange,
  onDatabaseChange,
  modes,
  onExecute,
  onSave,
  onSaveAs,
  hasSavedScript,
  isRunning,
}: Props) {
```

- [ ] **Step 5: Replace save button with conditional Save and Save As buttons**

Edit `src/components/editor/ContextBar.tsx:162-179`, replace button and dialog section with:

```typescript
      <div style={{ flex: 1 }} />
      {hasSavedScript && (
        <button onClick={async () => { await onSave(); }}>Save</button>
      )}
      <button onClick={() => setSaving(true)}>Save As</button>
      {modes.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onExecute(mode.id)}
          disabled={!canRun}
          style={buttonStyleFor(mode.buttonStyle, canRun)}
        >
          {mode.label}
        </button>
      ))}
    </div>
    {saving && (
      <SaveScriptDialog
        onSave={async (name, tags) => { await onSaveAs(name, tags); setSaving(false); }}
        onCancel={() => setSaving(false)}
      />
    )}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test context-bar.test.tsx`
Expected: PASS

- [ ] **Step 7: Run editor-area tests again**

Run: `npm test editor-area.test.tsx`
Expected: PASS (now that ContextBar accepts new props)

- [ ] **Step 8: Commit**

```bash
git add src/components/editor/ContextBar.tsx src/__tests__/context-bar.test.tsx
git commit -m "feat(context-bar): split save button into Save and Save As"
```

---

### Task 5: Integration Test - Full Save/Save As Flow

**Files:**
- Test: `src/__tests__/integration/save-flow.test.tsx` (new file)

- [ ] **Step 1: Write integration test for complete flow**

Create `src/__tests__/integration/save-flow.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorArea } from '../../components/editor/EditorArea';
import { SavedScriptsPanel } from '../../components/saved-scripts/SavedScriptsPanel';
import * as ipc from '../../ipc';
import { useEditorStore } from '../../store/editor';
import { useConnectionsStore } from '../../store/connections';

vi.mock('../../ipc');

describe('Save/Save As integration flow', () => {
  beforeEach(() => {
    useEditorStore.setState({ tabs: [], activeTabId: null, savedScriptsVersion: 0 });
    useConnectionsStore.setState({
      connections: [{ id: 'conn-1', name: 'Test Conn', createdAt: '2026-01-01' }],
      connectedIds: new Set(['conn-1']),
      activeConnectionId: 'conn-1',
      activeDatabase: 'testdb',
    });
    vi.mocked(ipc.listDatabases).mockResolvedValue(['testdb']);
  });

  it('should open saved script, edit, save, then save as new', async () => {
    // Setup: saved script exists
    vi.mocked(ipc.listScripts).mockResolvedValue([{
      id: 'original-id',
      name: 'Original Script',
      content: 'db.users.find({})',
      tags: 'users',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T00:00:00Z',
    }]);

    // Open from SavedScriptsPanel
    render(
      <>
        <SavedScriptsPanel />
        <EditorArea />
      </>
    );
    await waitFor(() => screen.getByText('Original Script'));
    await userEvent.click(screen.getByText('Original Script'));

    // Verify tab opened with savedScriptId
    let tab = useEditorStore.getState().tabs[0];
    expect(tab.savedScriptId).toBe('original-id');
    expect(tab.isDirty).toBe(false);

    // Edit content
    const editor = await waitFor(() => screen.getByRole('textbox'));
    await userEvent.clear(editor);
    await userEvent.type(editor, 'db.users.find({updated: true})');

    tab = useEditorStore.getState().tabs[0];
    expect(tab.isDirty).toBe(true);

    // Save (update existing)
    vi.mocked(ipc.updateScript).mockResolvedValue({
      id: 'original-id',
      name: 'Original Script',
      content: 'db.users.find({updated: true})',
      tags: 'users',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T00:00:00Z',
    });

    const saveButton = screen.getByRole('button', { name: /^Save$/i });
    await userEvent.click(saveButton);

    await waitFor(() => {
      tab = useEditorStore.getState().tabs[0];
      expect(tab.isDirty).toBe(false);
    });
    expect(vi.mocked(ipc.updateScript)).toHaveBeenCalledWith(
      'original-id',
      'Original Script',
      'db.users.find({updated: true})',
      'users',
      'conn-1'
    );

    // Edit again
    await userEvent.type(editor, '\n// modified again');
    tab = useEditorStore.getState().tabs[0];
    expect(tab.isDirty).toBe(true);

    // Save As (create new)
    vi.mocked(ipc.createScript).mockResolvedValue({
      id: 'new-id',
      name: 'Modified Copy',
      content: 'db.users.find({updated: true})\n// modified again',
      tags: '',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T01:00:00Z',
    });

    const saveAsButton = screen.getByRole('button', { name: /Save As/i });
    await userEvent.click(saveAsButton);

    await waitFor(() => screen.getByRole('dialog'));
    const nameInput = screen.getByLabelText(/Name/i);
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Modified Copy');
    const saveDialogButton = screen.getByRole('button', { name: /^Save$/i });
    await userEvent.click(saveDialogButton);

    await waitFor(() => {
      tab = useEditorStore.getState().tabs[0];
      expect(tab.savedScriptId).toBe('new-id');
      expect(tab.title).toBe('Modified Copy');
      expect(tab.isDirty).toBe(false);
    });
  });

  it('should open from collection, save as, then save updates the created script', async () => {
    // Open tab from collection (no savedScriptId)
    useEditorStore.getState().openTab({
      id: 'tab-1',
      title: 'users',
      content: 'db.getCollection("users").find({})',
      isDirty: false,
      type: 'script',
      connectionId: 'conn-1',
      database: 'testdb',
      collection: 'users',
    });

    render(<EditorArea />);
    await waitFor(() => screen.getByText('users'));

    // Verify no "Save" button, only "Save As"
    expect(screen.queryByRole('button', { name: /^Save$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Save As/i })).toBeInTheDocument();

    // Edit content
    const editor = await waitFor(() => screen.getByRole('textbox'));
    await userEvent.type(editor, '\n// added filter');

    // Save As
    vi.mocked(ipc.createScript).mockResolvedValue({
      id: 'created-id',
      name: 'User Query',
      content: 'db.getCollection("users").find({})\n// added filter',
      tags: '',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T02:00:00Z',
    });

    const saveAsButton = screen.getByRole('button', { name: /Save As/i });
    await userEvent.click(saveAsButton);

    await waitFor(() => screen.getByRole('dialog'));
    const nameInput = screen.getByLabelText(/Name/i);
    await userEvent.type(nameInput, 'User Query');
    const saveDialogButton = screen.getByRole('button', { name: /^Save$/i });
    await userEvent.click(saveDialogButton);

    await waitFor(() => {
      const tab = useEditorStore.getState().tabs[0];
      expect(tab.savedScriptId).toBe('created-id');
      expect(tab.title).toBe('User Query');
    });

    // Now "Save" button should appear
    await waitFor(() => screen.getByRole('button', { name: /^Save$/i }));

    // Edit and Save (should update created-id)
    await userEvent.type(editor, '\n// more changes');

    vi.mocked(ipc.updateScript).mockResolvedValue({
      id: 'created-id',
      name: 'User Query',
      content: 'db.getCollection("users").find({})\n// added filter\n// more changes',
      tags: '',
      connectionId: 'conn-1',
      createdAt: '2026-04-27T02:00:00Z',
    });

    const saveButton = screen.getByRole('button', { name: /^Save$/i });
    await userEvent.click(saveButton);

    await waitFor(() => {
      expect(vi.mocked(ipc.updateScript)).toHaveBeenCalledWith(
        'created-id',
        'User Query',
        expect.stringContaining('more changes'),
        '',
        'conn-1'
      );
    });
  });
});
```

- [ ] **Step 2: Run integration test**

Run: `npm test save-flow.test.tsx`
Expected: PASS (all steps working together)

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/integration/save-flow.test.tsx
git commit -m "test(integration): add Save/Save As end-to-end flow tests"
```

---

### Task 6: Manual Testing

**Files:**
- None (manual verification)

- [ ] **Step 1: Start dev server**

Run: `npm run tauri dev`
Expected: App opens

- [ ] **Step 2: Test opening saved script and saving**

1. Connect to a MongoDB instance
2. Open an existing saved script from SavedScriptsPanel
3. Verify "Save" and "Save As" buttons appear in ContextBar
4. Edit the script content
5. Click "Save" (no prompt should appear)
6. Verify script updates in SavedScriptsPanel

Expected: Silent update, no prompt

- [ ] **Step 3: Test Save As from saved script**

1. With same script open, edit it again
2. Click "Save As"
3. Enter new name in dialog
4. Click Save in dialog
5. Verify tab title changes to new name
6. Verify "Save" button still appears

Expected: New script created, tab now associated with new script

- [ ] **Step 4: Test opening from collection and Save As**

1. Double-click a collection in connection tree
2. Verify only "Save As" button appears (no "Save")
3. Edit the generated query
4. Click "Save As"
5. Enter name
6. Verify "Save" button now appears after successful Save As

Expected: Tab gains savedScriptId after Save As

- [ ] **Step 5: Test Save after Save As**

1. With same tab, edit content
2. Click "Save"
3. Verify updates apply to script created in Step 4

Expected: Updates the script, not creates new one

- [ ] **Step 6: Test error handling**

1. Open a saved script
2. In another tool/session, delete that script from DB
3. Edit and click "Save" in app
4. Verify error message suggests "Save As"

Expected: Error alert with helpful message

- [ ] **Step 7: Document results**

Create `TEST_REPORT.md` in project root:

```markdown
# Save/Save As Manual Test Report

Date: 2026-04-27
Tester: [Your Name]

## Test Scenarios

### 1. Open Saved Script and Save
- [ ] Opened saved script
- [ ] Both "Save" and "Save As" buttons visible
- [ ] Edited content
- [ ] Clicked "Save" (no prompt)
- [ ] Script updated in SavedScriptsPanel
- Result: PASS/FAIL

### 2. Save As from Saved Script
- [ ] Edited saved script
- [ ] Clicked "Save As"
- [ ] Dialog appeared with name field
- [ ] Entered new name
- [ ] New script created
- [ ] Tab title updated
- [ ] "Save" button still visible
- Result: PASS/FAIL

### 3. Open from Collection and Save As
- [ ] Double-clicked collection
- [ ] Only "Save As" button visible
- [ ] Edited query
- [ ] Clicked "Save As"
- [ ] Entered name
- [ ] "Save" button appeared after success
- Result: PASS/FAIL

### 4. Save After Save As
- [ ] Continued from scenario 3
- [ ] Edited content
- [ ] Clicked "Save"
- [ ] Script updated (not new script created)
- Result: PASS/FAIL

### 5. Error Handling
- [ ] Opened saved script
- [ ] Deleted script externally
- [ ] Edited and clicked "Save"
- [ ] Error alert appeared
- [ ] Message suggested "Save As"
- Result: PASS/FAIL

## Notes

[Any additional observations or issues]
```

- [ ] **Step 8: Commit test report**

```bash
git add TEST_REPORT.md
git commit -m "docs: manual test report for Save/Save As"
```

---

## Completion

All tasks complete. The Save/Save As functionality is now implemented with:
- ✅ Type definitions updated
- ✅ SavedScriptsPanel sets savedScriptId on open
- ✅ EditorArea has separate Save and Save As handlers
- ✅ ContextBar conditionally renders Save button
- ✅ Unit tests for each component
- ✅ Integration tests for full flow
- ✅ Manual testing checklist

Run full test suite: `npm test`
Start app: `npm run tauri dev`
