# Connections Panel — Connect Launcher & Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Connections panel's flat list of raw-button rows with a calm "empty-on-open" panel fronted by an accent **Connect** launcher (a dropdown of not-yet-connected connections), showing connected connections + their DB/collection trees below.

**Architecture:** A new presentational `ConnectLauncher` (button + anchored popover) driven by props from `ConnectionPanel`. A pure `connectionSummary(target)` registry derives each row's subtitle. `ConnectionPanel` filters the store's `connections` into `available` (feeds the launcher) and `connected` (renders in the body, borderless, with the existing `ConnectionTree`). No store/IPC/dialog changes.

**Tech Stack:** React 18 + TypeScript, Zustand store (`useConnectionsV2`), CSS Modules + design tokens (`src/styles/tokens.css`), Vitest + Testing Library (`@testing-library/react`, `userEvent`), global `invoke` mock in `src/__tests__/setup.ts`.

**Spec:** `docs/superpowers/specs/2026-05-29-connections-panel-connect-launcher-design.md`

**Not applicable:** The project's "harness deployment after editing `runner/*.js`" rule (CLAUDE.md) does NOT apply — this plan touches no `runner/` files.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/components/features/connections/connectionSummary.ts` | **new** — pure `target → subtitle` registry keyed by `target.kind` |
| `src/components/features/connections/__tests__/connectionSummary.test.ts` | **new** — unit tests |
| `src/components/features/connections/ConnectLauncher.tsx` | **new** — accent Connect button + anchored dropdown popover |
| `src/components/features/connections/ConnectLauncher.module.css` | **new** — launcher + menu styling (tokens only) |
| `src/components/features/connections/__tests__/ConnectLauncher.test.tsx` | **new** — component tests |
| `src/styles/tokens.css` | **modify** — add `--connect-btn-h`, `--conn-row-h` sticky metrics |
| `src/components/features/connections/ConnectionPanel.tsx` | **modify** — launcher at top; body = connected-only; conditional context menu; drop raw buttons |
| `src/components/features/connections/ConnectionPanel.module.css` | **modify** — remove divider; borderless rows; env dot + live glow; group label; sticky offset |
| `src/components/features/connections/ConnectionTree.module.css` | **modify** — DB-row sticky offset accounts for the launcher height |
| `src/__tests__/connection-panel.test.tsx` | **modify** — launcher-based load + duplicate flow |
| `src/components/features/connections/__tests__/connection-tree.test.tsx` | **modify** — env color now on the dot of a *connected* row |

---

## Task 1: `connectionSummary` helper (pure, tested)

**Files:**
- Create: `src/components/features/connections/connectionSummary.ts`
- Test: `src/components/features/connections/__tests__/connectionSummary.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/components/features/connections/__tests__/connectionSummary.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { connectionSummary } from '../connectionSummary';

describe('connectionSummary', () => {
  it('formats a direct target as host:port', () => {
    expect(connectionSummary({ kind: 'direct', host: 'localhost', port: 27017 }))
      .toBe('localhost:27017');
  });

  it('appends the replica set when present', () => {
    expect(connectionSummary({ kind: 'direct', host: 'db', port: 27017, replicaSet: 'rs0' }))
      .toBe('db:27017 · rs0');
  });

  it('passes a credential-free URI through unchanged', () => {
    expect(connectionSummary({ kind: 'uri', uri: 'mongodb://localhost:27017' }))
      .toBe('mongodb://localhost:27017');
  });

  it('redacts user:pass credentials from a URI authority', () => {
    expect(connectionSummary({ kind: 'uri', uri: 'mongodb+srv://alice:s3cret@cluster.example.net/app' }))
      .toBe('mongodb+srv://cluster.example.net/app');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/features/connections/__tests__/connectionSummary.test.ts`
Expected: FAIL — `Failed to resolve import "../connectionSummary"`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/features/connections/connectionSummary.ts`:

```ts
import type { ConnectionTarget } from '../../../connection/model';

/** Strip credentials from a Mongo URI authority: scheme://user:pass@host → scheme://host. */
function redactUri(uri: string): string {
  return uri.replace(/(\/\/)[^/@]*@/, '$1');
}

