# Connection Dialog Redesign + Save-While-Disabled Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Add/Edit Connection dialog look professional and let users save TLS/SSH/Proxy details while the feature is toggled off.

**Architecture:** Visual polish of `ConnectionDialogV2` (header/title, grouped icon tab rail, segmented controls, footer) plus a cross-stack `enabled` flag for SSH/Proxy (TLS already has one) so disabled-but-filled features persist without activating at connect time.

**Tech Stack:** React + TypeScript + CSS Modules (Vitest/RTL), Rust/Tauri (cargo test), design tokens in `src/styles/tokens.css`.

**Spec:** `docs/superpowers/specs/2026-06-03-connection-dialog-redesign-design.md`

**Conventions:**
- Run TS tests: `npm test -- <path>` (vitest). Full: `npm test`.
- Run Rust tests: `cd src-tauri && cargo test <name>`.
- Read `/code-standards` before writing code. No hardcoded colors — use tokens.
- Commit after each task.

---

## Task 1: `SegmentedControl` UI primitive

**Files:**
- Create: `src/components/ui/SegmentedControl/SegmentedControl.tsx`
- Create: `src/components/ui/SegmentedControl/SegmentedControl.module.css`
- Create: `src/components/ui/SegmentedControl/index.ts`
- Modify: `src/components/ui/index.ts`
- Test: `src/__tests__/segmented-control.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/__tests__/segmented-control.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedControl } from '../components/ui/SegmentedControl';

const opts = [
  { value: 'direct', label: 'Direct' },
  { value: 'uri', label: 'Connection URI' },
] as const;

describe('SegmentedControl', () => {
  it('renders a radiogroup with one radio per option', () => {
    render(<SegmentedControl ariaLabel="Target type" value="direct" options={opts as any} onChange={() => {}} />);
    expect(screen.getByRole('radiogroup', { name: 'Target type' })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
  });

  it('marks the active option aria-checked', () => {
    render(<SegmentedControl ariaLabel="Target type" value="uri" options={opts as any} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'Connection URI' })).toHaveAttribute('aria-checked', 'true');
  });

  it('fires onChange with the option value when clicked', () => {
    const onChange = vi.fn();
    render(<SegmentedControl ariaLabel="Target type" value="direct" options={opts as any} onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Connection URI' }));
    expect(onChange).toHaveBeenCalledWith('uri');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/__tests__/segmented-control.test.tsx`
Expected: FAIL (cannot resolve `../components/ui/SegmentedControl`).

- [ ] **Step 3: Implement the component**

```tsx
// src/components/ui/SegmentedControl/SegmentedControl.tsx
import styles from './SegmentedControl.module.css';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

/** Generic pill segmented toggle. Add new variants by passing more options —
 *  no edits needed here. */
export function SegmentedControl<T extends string>({
  value, options, onChange, ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={styles.group}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={active ? styles.segOn : styles.seg}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
```

```css
/* src/components/ui/SegmentedControl/SegmentedControl.module.css */
.group {
  display: inline-flex; gap: 2px; padding: 2px;
  background: var(--bg); border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
}
.seg, .segOn {
  font: inherit; font-size: var(--fs-sm); cursor: pointer;
  border: none; background: transparent; color: var(--fg-muted);
  padding: 5px 14px; border-radius: var(--radius-sm);
}
.seg:hover { color: var(--fg); }
.segOn { background: var(--bg-elev-3); color: var(--fg); font-weight: 600; }
.seg:focus-visible, .segOn:focus-visible { outline: none; box-shadow: var(--focus-ring); }
```

```ts
// src/components/ui/SegmentedControl/index.ts
export * from './SegmentedControl';
```

Add to `src/components/ui/index.ts` (after the `FormField` export line):

```ts
export * from './SegmentedControl';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/__tests__/segmented-control.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/SegmentedControl src/components/ui/index.ts src/__tests__/segmented-control.test.tsx
git commit -m "feat(ui): add SegmentedControl primitive"
```

---

## Task 2: Tab icons + `TabSpec.icon`

**Files:**
- Create: `src/components/features/connections/dialog-v2/tabs/icons.tsx`
- Modify: `src/components/features/connections/dialog-v2/tabs/types.ts`
- Modify: `src/components/features/connections/dialog-v2/tabs/registry.ts`
- Test: `src/components/features/connections/dialog-v2/tabs/__tests__/registry.icons.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// .../tabs/__tests__/registry.icons.test.tsx
import { describe, it, expect } from 'vitest';
import { TABS } from '../registry';

describe('TAB registry icons', () => {
  it('every tab declares an icon', () => {
    for (const t of TABS) expect(t.icon, `tab ${t.id} missing icon`).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/features/connections/dialog-v2/tabs/__tests__/registry.icons.test.tsx`
Expected: FAIL (`icon` undefined on each tab).

- [ ] **Step 3: Create the icon module**