// One formatter per target kind. `satisfies` makes the compiler fail if a new
// ConnectionTarget kind is added without a matching formatter (extension contract).
// To support a new target kind: add its entry here. No other changes needed.
const SUMMARY_BY_KIND = {
  uri: (t: Extract<ConnectionTarget, { kind: 'uri' }>) => redactUri(t.uri),
  direct: (t: Extract<ConnectionTarget, { kind: 'direct' }>) =>
    `${t.host}:${t.port}${t.replicaSet ? ` · ${t.replicaSet}` : ''}`,
} satisfies { [K in ConnectionTarget['kind']]: (t: Extract<ConnectionTarget, { kind: K }>) => string };

/** Human-readable one-line summary of a connection's target, for list subtitles. */
export function connectionSummary(target: ConnectionTarget): string {
  return (SUMMARY_BY_KIND[target.kind] as (t: ConnectionTarget) => string)(target);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/features/connections/__tests__/connectionSummary.test.ts`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/components/features/connections/connectionSummary.ts \
        src/components/features/connections/__tests__/connectionSummary.test.ts
git commit -m "feat(connections): add connectionSummary target→subtitle helper"
```

---

## Task 2: `ConnectLauncher` component

**Files:**
- Create: `src/components/features/connections/ConnectLauncher.tsx`
- Create: `src/components/features/connections/ConnectLauncher.module.css`
- Test: `src/components/features/connections/__tests__/ConnectLauncher.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/features/connections/__tests__/ConnectLauncher.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectLauncher } from '../ConnectLauncher';
import type { Connection } from '../../../../connection/model';

const conn = (id: string, name: string, extra: Partial<Connection> = {}): Connection => ({
  id, name,
  target: { kind: 'direct', host: 'localhost', port: 27017 },
  auth: { kind: 'none' },
  createdAt: 't',
  ...extra,
});

function setup(over: Partial<React.ComponentProps<typeof ConnectLauncher>> = {}) {
  const onConnect = vi.fn();
  const onNewConnection = vi.fn();
  const onItemContextMenu = vi.fn();
  render(
    <ConnectLauncher
      available={over.available ?? [conn('1', 'local-dev')]}
      hasAnySaved={over.hasAnySaved ?? true}
      onConnect={onConnect}
      onNewConnection={onNewConnection}
      onItemContextMenu={onItemContextMenu}
    />,
  );
  return { onConnect, onNewConnection, onItemContextMenu };
}

describe('ConnectLauncher', () => {
  it('starts closed and opens on trigger click', async () => {
    const user = userEvent.setup();
    setup();
    const trigger = screen.getByRole('button', { name: 'Connect' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('local-dev')).not.toBeInTheDocument();
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('local-dev')).toBeInTheDocument();
  });

  it('renders each available connection with its target subtitle', async () => {
    const user = userEvent.setup();
    setup({ available: [conn('1', 'local-dev'), conn('2', 'prod', { target: { kind: 'uri', uri: 'mongodb+srv://prod.acme' } })] });
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByText('localhost:27017')).toBeInTheDocument();
    expect(screen.getByText('mongodb+srv://prod.acme')).toBeInTheDocument();
  });

  it('shows an SSH badge when the connection is tunneled', async () => {
    const user = userEvent.setup();
    setup({ available: [conn('1', 'tunneled', { ssh: { host: 'bastion', port: 22, user: 'me', auth: { kind: 'agent' }, knownHostsPolicy: 'strict' } })] });
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByText('SSH')).toBeInTheDocument();
  });

  it('calls onConnect and closes when an item is clicked', async () => {
    const user = userEvent.setup();
    const { onConnect } = setup();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.click(screen.getByText('local-dev'));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
    expect(screen.queryByText('local-dev')).not.toBeInTheDocument();
  });

  it('calls onItemContextMenu and closes on right-click of an item', async () => {
    const user = userEvent.setup();
    const { onItemContextMenu } = setup();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('local-dev') });
    expect(onItemContextMenu).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }), expect.any(Number), expect.any(Number));
    expect(screen.queryByText('local-dev')).not.toBeInTheDocument();
  });

  it('calls onNewConnection from the New connection entry', async () => {
    const user = userEvent.setup();
    const { onNewConnection } = setup();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.click(screen.getByText(/new connection/i));
    expect(onNewConnection).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByText('local-dev')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('local-dev')).not.toBeInTheDocument();
  });

  it('shows the "no saved" note when nothing is saved', async () => {
    const user = userEvent.setup();
    setup({ available: [], hasAnySaved: false });
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByText(/no saved connections yet/i)).toBeInTheDocument();
  });

  it('shows the "all active" note when saved exist but none are available', async () => {
    const user = userEvent.setup();
    setup({ available: [], hasAnySaved: true });
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(screen.getByText(/all connections are active/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/features/connections/__tests__/ConnectLauncher.test.tsx`
Expected: FAIL — `Failed to resolve import "../ConnectLauncher"`.

- [ ] **Step 3: Write the component**

Create `src/components/features/connections/ConnectLauncher.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import type { Connection } from '../../../connection/model';
import { connectionSummary } from './connectionSummary';
import styles from './ConnectLauncher.module.css';

interface Props {
  /** Connections not currently connected — the menu's pickable items. */
  available: Connection[];
  /** Distinguishes "no saved connections" from "all connections are active". */
  hasAnySaved: boolean;
  onConnect: (c: Connection) => void;
  onNewConnection: () => void;
  /** Right-click on an item → panel renders its ContextMenu (Edit/Duplicate/Delete). */
  onItemContextMenu: (c: Connection, x: number, y: number) => void;
}

function BoltIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M7.5 1 L3 7.6 H6.4 L6 13 L11 5.8 H7.2 Z" fill="currentColor" />
    </svg>
  );
}

export function ConnectLauncher({
  available, hasAnySaved, onConnect, onNewConnection, onItemContextMenu,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // keyboard-highlighted item index
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Close on Escape / outside mousedown; return focus to the trigger on Escape.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    }
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  // Reset the highlight each time the menu opens.
  useEffect(() => { if (open) setActive(0); }, [open]);

  function choose(c: Connection) { setOpen(false); onConnect(c); }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (available.length === 0) return;
    if (e.key === 'ArrowDown') { setActive((i) => Math.min(available.length - 1, i + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActive((i) => Math.max(0, i - 1)); e.preventDefault(); }
    else if (e.key === 'Enter') { const c = available[active]; if (c) choose(c); e.preventDefault(); }
  }

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        aria-label="Connect"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={styles.bolt}><BoltIcon /></span>
        <span className={styles.lab}>Connect</span>
        <span className={styles.chev} aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className={styles.menu} role="menu" onKeyDown={onMenuKeyDown}>
          {available.length > 0 && <div className={styles.groupLabel}>Connect to</div>}
          {available.map((c, i) => (
            <div
              key={c.id}
              role="menuitem"
              tabIndex={-1}
              className={`${styles.item} ${i === active ? styles.itemActive : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(c)}
              onContextMenu={(e) => {
                e.preventDefault();
                setOpen(false);
                onItemContextMenu(c, e.clientX, e.clientY);
              }}
            >
              <span
                className={styles.env}
                style={{ background: c.color || 'var(--fg-dim)' }}
                aria-hidden="true"
              />
              <span className={styles.meta}>
                <span className={styles.name}>{c.name}</span>
                <span className={styles.sub}>{connectionSummary(c.target)}</span>
              </span>
              {c.ssh && <span className={styles.ssh} aria-label="SSH tunnel">SSH</span>}
            </div>
          ))}
          {available.length === 0 && (
            <div className={styles.emptyNote}>
              {hasAnySaved ? 'All connections are active' : 'No saved connections yet'}
            </div>
          )}
          <div className={styles.sep} />
          <div
            role="menuitem"
            tabIndex={-1}
            className={styles.newConn}
            onClick={() => { setOpen(false); onNewConnection(); }}
          >
            <span className={styles.plus} aria-hidden="true">+</span> New connection…
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Write the stylesheet**

Create `src/components/features/connections/ConnectLauncher.module.css`:

```css
.wrap {
  position: relative;
  padding: var(--space-3) var(--space-3) var(--space-2);
  /* Sticky so the launcher stays reachable while a long tree scrolls. */
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--bg-panel);
}

.trigger {
  display: flex; align-items: center; gap: var(--space-2);
  width: 100%; box-sizing: border-box;
  padding: 9px var(--space-3);
  border: none; border-radius: var(--radius-md);
  background: var(--accent); color: var(--accent-contrast);
  font-family: var(--font-sans); font-size: var(--fs-md); font-weight: 600;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-standard);
}
.trigger:hover { background: var(--accent-press); }
.trigger:focus-visible { outline: none; box-shadow: var(--focus-ring); }
.bolt { display: inline-flex; }
.lab { flex: 1; text-align: left; }
.chev { font-size: var(--fs-xs); opacity: .8; }

.menu {
  position: absolute; left: var(--space-3); right: var(--space-3);
  top: calc(100% - var(--space-1));
  z-index: var(--z-dropdown);
  background: var(--bg-elev-3);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-3);
  padding: var(--space-1);
}

.groupLabel {
  font-size: var(--fs-xs); color: var(--fg-dim);
  letter-spacing: .08em; text-transform: uppercase;
  padding: 6px var(--space-2) 4px;
}
.emptyNote { font-size: var(--fs-sm); color: var(--fg-dim); padding: var(--space-2); }

.item {
  display: flex; align-items: center; gap: var(--space-2);
  padding: 7px var(--space-2); border-radius: var(--radius-sm);
  cursor: pointer;
}
.itemActive { background: var(--bg-hover); }
.env { width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto; }
.meta { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.name { font-size: var(--fs-md); color: var(--fg); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sub  { font-size: var(--fs-xs); color: var(--fg-dim); font-family: var(--font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ssh {
  font-size: 9px; color: var(--accent-blue);
  border: 1px solid var(--accent-blue-dim); border-radius: var(--radius-sm);
  padding: 1px 4px; flex: 0 0 auto;
}
.sep { height: 1px; background: var(--border); margin: var(--space-1) 2px; }
.newConn {
  display: flex; align-items: center; gap: var(--space-2);
  padding: 7px var(--space-2); border-radius: var(--radius-sm);
  color: var(--fg-muted); font-size: var(--fs-sm); cursor: pointer;
}
.newConn:hover { background: var(--bg-hover); color: var(--fg); }
.plus { font-size: var(--fs-lg); line-height: 1; }

@media (prefers-reduced-motion: reduce) {
  .trigger { transition: none; }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/features/connections/__tests__/ConnectLauncher.test.tsx`