```tsx
// .../tabs/icons.tsx
// Inline line-icons matching ConnectionTree.tsx (currentColor, ~1.2 stroke).
import type { ReactNode } from 'react';

const svg = (paths: ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 14 14" fill="none"
    stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">{paths}</svg>
);

export const TAB_ICONS = {
  server: svg(<><rect x="2" y="2" width="10" height="4" rx="1" /><rect x="2" y="8" width="10" height="4" rx="1" /><path d="M4 4h.01M4 10h.01" /></>),
  auth: svg(<><circle cx="5" cy="6" r="2.2" /><path d="M5 8.2V12M3.6 10.4h2.8" /><path d="M8 5l3.5-.0M9.5 5v2" /></>),
  tls: svg(<><rect x="3" y="6" width="8" height="6" rx="1" /><path d="M5 6V4.5a2 2 0 0 1 4 0V6" /></>),
  ssh: svg(<><rect x="2" y="3" width="10" height="8" rx="1" /><path d="M4 6l2 1.5L4 9M7.5 9H10" /></>),
  proxy: svg(<><circle cx="7" cy="7" r="5" /><path d="M2 7h10M7 2c1.6 1.5 1.6 8.5 0 10M7 2c-1.6 1.5-1.6 8.5 0 10" /></>),
  intelliShell: svg(<path d="M7.5 1.5 3 7.6h3.4l-.4 4.9 4.6-6.8H7.3z" />),
  tools: svg(<path d="M9.5 2.5a2.5 2.5 0 0 0-3 3.2L2.6 9.6a1 1 0 1 0 1.4 1.4l3.9-3.9a2.5 2.5 0 0 0 3.2-3l-1.6 1.6-1.2-1.2z" />),
  advanced: svg(<><circle cx="7" cy="7" r="2" /><path d="M7 1v2M7 11v2M1 7h2M11 7h2M3 3l1.5 1.5M9.5 9.5 11 11M11 3 9.5 4.5M4.5 9.5 3 11" /></>),
} as const;
```

- [ ] **Step 4: Add `icon` to `TabSpec`**

In `.../tabs/types.ts`, add to the `TabSpec` interface (after `Form`):

```ts
  /** Line-icon rendered in the tab rail. Implement a new tab by adding its
   *  icon here + a TAB_ICONS entry — no other edits needed. */
  icon: import('react').ReactNode;
```

- [ ] **Step 5: Wire icons into the registry**

In `.../tabs/registry.ts`, add `import { TAB_ICONS } from './icons';` and add an
`icon: TAB_ICONS.<id>,` line to each of the 8 tab entries (e.g. the `server`
entry gains `icon: TAB_ICONS.server,`, `auth` gains `icon: TAB_ICONS.auth,`,
and so on for `tls`, `ssh`, `proxy`, `intelliShell`, `tools`, `advanced`).

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- src/components/features/connections/dialog-v2/tabs/__tests__/registry.icons.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/features/connections/dialog-v2/tabs/icons.tsx src/components/features/connections/dialog-v2/tabs/types.ts src/components/features/connections/dialog-v2/tabs/registry.ts src/components/features/connections/dialog-v2/tabs/__tests__/registry.icons.test.tsx
git commit -m "feat(connections): add tab icons + TabSpec.icon"
```

---

## Task 3: Redesign the dialog shell (header / rail / footer)

**Files:**
- Modify: `src/components/features/connections/dialog-v2/ConnectionDialogV2.tsx`
- Modify: `src/components/features/connections/dialog-v2/ConnectionDialogV2.module.css`
- Test: `src/components/features/connections/__tests__/connection-panel.dialog-v2.test.tsx` (adjust if it asserts old header markup)

- [ ] **Step 1: Add a derived subtitle helper + render new header/rail/footer**

Replace the JSX returned by `ConnectionDialogV2` so that:
- The header renders: `<ColorPicker>` (kept functionally as the existing control; give it a compact chip-like appearance via the header CSS — a full swatch popover is an optional follow-up, out of scope here), an editable name input styled as the title (class `titleInput`, `aria-label="Connection name"`, placeholder `"Untitled connection"`), a derived subtitle, and the `Test connection` ghost button.
- The rail renders group label `CONNECTION` then transport tabs, group label `PREFERENCES` then prefs tabs; each tab button renders `{t.icon}` + `{t.label}` + dot badges, with `role="tab"` and `aria-selected` preserved.
- The footer keeps the existing status switch + `Cancel`/`Save`.

Add this helper above the component:

```tsx
function subtitleFor(initial: Connection | null, draft: Connection): string {
  if (!initial) return 'New connection';
  const t = draft.target;
  const scheme = t.kind === 'uri'
    ? (t.uri.startsWith('mongodb+srv') ? 'mongodb+srv' : 'mongodb')
    : 'direct';
  return `Editing connection · ${scheme}`;
}
```

Header JSX (replaces lines 54–69):

```tsx
<div className={styles.header}>
  <ColorPicker
    value={state.draft.color}
    onChange={(c) => dispatch({ type: 'set-field', path: 'color', value: c })}
  />
  <div className={styles.titleBlock}>
    <input
      className={styles.titleInput}
      aria-label="Connection name"
      placeholder="Untitled connection"
      value={state.draft.name}
      onChange={(e) => dispatch({ type: 'set-field', path: 'name', value: e.target.value })}
    />
    <div className={styles.subtitle}>{subtitleFor(state.initial, state.draft)}</div>
  </div>
  <Button onClick={handleTest} disabled={issues.length > 0}>Test connection</Button>
</div>
```

Rail JSX (replaces the `<nav>` block, lines 72–98): render `{t.icon}` before
`{t.label}` inside each button, replace the `<hr>` with
`<div className={styles.glabel}>PREFERENCES</div>` and add
`<div className={styles.glabel}>CONNECTION</div>` before the transport group.
Keep `role="tab"`, `aria-selected`, the `errBadge`/`overrideBadge` spans.

- [ ] **Step 2: Replace the CSS**

```css
/* ConnectionDialogV2.module.css */
.header { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-4); border-bottom: 1px solid var(--border); }
.titleBlock { flex: 1; min-width: 0; }
.titleInput {
  font: inherit; font-size: var(--fs-lg); font-weight: 600; color: var(--fg);
  width: 100%; background: transparent; border: 1px solid transparent;
  border-radius: var(--radius-sm); padding: 2px 6px; margin: -2px -6px;
}
.titleInput:hover { border-color: var(--border); }
.titleInput:focus { outline: none; border-color: var(--accent); box-shadow: var(--focus-ring); background: var(--bg); }
.subtitle { font-size: var(--fs-sm); color: var(--fg-dim); padding: 2px 6px 0; }