Expected: PASS (9 passed).

- [ ] **Step 6: Commit**

```bash
git add src/components/features/connections/ConnectLauncher.tsx \
        src/components/features/connections/ConnectLauncher.module.css \
        src/components/features/connections/__tests__/ConnectLauncher.test.tsx
git commit -m "feat(connections): add ConnectLauncher dropdown component"
```

---

## Task 3: Wire the launcher into `ConnectionPanel` (+ token metrics, panel CSS, test updates)

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/components/features/connections/ConnectionPanel.tsx`
- Modify: `src/components/features/connections/ConnectionPanel.module.css`
- Modify: `src/__tests__/connection-panel.test.tsx`
- Modify: `src/components/features/connections/__tests__/connection-tree.test.tsx`

- [ ] **Step 1: Add sticky metrics to tokens**

Edit `src/styles/tokens.css` — replace the z-index line block:

Find:
```css
  --z-dropdown: 80; --z-dialog: 100; --z-tooltip: 120;
}
```
Replace with:
```css
  --z-dropdown: 80; --z-dialog: 100; --z-tooltip: 120;

  /* connections panel sticky metrics — heights used to stack sticky offsets
     (Connect launcher → connection header → database row). Tune ±2px if the
     launcher/row paddings change. */
  --connect-btn-h: 56px; --conn-row-h: 30px;
}
```

- [ ] **Step 2: Rewrite the two existing panel tests to the new behavior (failing first)**

Replace the body of `src/__tests__/connection-panel.test.tsx` `describe('ConnectionPanel', ...)` block with these three tests (leave the `nextDuplicateName` describe block and imports/`v2Conn` helper at the top unchanged):

```tsx
describe('ConnectionPanel', () => {
  it('loads connections on mount and lists them in the Connect launcher', async () => {
    invokeMock
      .mockResolvedValueOnce([v2Conn('1', 'local')])  // connections_v2_list
      .mockResolvedValueOnce(undefined);              // prefs_get
    const user = userEvent.setup();
    render(<ConnectionPanel />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections_v2_list'));
    // Disconnected → not shown in the body; appears only when the launcher opens.
    expect(screen.queryByText('local')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('local')).toBeInTheDocument();
  });

  it('opens the v2 add dialog from the header + button', async () => {
    invokeMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<ConnectionPanel />);
    await user.click(screen.getByLabelText('Add connection'));
    expect(await screen.findByRole('dialog', { name: /connection editor/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/connection name/i)).toBeInTheDocument();
  });

  it('duplicates a connection via the launcher right-click menu with smart naming', async () => {
    invokeMock
      .mockResolvedValueOnce([v2Conn('1', 'test'), v2Conn('2', 'test(1)')])
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(<ConnectionPanel />);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith('connections_v2_list'));

    // Duplicate triggers saveV2 (returns the new connection) → refresh().
    invokeMock
      .mockResolvedValueOnce(v2Conn('3', 'test(2)'))
      .mockResolvedValueOnce([v2Conn('1', 'test'), v2Conn('2', 'test(1)'), v2Conn('3', 'test(2)')]);

    await user.click(screen.getByRole('button', { name: 'Connect' }));
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('test') });
    await user.click(screen.getByText('Duplicate'));

    const saveCall = await waitFor(() => {
      const c = invokeMock.mock.calls.find((c) => c[0] === 'connections_v2_save');
      expect(c).toBeDefined();
      return c!;
    });
    expect(saveCall[1].input.connection).toMatchObject({ id: '', name: 'test(2)' });
    expect(saveCall[1].input.secrets).toEqual([]);

    // Reopen the launcher → the duplicate is now among the available connections.
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(await screen.findByText('test(2)')).toBeInTheDocument();
  });
});
```

Replace the entire `describe('ConnectionPanel color stripe ...')` block in `src/components/features/connections/__tests__/connection-tree.test.tsx` with (imports/`beforeEach` at top unchanged):

```tsx
describe('ConnectionPanel env color dot (read from useConnectionsV2)', () => {
  it('shows the env color dot for a connected connection that has a color', async () => {
    useConnectionsV2.setState({ connectedIds: new Set(['1']) });
    invokeMock
      .mockResolvedValueOnce([{
        id: '1', name: 'prod-db', color: '#ef4444',
        target: { kind: 'direct', host: 'h', port: 27017 },
        auth: { kind: 'none' },
        createdAt: '2026-01-01T00:00:00Z',
      }])
      .mockResolvedValueOnce(undefined);

    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('prod-db')).toBeInTheDocument());
    const dot = screen.getByTestId('conn-env-1');
    expect(dot.style.background).toMatch(/#ef4444|rgb\(239, ?68, ?68\)/);
  });

  it('omits the inline color (falls back) when a connected connection has none', async () => {
    useConnectionsV2.setState({ connectedIds: new Set(['2']) });
    invokeMock
      .mockResolvedValueOnce([{
        id: '2', name: 'no-tag',
        target: { kind: 'direct', host: 'h', port: 27017 },
        auth: { kind: 'none' },
        createdAt: '2026-01-01T00:00:00Z',
      }])
      .mockResolvedValueOnce(undefined);

    render(<ConnectionPanel />);
    await waitFor(() => expect(screen.getByText('no-tag')).toBeInTheDocument());
    const dot = screen.getByTestId('conn-env-2');
    expect(dot.style.background).toBe('');
  });
});
```

- [ ] **Step 3: Run the panel tests to verify they fail**

Run: `npx vitest run src/__tests__/connection-panel.test.tsx src/components/features/connections/__tests__/connection-tree.test.tsx`
Expected: FAIL — no `button name "Connect"`, no `conn-env-*` testid yet (old component).

- [ ] **Step 4: Rewrite `ConnectionPanel.tsx`**

Replace the entire contents of `src/components/features/connections/ConnectionPanel.tsx` with:

```tsx
import { useEffect, useState } from 'react';
import { onSshSessionLost } from '../../../ipc';
import { useConnectionsV2 } from './useConnectionsV2';
import { useEditorStore } from '../../../store/editor';
import { ConnectionDialogV2 } from './dialog-v2/ConnectionDialogV2';
import { ConnectionTree } from './ConnectionTree';
import { ConnectLauncher } from './ConnectLauncher';
import { prefsGet } from '../../../connection/ipc';
import { DEFAULT_GLOBAL_PREFS, type GlobalPrefs } from '../../../connection/overrides';
import { ContextMenu, type ContextMenuItem } from '../../ui/ContextMenu';
import { PassphraseDialog } from './PassphraseDialog';
import { HostKeyDialog } from './HostKeyDialog';
import { ConnectionErrorDialog } from './ConnectionErrorDialog';
import { useConnectionActions } from './useConnectionActions';
import { IconButton, Panel } from '../../ui';
import type { Connection } from '../../../connection/model';
import styles from './ConnectionPanel.module.css';