.body { display: flex; min-height: 340px; }
.sidebar { width: 168px; border-right: 1px solid var(--border); background: var(--bg-elev-2); display: flex; flex-direction: column; padding: var(--space-2); gap: 1px; }
.glabel { font-size: var(--fs-xs); letter-spacing: .06em; text-transform: uppercase; color: var(--fg-dim); padding: 9px 10px 4px; }
.tab, .tabActive { display: flex; align-items: center; gap: 9px; padding: 6px 10px; text-align: left; background: transparent; border: none; border-radius: var(--radius-sm); cursor: pointer; color: var(--fg-muted); font-size: var(--fs-md); }
.tab:hover { background: var(--bg-hover); color: var(--fg); }
.tabActive { background: var(--bg-elev-3); color: var(--fg); font-weight: 600; }
.errBadge { margin-left: auto; color: var(--accent-red); }
.overrideBadge { margin-left: auto; color: var(--accent-amber); }
.panel { flex: 1; padding: var(--space-4) var(--space-5); }

.footer { display: flex; justify-content: space-between; align-items: center; padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border); }
.issues { color: var(--accent-red); font-size: var(--fs-sm); }
.testOk { color: var(--accent-green); }
.testFail { color: var(--accent-red); }
.actions { display: flex; gap: var(--space-2); }
```

(Note: the `<button>` className still uses `activeTabId === t.id ? styles.tabActive : styles.tab` exactly as before.)

- [ ] **Step 3: Run the dialog test, fix any stale header assertions**

Run: `npm test -- src/components/features/connections/__tests__/connection-panel.dialog-v2.test.tsx`
Expected: PASS. If a test queried the old `"Connection name"` label via `getByLabelText`, it still works (we kept `aria-label="Connection name"`). If it asserted the literal `Test` button text, update it to `Test connection`.

- [ ] **Step 4: Run the full connections test folder**

Run: `npm test -- src/components/features/connections`
Expected: PASS (update any remaining header/text assertions).

- [ ] **Step 5: Commit**

```bash
git add src/components/features/connections/dialog-v2/ConnectionDialogV2.tsx src/components/features/connections/dialog-v2/ConnectionDialogV2.module.css src/components/features/connections/__tests__/connection-panel.dialog-v2.test.tsx
git commit -m "feat(connections): redesign dialog header, tab rail, footer"
```

---

## Task 4: ServerTab — SegmentedControl + monospace + labels

**Files:**
- Modify: `src/components/features/connections/dialog-v2/tabs/ServerTab.tsx`
- Modify: `src/components/features/connections/dialog-v2/tabs/ServerTab.module.css`
- Test: `src/components/features/connections/dialog-v2/tabs/__tests__/ServerTab.test.tsx`

- [ ] **Step 1: Update the test for the segmented control**

Open the existing test. Replace any radio-button query for target type with the
segmented control. Add/keep:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';
// ...
it('switches to URI mode via the segmented control', () => {
  const onChange = vi.fn();
  render(<ServerTab value={{ ...base }} onChange={onChange} globals={DEFAULT_GLOBAL_PREFS} secrets={{}} onSecretChange={() => {}} />);
  fireEvent.click(screen.getByRole('radio', { name: 'Connection URI' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'uri', uri: '' } }));
});
```