export { nextDuplicateName } from './nameUtils';

export function ConnectionPanel() {
  const connections = useConnectionsV2((s) => s.connections);
  const connectedIds = useConnectionsV2((s) => s.connectedIds);
  const markDisconnected = useConnectionsV2((s) => s.markDisconnected);
  const refreshV2 = useConnectionsV2((s) => s.refresh);
  const saveV2Store = useConnectionsV2((s) => s.save);
  const actions = useConnectionActions();
  const [editing, setEditing] = useState<Connection | null>(null);
  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; connection: Connection } | null>(null);
  const [globals, setGlobals] = useState<GlobalPrefs>(DEFAULT_GLOBAL_PREFS);
  const openTab = useEditorStore((s) => s.openTab);

  // The launcher offers connections that aren't live; the body shows the live ones.
  const connected = connections.filter((c) => connectedIds.has(c.id));
  const available = connections.filter((c) => !connectedIds.has(c.id));

  function openCollectionScriptTab(db: string, col: string, cId: string) {
    openTab({
      id: `script:${cId}:${db}:${col}:${Date.now()}`,
      title: col,
      content: `db.getCollection("${col}").find({})`,
      isDirty: false,
      type: 'script',
      connectionId: cId,
      database: db,
      collection: col,
    });
  }

  useEffect(() => {
    // The v2 store is the sole source of truth for the connection list.
    refreshV2().catch((e) => console.error('refreshV2 failed:', e));
    Promise.resolve(prefsGet())
      .then((p) => p && setGlobals(p))
      .catch((e) => console.error('prefsGet failed:', e));
  }, [refreshV2]);

  // Reflect backend SSH session-loss by flipping the connection to disconnected.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onSshSessionLost(({ connectionId }) => {
      markDisconnected(connectionId);
      actions.setExpanded(new Set([...actions.expandedConns].filter((x) => x !== connectionId)));
    })
      .then((fn) => { unlisten = fn; })
      .catch((e) => console.error('ssh_session_lost listener error:', e));
    return () => { unlisten?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markDisconnected]);

  // Context-menu items depend on whether the target is currently live.
  function menuItems(c: Connection): ContextMenuItem[] {
    const live = connectedIds.has(c.id);
    return [
      ...(live ? [{ label: 'Disconnect', action: () => actions.disconnect(c) }] : []),
      { label: 'Edit', action: () => setEditing(c) },
      { label: 'Duplicate', action: () => actions.duplicate(c) },
      { label: 'Delete', action: () => actions.remove(c) },
    ];
  }

  return (
    <Panel>
      <Panel.Header
        title="Connections"
        right={
          <IconButton
            aria-label="Add connection"
            tooltip="Add connection"
            size="sm"
            icon="+"
            onClick={() => setCreating(true)}
          />
        }
      />
      <Panel.Body className={styles.body}>
        <ConnectLauncher
          available={available}
          hasAnySaved={connections.length > 0}
          onConnect={actions.connect}
          onNewConnection={() => setCreating(true)}
          onItemContextMenu={(c, x, y) => setContextMenu({ x, y, connection: c })}
        />
        {connected.length > 0 && (
          <>
            <div className={styles.groupLabel}>Active</div>
            <ul className={styles.list}>
              {connected.map((c) => {
                const envColor = c.color;
                const isExpanded = actions.expandedConns.has(c.id);
                return (
                  <li
                    key={c.id}
                    className={styles.item}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, connection: c });
                    }}
                  >
                    <div
                      className={styles.row}
                      data-testid={`conn-row-${c.id}`}
                      onClick={() => actions.toggleExpanded(c.id)}
                    >
                      <span className={styles.caret} aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
                      <span
                        className={styles.env}
                        data-testid={`conn-env-${c.id}`}
                        style={envColor ? { background: envColor } : undefined}
                        aria-hidden="true"
                      />
                      <span className={styles.name}>{c.name}</span>
                      <span className={styles.live} aria-label="Connected" />
                    </div>
                    {isExpanded && (
                      <ConnectionTree
                        connectionId={c.id}
                        onOpenCollection={(db, col) => openCollectionScriptTab(db, col, c.id)}
                      />
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Panel.Body>
      {(creating || editing) && (
        <ConnectionDialogV2
          initial={editing}
          globals={globals}
          onSave={async (input) => {
            const saved = await saveV2Store(input);
            setEditing(null);
            setCreating(false);
            return saved;
          }}
          onCancel={() => { setEditing(null); setCreating(false); }}
        />
      )}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItems(contextMenu.connection)}
          onClose={() => setContextMenu(null)}
        />
      )}
      {actions.passphraseFor && (
        <PassphraseDialog
          connectionName={actions.passphraseFor.name}
          onConfirm={actions.submitPassphrase}
          onCancel={() => actions.setPassphraseFor(null)}
        />
      )}
      {actions.connectError && (
        <ConnectionErrorDialog
          message={actions.connectError}
          onClose={actions.clearConnectError}
        />
      )}
      {actions.pendingHostKey && (
        <HostKeyDialog
          host={actions.pendingHostKey.host}
          port={actions.pendingHostKey.port}
          algorithm={actions.pendingHostKey.algorithm}
          fingerprint={actions.pendingHostKey.fingerprint}
          onAccept={actions.acceptHostKey}
          onReject={() => actions.setPendingHostKey(null)}
        />
      )}
    </Panel>
  );
}
```

- [ ] **Step 5: Rewrite `ConnectionPanel.module.css`**

Replace the entire contents of `src/components/features/connections/ConnectionPanel.module.css` with:

```css
/* ConnectionPanel is mounted as a "scrollable view": the SidePanel host
   (.viewSlotScrollable) owns vertical scroll, so Panel.Body must NOT create
   its own scroll container — otherwise position:sticky inside binds to
   Panel.Body (which never scrolls) instead of the real scroll port. */
.body { overflow: visible !important; }

.groupLabel {
  font-size: var(--fs-xs);
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--fg-dim);
  padding: var(--space-2) var(--space-3) var(--space-1);
}

.list {
  list-style: none;
  margin: 0;
  padding: 0 var(--space-1);
}

.item {
  display: flex;
  flex-direction: column;
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-2);
  border-radius: var(--radius-sm);
  cursor: pointer;
  /* Sticky: the connection header pins just under the (sticky) Connect button
     while its tree scrolls beneath. Opaque bg masks the scrolled content. */
  position: sticky;
  top: var(--connect-btn-h, 56px);
  z-index: 2;
  background: var(--bg-panel);
  min-height: var(--conn-row-h, 30px);
  box-sizing: border-box;
  transition: background var(--dur-fast) var(--ease-standard);
}
/* Opaque hover (not the translucent --bg-hover) so sticky masking still holds. */
.row:hover { background: var(--bg-elev-2); }

.caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  font-size: 9px;
  color: var(--fg-dim);
}

.env {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--fg-dim);
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.live {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
  background: var(--accent);
  box-shadow: 0 0 7px var(--accent);
}

.errorBody {
  margin: 0;
  padding: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.errorActions {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-3);
}

@media (prefers-reduced-motion: reduce) {
  .row { transition: none; }
}
```

- [ ] **Step 6: Run the panel tests to verify they pass**

Run: `npx vitest run src/__tests__/connection-panel.test.tsx src/components/features/connections/__tests__/connection-tree.test.tsx`
Expected: PASS (3 + 2 = all green).

- [ ] **Step 7: Commit**

```bash
git add src/styles/tokens.css \
        src/components/features/connections/ConnectionPanel.tsx \
        src/components/features/connections/ConnectionPanel.module.css \
        src/__tests__/connection-panel.test.tsx \
        src/components/features/connections/__tests__/connection-tree.test.tsx