(Keep the existing confirm-on-switch behavior; the click path still routes through `switchKind`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/features/connections/dialog-v2/tabs/__tests__/ServerTab.test.tsx`
Expected: FAIL (no radio named "Connection URI" yet — currently a native radio with adjacent text node, queried differently).

- [ ] **Step 3: Replace the radio group with `SegmentedControl`, add mono class**

In `ServerTab.tsx` replace the `role="radiogroup"` block with:

```tsx
import { SegmentedControl } from '../../../../ui';
// ...
<div className={styles.segRow}>
  <SegmentedControl
    ariaLabel="Target type"
    value={target.kind}
    options={[{ value: 'direct', label: 'Direct' }, { value: 'uri', label: 'Connection URI' }]}
    onChange={(k) => switchKind(k)}
  />
</div>
```

Add `className={styles.mono}` to the host, port, and URI `FormField.Input`s.

- [ ] **Step 4: Update CSS**

```css
/* ServerTab.module.css */
.segRow { margin-bottom: var(--space-4); }
.fieldRow { display: flex; gap: var(--space-3); }
.mono { font-family: var(--font-mono); font-size: var(--fs-sm); }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/components/features/connections/dialog-v2/tabs/__tests__/ServerTab.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/connections/dialog-v2/tabs/ServerTab.tsx src/components/features/connections/dialog-v2/tabs/ServerTab.module.css src/components/features/connections/dialog-v2/tabs/__tests__/ServerTab.test.tsx
git commit -m "feat(connections): segmented target-type + mono fields in ServerTab"
```

---

## Task 5: TS model `enabled` (SSH/Proxy) + validation + migration + blank helpers

**Files:**
- Modify: `src/connection/model.ts`
- Modify: `src/connection/validation.ts`
- Modify: `src/connection/migration.ts`
- Create: `src/connection/feature-state.ts` (blank/isBlank helpers)
- Test: `src/connection/__tests__/feature-state.test.ts`
- Test: `src/connection/__tests__/validation.test.ts` (add cases)

- [ ] **Step 1: Add `enabled` to the model types**

In `src/connection/model.ts`:
- `SshTunnel`: add `enabled: boolean;` as the first field.
- `Proxy`: add `enabled: boolean;` as the first field.

- [ ] **Step 2: Write the failing helper test**

```ts
// src/connection/__tests__/feature-state.test.ts
import { describe, it, expect } from 'vitest';
import { BLANK_SSH, BLANK_PROXY, isBlankSsh, isBlankProxy, isBlankTls } from '../feature-state';

describe('feature-state', () => {
  it('BLANK_SSH is disabled and blank', () => {
    expect(BLANK_SSH.enabled).toBe(false);
    expect(isBlankSsh(BLANK_SSH)).toBe(true);
  });
  it('SSH with a host is not blank', () => {
    expect(isBlankSsh({ ...BLANK_SSH, host: 'jump.example' })).toBe(false);
  });
  it('BLANK_PROXY is disabled and blank', () => {
    expect(BLANK_PROXY.enabled).toBe(false);
    expect(isBlankProxy(BLANK_PROXY)).toBe(true);
  });
  it('TLS disabled with no extras is blank; with a CA file is not', () => {
    expect(isBlankTls({ enabled: false })).toBe(true);
    expect(isBlankTls({ enabled: true })).toBe(false);
    expect(isBlankTls({ enabled: false, caFile: '/x.pem' } as any)).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- src/connection/__tests__/feature-state.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement the helpers**

```ts
// src/connection/feature-state.ts
import type { SshTunnel, Proxy, Tls } from './model';

export const BLANK_SSH: SshTunnel = {
  enabled: false, host: '', port: 22, user: '',
  auth: { kind: 'password' }, knownHostsPolicy: 'strict',
};

export const BLANK_PROXY: Proxy = {
  enabled: false, kind: 'socks5', host: '', port: 1080,
};

/** Disabled + no user-entered data → safe to drop from storage. */
export function isBlankSsh(s: SshTunnel): boolean {
  return !s.enabled && !s.host.trim() && !s.user.trim()
    && s.auth.kind === 'password';
}

export function isBlankProxy(p: Proxy): boolean {
  return !p.enabled && !p.host.trim() && !p.auth;
}

export function isBlankTls(t: Tls): boolean {
  if (t.enabled) return false;
  // disabled: blank unless cert/flag data was entered
  return !t.caFile && !t.clientCertFile
    && !t.allowInvalidCerts && !t.allowInvalidHostnames;
}
```

Note: `isBlankTls` reads optional fields that only exist on the `enabled:true`
arm of the `Tls` union. Access them via a widened local:
`const x = t as { caFile?: string; clientCertFile?: string; allowInvalidCerts?: boolean; allowInvalidHostnames?: boolean };` then test `x.caFile` etc.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/connection/__tests__/feature-state.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate validation when disabled**

In `src/connection/validation.ts`:
- `validateSsh`: change `if (!ssh) return [];` → `if (!ssh || !ssh.enabled) return [];`
- `validateProxy`: change `if (!proxy) return [];` → `if (!proxy || !proxy.enabled) return [];`

Add to `src/connection/__tests__/validation.test.ts`:

```ts
it('skips SSH validation when disabled even with blank host', () => {
  expect(validateSsh({ enabled: false, host: '', port: 22, user: '', auth: { kind: 'password' }, knownHostsPolicy: 'strict' })).toEqual([]);
});
it('validates SSH when enabled', () => {
  expect(validateSsh({ enabled: true, host: '', port: 22, user: '', auth: { kind: 'password' }, knownHostsPolicy: 'strict' }).length).toBeGreaterThan(0);
});
it('skips proxy validation when disabled', () => {
  expect(validateProxy({ enabled: false, kind: 'socks5', host: '', port: 1080 })).toEqual([]);
});
```

(Ensure `validateSsh`/`validateProxy` are imported in the test file.)

- [ ] **Step 7: Set `enabled: true` on migrated SSH**

In `src/connection/migration.ts`, in the `ssh` object literal add `enabled: true,`
as the first property.

- [ ] **Step 8: Run model/validation/migration tests**

Run: `npm test -- src/connection`
Expected: PASS (existing migration test may assert the ssh shape — add `enabled: true` to its expected object if so).

- [ ] **Step 9: Commit**

```bash
git add src/connection
git commit -m "feat(connections): add enabled flag to SSH/Proxy model + validation gating"
```

---

## Task 6: Rust model `enabled` + builder gating + migration + fixtures

**Files:**
- Modify: `src-tauri/src/connection/model.rs`
- Modify: `src-tauri/src/connection/builder.rs`
- Modify: `src-tauri/src/connection/migration.rs`
- Modify: `tests/fixtures/connection/migrated/*.json` (ssh blocks)

- [ ] **Step 1: Add `enabled` + `default_true` to the Rust model**

In `src-tauri/src/connection/model.rs`:
- Add a free function near the top of the module:

```rust
fn default_true() -> bool { true }
```

- In `struct SshTunnel`, add as the first field:

```rust
    #[serde(default = "default_true")]
    pub enabled: bool,
```

- In `struct Proxy`, add as the first field:

```rust
    #[serde(default = "default_true")]
    pub enabled: bool,
```

Rationale: absent in stored JSON ⇒ legacy active config ⇒ `true`; new disabled
saves serialize `enabled: false` explicitly.

- [ ] **Step 2: Write a deserialization test (absent ⇒ true; present ⇒ honored)**

Add to the `#[cfg(test)]` module in `model.rs`:

```rust
#[test]
fn ssh_enabled_defaults_true_when_absent() {
    let json = r#"{"host":"h","port":22,"user":"u","auth":{"kind":"agent"},"knownHostsPolicy":"strict"}"#;
    let ssh: SshTunnel = serde_json::from_str(json).unwrap();
    assert!(ssh.enabled);
}
#[test]
fn ssh_enabled_false_is_honored() {
    let json = r#"{"enabled":false,"host":"h","port":22,"user":"u","auth":{"kind":"agent"},"knownHostsPolicy":"strict"}"#;
    let ssh: SshTunnel = serde_json::from_str(json).unwrap();
    assert!(!ssh.enabled);
}
```

- [ ] **Step 3: Run the model tests (expect compile/pass)**

Run: `cd src-tauri && cargo test -p <crate> connection::model 2>&1 | tail -20`
(Use the crate name from `src-tauri/Cargo.toml` `[package].name`.)
Expected: the two new tests PASS; fix any field-init sites the new required
field broke (see Step 4).

- [ ] **Step 4: Fix any `SshTunnel { .. }` / `Proxy { .. }` construction sites**

`enabled` is non-`Option`, so every Rust literal constructing `SshTunnel` or
`Proxy` must set it. Search and fix:

Run: `cd src-tauri && grep -rn "SshTunnel {" src; grep -rn "Proxy {" src`
For each construction (notably `migration.rs::build_ssh`), add `enabled: true,`
(migrated tunnels were active). For any test fixtures building a disabled one,
set the intended value.

- [ ] **Step 5: Gate the builder on `enabled`**

In `src-tauri/src/connection/builder.rs`:

- In `open_ssh_if_configured`, after the existing
  `let Some(ssh) = ssh else { return Ok(SshStepOutcome::Open(None)); };`
  add:

```rust
    if !ssh.enabled {
        return Ok(SshStepOutcome::Open(None));
    }
```

- In `apply_proxy`, after `let Some(proxy) = proxy else { return Ok(()) };` add:

```rust
    if !proxy.enabled {
        return Ok(());
    }
```

- [ ] **Step 6: Add builder gating tests**

Add tests asserting a disabled SSH yields `SshStepOutcome::Open(None)` (no
tunnel attempt) and a disabled proxy leaves `opts.socks5_proxy` unset. Mirror
the construction style of existing builder tests in that file. If existing
builder tests construct `SshTunnel`/`Proxy`, they now need `enabled: true`.

- [ ] **Step 7: Update migration + fixtures**

- `migration.rs::build_ssh`: add `enabled: true,` to the returned `SshTunnel`.
- For each `tests/fixtures/connection/migrated/*.json` whose `ssh` is non-null,
  add `"enabled": true` to that `ssh` object (the fixture-paired `migrate()`
  tests compare serialized output).

Run: `cd src-tauri && grep -rln '"ssh"' ../tests/fixtures/connection/migrated`
to find which fixtures need editing; add the field to each non-null `ssh`.

- [ ] **Step 8: Run the full Rust connection test suite**

Run: `cd src-tauri && cargo test connection 2>&1 | tail -30`
Expected: PASS (model, builder, migration). Fix fixture mismatches by adding the
`enabled` field where the diff points.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/src/connection tests/fixtures/connection
git commit -m "feat(connections): gate SSH/proxy on enabled flag (Rust) + migration"
```

---

## Task 7: TLS tab — always-show fields + enable toggle (no field wipe)

**Files:**
- Modify: `src/components/features/connections/dialog-v2/tabs/TlsTab.tsx`
- Modify: `src/components/features/connections/dialog-v2/tabs/TlsTab.module.css`
- Test: `src/components/features/connections/dialog-v2/tabs/__tests__/TlsTab.test.tsx`

- [ ] **Step 1: Rewrite the tests for the new behavior**

Replace the "hides cert fields when disabled" expectations with always-visible
fields + a dim wrapper + data-preserving toggle:

```tsx
it('shows cert fields even when TLS is disabled', () => {
  renderTls({ ...base, tls: { enabled: false } });
  expect(screen.getByLabelText(/ca certificate/i)).toBeInTheDocument();
});

it('toggling enable preserves existing field data', () => {
  const { onChange } = renderTls({ ...base, tls: { enabled: false, caFile: '/ca.pem' } as any });
  fireEvent.click(screen.getByLabelText(/enable tls/i));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    tls: expect.objectContaining({ enabled: true, caFile: '/ca.pem' }),
  }));
});

it('defaults to disabled when no tls present (renders fields, toggle off)', () => {
  renderTls({ ...base });
  expect(screen.getByLabelText(/enable tls/i)).not.toBeChecked();
  expect(screen.getByLabelText(/ca certificate/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/features/connections/dialog-v2/tabs/__tests__/TlsTab.test.tsx`
Expected: FAIL (fields hidden when disabled today).

- [ ] **Step 3: Rewrite the component**

```tsx
// TlsTab.tsx
import type { TabFormProps } from './types';
import type { Tls } from '../../../../../connection/model';
import { FilePicker } from './shared/FilePicker';
import styles from './TlsTab.module.css';

const BLANK_TLS_DISABLED: Tls = { enabled: false };

export function TlsTab({ value, onChange }: TabFormProps) {
  const tls = value.tls ?? BLANK_TLS_DISABLED;
  // widen to read optional cert fields regardless of union arm
  const x = tls as Extract<Tls, { enabled: true }>;

  function setTls(next: Tls) { onChange({ ...value, tls: next }); }

  return (
    <>
      <label className={styles.checkRow}>
        <input
          type="checkbox"
          checked={tls.enabled}
          onChange={(e) => setTls({ ...x, enabled: e.target.checked } as Tls)}
        />
        Enable TLS
      </label>

      <div className={tls.enabled ? styles.fields : styles.fieldsDim}>
        <FilePicker
          id="tls-ca" label="CA certificate (PEM)" value={x.caFile}
          onChange={(path) => setTls({ ...x, enabled: tls.enabled, caFile: path } as Tls)}
          filters={[{ name: 'PEM', extensions: ['pem', 'crt'] }]}
        />
        <FilePicker
          id="tls-clientcert" label="Client certificate (PEM)" value={x.clientCertFile}
          onChange={(path) => setTls({ ...x, enabled: tls.enabled, clientCertFile: path } as Tls)}
          filters={[{ name: 'PEM', extensions: ['pem', 'crt'] }]}
        />
        <label className={styles.checkRow}>
          <input type="checkbox" checked={!!x.allowInvalidCerts}
            onChange={(e) => setTls({ ...x, enabled: tls.enabled, allowInvalidCerts: e.target.checked } as Tls)} />
          Allow invalid certificates (insecure)
        </label>
        {x.allowInvalidCerts && (
          <div role="alert" className={styles.warning}>
            ⚠ Server certificate validation is disabled. Use only for trusted internal hosts.
          </div>
        )}
        <label className={styles.checkRow}>
          <input type="checkbox" checked={!!x.allowInvalidHostnames}
            onChange={(e) => setTls({ ...x, enabled: tls.enabled, allowInvalidHostnames: e.target.checked } as Tls)} />
          Allow invalid hostnames
        </label>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Add the dim style**

Append to `TlsTab.module.css`:

```css
.fields { display: block; }
.fieldsDim { display: block; opacity: .55; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/components/features/connections/dialog-v2/tabs/__tests__/TlsTab.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/connections/dialog-v2/tabs/TlsTab.tsx src/components/features/connections/dialog-v2/tabs/TlsTab.module.css src/components/features/connections/dialog-v2/tabs/__tests__/TlsTab.test.tsx
git commit -m "feat(connections): TLS fields always visible with enable toggle"
```

---

## Task 8: SSH tab — always-show fields + enable toggle + segmented auth

**Files:**
- Modify: `src/components/features/connections/dialog-v2/tabs/SshTab.tsx`
- Modify: `src/components/features/connections/dialog-v2/tabs/SshTab.module.css`
- Test: `src/components/features/connections/dialog-v2/tabs/__tests__/SshTab.test.tsx`

- [ ] **Step 1: Rewrite tests for always-visible fields + preserve-on-toggle**

```tsx
it('shows SSH host field even when disabled', () => {
  renderSsh({ ...base });
  expect(screen.getByLabelText(/ssh host/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/enable ssh tunnel/i)).not.toBeChecked();
});

it('typing a host materializes a disabled tunnel (enabled stays false)', () => {
  const { onChange } = renderSsh({ ...base });
  fireEvent.change(screen.getByLabelText(/ssh host/i), { target: { value: 'jump' } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    ssh: expect.objectContaining({ enabled: false, host: 'jump' }),
  }));
});

it('toggling enable preserves typed host', () => {
  const { onChange } = renderSsh({ ...base, ssh: { enabled: false, host: 'jump', port: 22, user: 'me', auth: { kind: 'password' }, knownHostsPolicy: 'strict' } });
  fireEvent.click(screen.getByLabelText(/enable ssh tunnel/i));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    ssh: expect.objectContaining({ enabled: true, host: 'jump' }),
  }));
});
```

(Provide a `renderSsh` helper mirroring the TLS test's `renderTls`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/features/connections/dialog-v2/tabs/__tests__/SshTab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite the component**

Use `BLANK_SSH` from feature-state as the render fallback; bind every field to
`ssh` (the fallback or the real object); each setter writes the whole object
back preserving `enabled`; the enable checkbox writes `{ ...ssh, enabled }`.
Wrap the detail fields in `tabsEnabledDim` when `!ssh.enabled`. Replace the SSH
auth radio group with `SegmentedControl` (options from `SSH_AUTH_LABELS`).

```tsx
import type { TabFormProps } from './types';
import type { SshAuth, SshTunnel } from '../../../../../connection/model';
import { FormField } from '../../../../ui/FormField';
import { SegmentedControl } from '../../../../ui';
import { SSH_AUTH_FORMS, SSH_AUTH_LABELS } from './ssh/registry';
import { BLANK_SSH } from '../../../../../connection/feature-state';
import styles from './SshTab.module.css';

function blankSshAuth(kind: SshAuth['kind']): SshAuth {
  switch (kind) {
    case 'password': return { kind: 'password' };
    case 'key': return { kind: 'key', keyPath: '', hasPassphrase: false };
    case 'agent': return { kind: 'agent' };
  }
}

export function SshTab(props: TabFormProps) {
  const { value, onChange } = props;
  const ssh: SshTunnel = value.ssh ?? BLANK_SSH;
  function setSsh(next: SshTunnel) { onChange({ ...value, ssh: next }); }
  const SubForm = SSH_AUTH_FORMS[ssh.auth.kind];
  const authOptions = (Object.keys(SSH_AUTH_LABELS) as SshAuth['kind'][])
    .map((k) => ({ value: k, label: SSH_AUTH_LABELS[k] }));

  return (
    <>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={ssh.enabled}
          onChange={(e) => setSsh({ ...ssh, enabled: e.target.checked })} />
        Enable SSH tunnel
      </label>

      <div className={ssh.enabled ? styles.fields : styles.fieldsDim}>
        <div className={styles.fieldRow}>
          <FormField>
            <FormField.Label htmlFor="ssh-host">SSH host</FormField.Label>
            <FormField.Input id="ssh-host" className={styles.mono} value={ssh.host}
              onChange={(e) => setSsh({ ...ssh, host: e.target.value })} />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="ssh-port">SSH port</FormField.Label>
            <FormField.Input id="ssh-port" type="number" className={styles.mono} value={ssh.port}
              onChange={(e) => setSsh({ ...ssh, port: Number(e.target.value) })} />
          </FormField>
        </div>
        <FormField>
          <FormField.Label htmlFor="ssh-user">SSH user</FormField.Label>
          <FormField.Input id="ssh-user" value={ssh.user}
            onChange={(e) => setSsh({ ...ssh, user: e.target.value })} />
        </FormField>

        <SegmentedControl ariaLabel="SSH auth method" value={ssh.auth.kind}
          options={authOptions}
          onChange={(k) => setSsh({ ...ssh, auth: blankSshAuth(k) })} />

        {SubForm && <SubForm {...props} />}

        <FormField>
          <FormField.Label htmlFor="ssh-known-hosts">Host key policy</FormField.Label>
          <select id="ssh-known-hosts" value={ssh.knownHostsPolicy}
            onChange={(e) => setSsh({ ...ssh, knownHostsPolicy: e.target.value as SshTunnel['knownHostsPolicy'] })}>
            <option value="strict">Strict (require known hosts entry)</option>
            <option value="add-and-trust">Add and trust on first use</option>
            <option value="accept-any">Accept any (insecure)</option>
          </select>
        </FormField>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Update CSS**

Append/replace in `SshTab.module.css`:

```css
.fieldRow { display: flex; gap: var(--space-3); }
.mono { font-family: var(--font-mono); font-size: var(--fs-sm); }
.fields { display: block; }
.fieldsDim { display: block; opacity: .55; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/components/features/connections/dialog-v2/tabs/__tests__/SshTab.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/connections/dialog-v2/tabs/SshTab.tsx src/components/features/connections/dialog-v2/tabs/SshTab.module.css src/components/features/connections/dialog-v2/tabs/__tests__/SshTab.test.tsx
git commit -m "feat(connections): SSH fields always visible with enable toggle + segmented auth"
```

---

## Task 9: Proxy tab — always-show fields + enable toggle + segmented kind

**Files:**
- Modify: `src/components/features/connections/dialog-v2/tabs/ProxyTab.tsx`
- Modify: `src/components/features/connections/dialog-v2/tabs/ProxyTab.module.css`
- Test: `src/components/features/connections/dialog-v2/tabs/__tests__/ProxyTab.test.tsx`

- [ ] **Step 1: Rewrite tests for always-visible fields + preserve-on-toggle**

```tsx
it('shows proxy host field even when disabled, toggle off', () => {
  renderProxy({ ...base });
  expect(screen.getByLabelText(/^host$/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/enable proxy/i)).not.toBeChecked();
});

it('toggling enable preserves typed host', () => {
  const { onChange } = renderProxy({ ...base, proxy: { enabled: false, kind: 'socks5', host: '10.0.0.1', port: 1080 } });
  fireEvent.click(screen.getByLabelText(/enable proxy/i));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
    proxy: expect.objectContaining({ enabled: true, host: '10.0.0.1' }),
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/features/connections/dialog-v2/tabs/__tests__/ProxyTab.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Rewrite the component**

Use `BLANK_PROXY` as the render fallback; bind fields to `proxy`; setters
preserve `enabled`; replace the proxy-kind radio group with `SegmentedControl`
(SOCKS5 / HTTP / SOCKS4); keep the "only SOCKS5 supported" warning and the
username→password keychain logic; wrap detail fields in `fieldsDim` when
disabled.

```tsx
import type { TabFormProps } from './types';
import type { Proxy } from '../../../../../connection/model';
import { FormField } from '../../../../ui/FormField';
import { SegmentedControl } from '../../../../ui';
import { BLANK_PROXY } from '../../../../../connection/feature-state';
import styles from './ProxyTab.module.css';

const KIND_OPTIONS = [
  { value: 'socks5', label: 'SOCKS5' },
  { value: 'http', label: 'HTTP' },
  { value: 'socks4', label: 'SOCKS4' },
] as const;

export function ProxyTab({ value, onChange, secrets, onSecretChange }: TabFormProps) {
  const proxy: Proxy = value.proxy ?? BLANK_PROXY;
  const editingExisting = !!value.id;
  function setProxy(next: Proxy) { onChange({ ...value, proxy: next }); }

  return (
    <>
      <label className={styles.checkRow}>
        <input type="checkbox" checked={proxy.enabled}
          onChange={(e) => setProxy({ ...proxy, enabled: e.target.checked })} />
        Enable proxy
      </label>

      <div className={proxy.enabled ? styles.fields : styles.fieldsDim}>
        <SegmentedControl ariaLabel="Proxy type" value={proxy.kind}
          options={KIND_OPTIONS as any}
          onChange={(k) => setProxy({ ...proxy, kind: k })} />

        {proxy.kind !== 'socks5' && (
          <div role="alert" className={styles.warning}>
            Only SOCKS5 is supported by the MongoDB driver. {proxy.kind.toUpperCase()} will fail at connect time.
          </div>
        )}

        <div className={styles.fieldRow}>
          <FormField>
            <FormField.Label htmlFor="proxy-host">Host</FormField.Label>
            <FormField.Input id="proxy-host" className={styles.mono} value={proxy.host}
              onChange={(e) => setProxy({ ...proxy, host: e.target.value })} />
          </FormField>
          <FormField>
            <FormField.Label htmlFor="proxy-port">Port</FormField.Label>
            <FormField.Input id="proxy-port" type="number" className={styles.mono} value={proxy.port}
              onChange={(e) => setProxy({ ...proxy, port: Number(e.target.value) })} />
          </FormField>
        </div>

        <FormField>
          <FormField.Label htmlFor="proxy-user">Username (optional)</FormField.Label>
          <FormField.Input id="proxy-user" value={proxy.auth?.username ?? ''}
            onChange={(e) => {
              const next = e.target.value;
              if (next) setProxy({ ...proxy, auth: { username: next } });
              else { onSecretChange('proxy-password', ''); setProxy({ ...proxy, auth: undefined }); }
            }} />
        </FormField>

        {proxy.auth && (
          <FormField>
            <FormField.Label htmlFor="proxy-pw">Password</FormField.Label>
            <FormField.Input id="proxy-pw" type="password" value={secrets['proxy-password'] ?? ''}
              placeholder={editingExisting && secrets['proxy-password'] === undefined ? '(stored in Keychain — leave blank to keep)' : ''}
              onChange={(e) => onSecretChange('proxy-password', e.target.value)} />
          </FormField>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Update CSS**

Append to `ProxyTab.module.css`:

```css
.fieldRow { display: flex; gap: var(--space-3); }
.mono { font-family: var(--font-mono); font-size: var(--fs-sm); }
.fields { display: block; }
.fieldsDim { display: block; opacity: .55; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- src/components/features/connections/dialog-v2/tabs/__tests__/ProxyTab.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/features/connections/dialog-v2/tabs/ProxyTab.tsx src/components/features/connections/dialog-v2/tabs/ProxyTab.module.css src/components/features/connections/dialog-v2/tabs/__tests__/ProxyTab.test.tsx
git commit -m "feat(connections): proxy fields always visible with enable toggle + segmented kind"
```

---

## Task 10: Strip-blank-on-save wiring in the dialog

**Files:**
- Modify: `src/components/features/connections/dialog-v2/ConnectionDialogV2.tsx`
- Test: `src/components/features/connections/__tests__/connection-panel.dialog-v2.test.tsx` (add a save-normalization case) or a focused new test file.

- [ ] **Step 1: Write the failing test**

```tsx
// add to connection-panel.dialog-v2 test (or a new normalize test)
it('drops blank disabled SSH/proxy/tls from the saved connection', async () => {
  // render the dialog with onSave spy, draft has tls/ssh/proxy = blank disabled
  // trigger Save, assert the SaveInput.connection has no ssh/proxy and tls omitted
});
```

Implement concretely against the existing dialog test harness in that file
(reuse its render helper + onSave mock). Assert: with a draft where
`ssh = BLANK_SSH`, `proxy = BLANK_PROXY`, `tls = { enabled:false }`, the
`onSave` payload's `connection` has `ssh === undefined`, `proxy === undefined`,
and `tls === undefined`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/features/connections/__tests__/connection-panel.dialog-v2.test.tsx`
Expected: FAIL (blank disabled features currently persisted).

- [ ] **Step 3: Add a normalize step in `handleSave`**

In `ConnectionDialogV2.tsx`, import the blank helpers and normalize before save:

```tsx
import { isBlankSsh, isBlankProxy, isBlankTls } from '../../../../connection/feature-state';

function normalizeForSave(c: Connection): Connection {
  const out: Connection = { ...c };
  if (out.tls && isBlankTls(out.tls)) delete out.tls;
  if (out.ssh && isBlankSsh(out.ssh)) delete out.ssh;
  if (out.proxy && isBlankProxy(out.proxy)) delete out.proxy;
  return out;
}

function handleSave() {
  onSave({ connection: normalizeForSave(state.draft), secrets: collectSecrets(state.secrets) });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/features/connections/__tests__/connection-panel.dialog-v2.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/features/connections/dialog-v2/ConnectionDialogV2.tsx src/components/features/connections/__tests__/connection-panel.dialog-v2.test.tsx
git commit -m "feat(connections): drop blank disabled TLS/SSH/proxy on save"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: TypeScript build + full test suite**

Run: `npm run build`
Expected: `tsc` clean, vite build succeeds.

Run: `npm test`
Expected: all green. Fix any remaining tab/dialog assertions that referenced old
markup (radios, hidden fields, `Test` button text, header label).

- [ ] **Step 2: Rust test suite**

Run: `cd src-tauri && cargo test connection 2>&1 | tail -30`
Expected: model/builder/migration tests green.

- [ ] **Step 3: Manual smoke (verify skill or run skill)**

Launch the app, open Add Connection: confirm header/title, icon rail, segmented
controls. On TLS/SSH/Proxy: fields visible with toggle off; fill SSH host + user,
leave toggle off, Save; reopen → data present, toggle still off; flip toggle on,
Save, Connect → tunnel used. Confirm a connection saved with disabled SSH does
NOT open a tunnel on connect.

- [ ] **Step 4: Final commit (if any fixups)**

```bash
git add -A && git commit -m "test(connections): finalize dialog redesign + save-while-disabled"
```

---

## Notes / Risks

- **Serde default = true** for `enabled` is the upgrade-safety hinge: existing
  users' SSH/proxy keep working; only explicit new `enabled:false` saves disable.
  Covered by the model deserialization test (Task 6 Step 2).
- **No `runner/` files change**, so the harness-deploy step in `CLAUDE.md` is not
  triggered by this work.
- **DOM stability:** `aria-label="Connection name"`, tab `role`/`aria-selected`,
  field `htmlFor` ids, and `role="alert"` warnings are preserved so most existing
  tests and a11y carry over.
- **Construction-site sweep (Rust):** adding a non-Option `enabled` field forces
  updates at every `SshTunnel {…}` / `Proxy {…}` literal — Task 6 Step 4 covers
  finding them; the build will fail loudly until all are fixed.