git commit -m "feat(connections): empty-on-open panel with Connect launcher; remove row dividers"
```

---

## Task 4: Tree DB-row sticky offset

The database header rows in `ConnectionTree` are sticky and currently offset only by
`--conn-row-h`. With the launcher now sticky above the connection header, the DB row must offset by
both heights, or it will slide under the connection header while scrolling.

**Files:**
- Modify: `src/components/features/connections/ConnectionTree.module.css`

- [ ] **Step 1: Update the `.dbRow` sticky offset**

Edit `src/components/features/connections/ConnectionTree.module.css`.

Find:
```css
.dbRow {
  position: sticky;
  top: var(--conn-row-h, 30px);
  z-index: 1;
  background: var(--bg-panel);
}
```
Replace with:
```css
.dbRow {
  position: sticky;
  /* Stack under the sticky Connect launcher + the connection header row. */
  top: calc(var(--connect-btn-h, 56px) + var(--conn-row-h, 30px));
  z-index: 1;
  background: var(--bg-panel);
}
```

- [ ] **Step 2: Verify the tree test still passes**

Run: `npx vitest run src/__tests__/connection-tree.test.tsx`
Expected: PASS (1 passed) — logic unchanged; this is a CSS-only edit.

- [ ] **Step 3: Commit**

```bash
git add src/components/features/connections/ConnectionTree.module.css
git commit -m "fix(connections): stack DB-row sticky offset under the Connect launcher"
```

---

## Task 5: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: All suites pass. If any non-connections suite references the old panel structure, fix it the same way (open launcher / use connected state) — but none are expected.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint src/components/features/connections`
Expected: No type errors; no lint errors. (If `eslint` isn't configured as a script, skip lint and rely on `tsc`.)

- [ ] **Step 3: Manual smoke (run the app)**

Run the app (e.g. `npm run tauri dev` or the project's normal launch) and confirm:
- On open with no live connection: panel shows only the **Connect** button (no dividers, no rows).
- Click **Connect** → dropdown lists not-yet-connected connections with env dot + `host:port`/URI subtitle (+ SSH badge where applicable) and a **New connection…** entry.
- Pick one → it connects, leaves the dropdown, and appears under **Active** with a glowing live dot; expand → DB/collection tree browses as before.
- Scroll a long tree → Connect button and the connection header stay pinned; DB headers pin beneath them without overlap.
- Right-click a dropdown item → Edit/Duplicate/Delete. Right-click a live row → Disconnect/Edit/Duplicate/Delete.
- `prefers-reduced-motion` (System Settings → Accessibility) → no transitions.

- [ ] **Step 4: Final commit (if any manual-fix tweaks were needed)**

```bash
git add -A
git commit -m "test(connections): finalize Connect launcher verification"
```

---

## Self-Review

**Spec coverage:** §3.1 states → Tasks 3 (panel) + 2 (launcher). §3.2 launcher (items, subtitle, SSH badge, New connection, empty copy, pick, right-click, dismissal, keyboard) → Task 2. §3.3 active list (borderless, env dot, live glow, sticky, tree, context menu) → Task 3. §3.4 header → Task 3 (kept). §4.1 ConnectLauncher → Task 2. §4.2 connectionSummary registry → Task 1. §4.3 panel rewrite → Task 3. §4.4 CSS → Tasks 3 + 4. §5 sticky stacking → tokens (Task 3 Step 1) + Tasks 3/4 offsets. §6 a11y/motion → Task 2 (aria, keyboard, reduced-motion) + Task 3 (reduced-motion). §7 edge cases → covered by `available`/`connected` filtering + empty copy. §8 testing → Tasks 1, 2, 3. All sections mapped.

**Placeholder scan:** No TBD/TODO; every code/test step shows full content; commands have expected output.

**Type consistency:** `ConnectLauncher` prop names (`available`, `hasAnySaved`, `onConnect`, `onNewConnection`, `onItemContextMenu`) match between Task 2 definition and Task 3 usage. `connectionSummary(target)` signature matches its Task 1 definition and Task 2 call. `ContextMenuItem` imported from `../../ui/ContextMenu` (where it is `export interface`). Testids `conn-env-${id}` match between Task 3 component and the rewritten test. Trigger accessible name `'Connect'` (via `aria-label`) matches every `getByRole('button', { name: 'Connect' })`.
