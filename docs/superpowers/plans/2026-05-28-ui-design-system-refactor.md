# UI Design System Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan is structured as four sequential PRs (foundations → dialogs/results → chat/shell → remaining); each PR is independently mergeable and visually a no-op.

**Goal:** Replace ad-hoc inline JSX and `style={{…}}` literals across the UI with a small design-system layer (tokens + primitives), and split the largest feature files into composed components — without changing visible behavior.

**Architecture:** Three layers, applied in order. (1) `src/styles/tokens.css` — semantic CSS variables for colors/spacing/radii/font-sizes/z-index. (2) `src/components/ui/` — functional React primitives (`Button`, `IconButton`, `Panel`, `Toolbar`, `Dialog`, `FormField`, `ListRow`, `ResizableSplit`, `Stack`, `Text`) with compound-component pattern (`Dialog.Header`, `Panel.Body`, etc.) and CSS Modules. (3) `src/components/features/` — existing feature files refactored to consume primitives. Spec: `docs/superpowers/specs/2026-05-27-ui-design-system-refactor-design.md`.

**Tech Stack:** React 18 + TypeScript, Vite, CSS Modules (no new deps), Vitest + React Testing Library (already configured), Zustand stores (untouched), Monaco editor (untouched).

---

## File structure (after all four PRs)

```
src/
  components/
    ui/                              ← NEW (PR 1)
      Button/{Button.tsx, Button.module.css, index.ts, __tests__/}
      IconButton/{IconButton.tsx, IconButton.module.css, index.ts, __tests__/}
      Panel/{Panel.tsx, Panel.module.css, index.ts, __tests__/}
      Toolbar/{Toolbar.tsx, Toolbar.module.css, index.ts, __tests__/}
      Dialog/{Dialog.tsx, Dialog.module.css, index.ts, __tests__/}
      FormField/{FormField.tsx, FormField.module.css, index.ts, __tests__/}
      ListRow/{ListRow.tsx, ListRow.module.css, index.ts, __tests__/}
      ResizableSplit/{ResizableSplit.tsx, ResizableSplit.module.css, index.ts, __tests__/}
      Stack/{Stack.tsx, Stack.module.css, index.ts}
      Text/{Text.tsx, Text.module.css, index.ts}
      hooks/{useDisclosure.ts, useResizable.ts, useFocusTrap.ts, __tests__/}
      index.ts                       ← barrel re-export
    features/                        ← NEW directory (PR 2 mechanical move)
      results/   (was components/results/)
      ai/        (was components/ai/)
      connections/ (was components/connections/)
      editor/    (was components/editor/)
      saved-scripts/ (was components/saved-scripts/)
      layout/    (was components/layout/)
    shared/                          ← kept; trimmed in PR 1
    ui/                              ← old "ui" folder: keep ContextMenu here (it's already a primitive)
  styles/
    tokens.css                       ← NEW (PR 1)
    globals.css                      ← thin: resets + @import tokens.css
```

Note on the old `src/components/ui/` folder (`ContextMenu.tsx` lives here): in PR 1 we treat `ContextMenu` as already-a-primitive. It stays put. The folder gains the new primitives alongside it.

---

## PR 1 — Foundations

**Scope:** Tokens file, all primitives, headless hooks, tests. Zero consumer changes. App still imports from old paths.

### Task 1: Create `src/styles/tokens.css`

**Files:**
- Create: `src/styles/tokens.css`
- Modify: `src/styles/globals.css`

- [x] **Step 1: Create tokens file**

```css
/* src/styles/tokens.css
 * Design tokens for the UI layer.
 * To add a new token: append under the matching category. Never reference
 * these values as JS string literals — read them through CSS variables only.
 */
:root {
  /* color tokens — copied from globals.css so this file is self-contained */
  --bg: #001e2b;
  --bg-panel: #0d2d3c;
  --bg-rail: #022e45;
  --bg-hover: #1a3d4f;
  --fg: #d4d4d4;
  --fg-dim: #858585;
  --border: #1e4d63;
  --accent: #00ed64;
  --accent-green: #00ed64;
  --accent-red: #f48771;

  /* fonts */
  --font-mono: "SF Mono", Menlo, Consolas, monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;

  /* spacing — 4px base */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px;

  /* radii */
  --radius-sm: 3px; --radius-md: 6px; --radius-lg: 10px;

  /* font sizes */
  --fs-xs: 11px; --fs-sm: 12px; --fs-md: 13px; --fs-lg: 15px;

  /* z-index scale */
  --z-dropdown: 80; --z-dialog: 100; --z-tooltip: 120;

  /* shadows */
  --shadow-dialog: 0 12px 32px rgba(0, 0, 0, 0.4);
}
```

- [x] **Step 2: Replace `globals.css` color/font block with `@import 'tokens.css'`**

Keep resets, button defaults, tab-scroll utility. Remove the `:root { … }` block (now in tokens.css).

```css
/* src/styles/globals.css */
@import './tokens.css';

* { box-sizing: border-box; }
html, body, #root { margin: 0; padding: 0; height: 100%; width: 100%; }
body {
  background: var(--bg); color: var(--fg);
  font-family: var(--font-sans); font-size: var(--fs-md);
  -webkit-font-smoothing: antialiased;
}
button {
  font: inherit; color: inherit; background: transparent;
  border: 1px solid var(--border); padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm); cursor: pointer;
}
button:hover { background: var(--bg-hover); }
input, select, textarea {
  font: inherit; color: inherit;
  background: var(--bg); border: 1px solid var(--border);
  padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm);
}
input:focus, select:focus, textarea:focus { outline: 1px solid var(--accent); }
input::placeholder, textarea::placeholder { color: var(--fg-dim); opacity: 1; }
.tab-scroll { scrollbar-width: none; -ms-overflow-style: none; }
.tab-scroll::-webkit-scrollbar { display: none; height: 0; width: 0; }
```

- [x] **Step 3: Verify**

Run: `npm run dev` and load the app. Expected: visual output unchanged.

- [x] **Step 4: Commit**

```
chore(styles): extract design tokens into tokens.css
```

---

### Task 2: `Button` primitive

**Files:**
- Create: `src/components/ui/Button/Button.tsx`, `Button.module.css`, `index.ts`, `__tests__/Button.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
// __tests__/Button.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '../Button';

describe('Button', () => {
  it('renders children and handles click', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disables when loading and shows spinner', () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('applies variant class', () => {
    render(<Button variant="primary">OK</Button>);
    expect(screen.getByRole('button').className).toMatch(/primary/);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/components/ui/Button` → FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// Button.tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
}

/**
 * Button primitive. To add a new variant:
 *   1. Extend ButtonVariant union.
 *   2. Add a `.<name>` rule in Button.module.css under the variant block.
 * No edits needed elsewhere.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  iconLeft,
  iconRight,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  const cls = [styles.button, styles[variant], styles[size], className]
    .filter(Boolean)
    .join(' ');
  return (
    <button {...rest} className={cls} disabled={disabled || loading}>
      {loading ? <span className={styles.spinner} aria-hidden /> : iconLeft}
      <span className={styles.label}>{children}</span>
      {iconRight}
    </button>
  );
}
```

```css
/* Button.module.css */
.button {
  display: inline-flex; align-items: center; gap: var(--space-2);
  font: inherit; border-radius: var(--radius-sm); cursor: pointer;
  border: 1px solid var(--border); background: transparent; color: var(--fg);
  padding: var(--space-1) var(--space-3);
}
.button:hover:not(:disabled) { background: var(--bg-hover); }
.button:disabled { opacity: 0.55; cursor: not-allowed; }
.sm { padding: 2px var(--space-2); font-size: var(--fs-sm); }
.md { padding: var(--space-1) var(--space-3); font-size: var(--fs-md); }
.primary { background: var(--accent); color: #001e2b; border-color: var(--accent); }
.primary:hover:not(:disabled) { filter: brightness(0.95); background: var(--accent); }
.secondary { /* default */ }
.ghost { border-color: transparent; }
.ghost:hover:not(:disabled) { background: var(--bg-hover); }
.danger { color: var(--accent-red); border-color: var(--accent-red); }
.label { display: inline-flex; align-items: center; }
.spinner {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid currentColor; border-right-color: transparent;
  animation: spin 0.7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

```ts
// index.ts
export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';
```

- [ ] **Step 4: Run tests** → PASS.

- [ ] **Step 5: Commit** `feat(ui): add Button primitive`

---

### Task 3: `IconButton` primitive

**Files:** `src/components/ui/IconButton/{IconButton.tsx, IconButton.module.css, index.ts, __tests__/IconButton.test.tsx}`

- [ ] **Step 1: Test** — renders icon, click handler fires, `aria-label` required (TypeScript-level).

- [ ] **Step 2: Implement**

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import styles from './IconButton.module.css';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string; // required
  icon: ReactNode;
  pressed?: boolean;
  tooltip?: string;
  size?: 'sm' | 'md';
}

export function IconButton({ icon, pressed, size = 'md', tooltip, className, ...rest }: IconButtonProps) {
  const cls = [styles.btn, styles[size], pressed && styles.pressed, className].filter(Boolean).join(' ');
  return (
    <button {...rest} className={cls} title={tooltip} aria-pressed={pressed}>
      {icon}
    </button>
  );
}
```

```css
.btn {
  display: inline-flex; align-items: center; justify-content: center;
  background: transparent; border: 1px solid transparent;
  border-radius: var(--radius-sm); cursor: pointer; color: var(--fg);
}
.btn:hover:not(:disabled) { background: var(--bg-hover); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sm { width: 24px; height: 24px; }
.md { width: 28px; height: 28px; }
.pressed { background: var(--bg-hover); border-color: var(--border); }
```

- [ ] **Step 3:** Commit `feat(ui): add IconButton primitive`.

---

### Task 4: `Stack` (HStack / VStack)

**Files:** `src/components/ui/Stack/{Stack.tsx, Stack.module.css, index.ts}`

- [ ] **Step 1: Implement** (no tests needed for pure layout primitive)

```tsx
import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Stack.module.css';

type Gap = 'none' | 'sm' | 'md' | 'lg';
type Align = 'start' | 'center' | 'end' | 'stretch';
type Justify = 'start' | 'center' | 'end' | 'space-between';

interface StackProps extends HTMLAttributes<HTMLDivElement> {
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  children: ReactNode;
}

function makeStack(direction: 'row' | 'column') {
  return function Stack({ gap = 'md', align, justify, className, ...rest }: StackProps) {
    const cls = [
      styles.stack, styles[direction], styles[`gap-${gap}`],
      align && styles[`align-${align}`], justify && styles[`justify-${justify}`],
      className,
    ].filter(Boolean).join(' ');
    return <div {...rest} className={cls} />;
  };
}

export const HStack = makeStack('row');
export const VStack = makeStack('column');
```

```css
.stack { display: flex; min-width: 0; min-height: 0; }
.row { flex-direction: row; }
.column { flex-direction: column; }
.gap-none { gap: 0; } .gap-sm { gap: var(--space-1); }
.gap-md { gap: var(--space-2); } .gap-lg { gap: var(--space-4); }
.align-start { align-items: flex-start; } .align-center { align-items: center; }
.align-end { align-items: flex-end; } .align-stretch { align-items: stretch; }
.justify-start { justify-content: flex-start; } .justify-center { justify-content: center; }
.justify-end { justify-content: flex-end; } .justify-space-between { justify-content: space-between; }
```

- [ ] **Step 2:** Commit `feat(ui): add HStack / VStack primitives`.

---

### Task 5: `Text` primitive

**Files:** `src/components/ui/Text/{Text.tsx, Text.module.css, index.ts}`

- [ ] **Step 1: Implement**

```tsx
import type { HTMLAttributes, ElementType, ReactNode } from 'react';
import styles from './Text.module.css';

type Variant = 'body' | 'mono' | 'dim' | 'error' | 'label';

interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType;
  variant?: Variant;
  selectable?: boolean; // explicit user-select: text
  children: ReactNode;
}

export function Text({
  as: Tag = 'span', variant = 'body', selectable, className, children, ...rest
}: TextProps) {
  const cls = [styles.text, styles[variant], selectable && styles.selectable, className]
    .filter(Boolean).join(' ');
  return <Tag {...rest} className={cls}>{children}</Tag>;
}
```

```css
.text { font-family: var(--font-sans); color: var(--fg); font-size: var(--fs-md); }
.body {}
.mono { font-family: var(--font-mono); font-size: var(--fs-sm); }
.dim { color: var(--fg-dim); font-size: var(--fs-sm); }
.error { color: var(--accent-red); font-family: var(--font-mono); white-space: pre-wrap; word-break: break-word; }
.label { font-size: var(--fs-xs); color: var(--fg-dim); }
.selectable { user-select: text; -webkit-user-select: text; cursor: text; }
```

- [ ] **Step 2:** Commit `feat(ui): add Text primitive`.

---

### Task 6: `Panel` compound primitive

**Files:** `src/components/ui/Panel/{Panel.tsx, Panel.module.css, index.ts, __tests__/Panel.test.tsx}`

- [ ] **Step 1: Test** — renders header title, right slot, body, footer; body is scrollable.

- [ ] **Step 2: Implement**

```tsx
import type { ReactNode, HTMLAttributes } from 'react';
import styles from './Panel.module.css';

interface PanelProps extends HTMLAttributes<HTMLDivElement> { children: ReactNode; }
function PanelRoot({ className, children, ...rest }: PanelProps) {
  return <div {...rest} className={[styles.panel, className].filter(Boolean).join(' ')}>{children}</div>;
}

interface HeaderProps { title?: ReactNode; right?: ReactNode; children?: ReactNode; }
function PanelHeader({ title, right, children }: HeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.title}>{title ?? children}</div>
      {right && <div className={styles.right}>{right}</div>}
    </div>
  );
}

function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.body, className].filter(Boolean).join(' ')}>{children}</div>;
}
function PanelFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

export const Panel = Object.assign(PanelRoot, { Header: PanelHeader, Body: PanelBody, Footer: PanelFooter });
```

```css
.panel { display: flex; flex-direction: column; min-height: 0; min-width: 0; background: var(--bg-panel); }
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-2) var(--space-3); border-bottom: 1px solid var(--border);
  font-size: var(--fs-sm); color: var(--fg-dim); text-transform: uppercase; letter-spacing: 0.5px;
}
.title { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
.right { display: flex; align-items: center; gap: var(--space-1); }
.body { flex: 1; min-height: 0; overflow: auto; }
.footer { padding: var(--space-2) var(--space-3); border-top: 1px solid var(--border); }
```

- [ ] **Step 3:** Commit `feat(ui): add Panel compound primitive`.

---

### Task 7: `Toolbar` primitive

**Files:** `src/components/ui/Toolbar/{Toolbar.tsx, Toolbar.module.css, index.ts}`

- [ ] **Step 1: Implement**

```tsx
import type { ReactNode, HTMLAttributes } from 'react';
import styles from './Toolbar.module.css';

interface ToolbarProps extends HTMLAttributes<HTMLDivElement> {
  left?: ReactNode;
  right?: ReactNode;
  children?: ReactNode;
}

export function Toolbar({ left, right, children, className, ...rest }: ToolbarProps) {
  return (
    <div {...rest} className={[styles.toolbar, className].filter(Boolean).join(' ')}>
      <div className={styles.section}>{left ?? children}</div>
      {right && <div className={styles.section}>{right}</div>}
    </div>
  );
}
```

```css
.toolbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-1) var(--space-2); border-bottom: 1px solid var(--border);
  gap: var(--space-2); min-height: 32px;
}
.section { display: flex; align-items: center; gap: var(--space-2); min-width: 0; }
```

- [ ] **Step 2:** Commit `feat(ui): add Toolbar primitive`.

---

### Task 8: Headless hooks (`useDisclosure`, `useResizable`, `useFocusTrap`)

**Files:** `src/components/ui/hooks/{useDisclosure.ts, useResizable.ts, useFocusTrap.ts, __tests__/}`

- [ ] **Step 1: Implement `useDisclosure`**

```ts
import { useCallback, useState } from 'react';
export function useDisclosure(initial = false) {
  const [isOpen, setOpen] = useState(initial);
  return {
    isOpen,
    setOpen,
    open: useCallback(() => setOpen(true), []),
    close: useCallback(() => setOpen(false), []),
    toggle: useCallback(() => setOpen((x) => !x), []),
  } as const;
}
```

- [ ] **Step 2: Implement `useResizable`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react';

interface Options {
  initial: number; min: number; max: number;
  direction: 'horizontal' | 'vertical';
  storageKey?: string;
}
export function useResizable({ initial, min, max, direction, storageKey }: Options) {
  const [size, setSize] = useState(() => {
    if (storageKey) {
      const v = Number(localStorage.getItem(storageKey));
      if (Number.isFinite(v) && v >= min && v <= max) return v;
    }
    return initial;
  });
  const dragRef = useRef<{ startPos: number; startSize: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startPos: direction === 'horizontal' ? e.clientX : e.clientY,
      startSize: size,
    };
  }, [size, direction]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const cur = direction === 'horizontal' ? e.clientX : e.clientY;
    const delta = cur - dragRef.current.startPos;
    const next = Math.max(min, Math.min(max, dragRef.current.startSize + delta));
    setSize(next);
  }, [direction, min, max]);

  const onPointerUp = useCallback(() => {
    if (dragRef.current && storageKey) localStorage.setItem(storageKey, String(size));
    dragRef.current = null;
  }, [size, storageKey]);

  useEffect(() => {
    if (storageKey) localStorage.setItem(storageKey, String(size));
  }, [size, storageKey]);

  return { size, setSize, handlers: { onPointerDown, onPointerMove, onPointerUp } } as const;
}
```

- [ ] **Step 3: Implement `useFocusTrap`**

```ts
import { useEffect, RefObject } from 'react';
const FOCUSABLE = 'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useFocusTrap(ref: RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const node = ref.current;
    const prev = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
    focusables()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0], last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    node.addEventListener('keydown', onKey);
    return () => { node.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [ref, active]);
}
```

- [ ] **Step 4: Tests for `useDisclosure`** (renderHook).

- [ ] **Step 5:** Commit `feat(ui): add headless hooks`.

---

### Task 9: `Dialog` compound primitive

**Files:** `src/components/ui/Dialog/{Dialog.tsx, Dialog.module.css, index.ts, __tests__/Dialog.test.tsx}`

- [ ] **Step 1: Test** — opens, traps focus, Escape calls `onClose`, backdrop click calls `onClose`, body content rendered in portal, footer rendered at bottom.

- [ ] **Step 2: Implement**

```tsx
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { IconButton } from '../IconButton';
import styles from './Dialog.module.css';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  width?: number | string;
  children: ReactNode;
}
function DialogRoot({ open, onClose, ariaLabel, width = 520, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className={styles.backdrop} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-label={ariaLabel} aria-modal="true"
           className={styles.dialog} style={{ width }}>
        {children}
      </div>
    </div>,
    document.body
  );
}

function DialogHeader({ title, onClose }: { title: ReactNode; onClose?: () => void }) {
  return (
    <div className={styles.header}>
      <div className={styles.title}>{title}</div>
      {onClose && <IconButton aria-label="Close dialog" icon="✕" onClick={onClose} />}
    </div>
  );
}
function DialogBody({ children }: { children: ReactNode }) {
  return <div className={styles.body}>{children}</div>;
}
function DialogFooter({ children }: { children: ReactNode }) {
  return <div className={styles.footer}>{children}</div>;
}

export const Dialog = Object.assign(DialogRoot, { Header: DialogHeader, Body: DialogBody, Footer: DialogFooter });
```

```css
.backdrop {
  position: fixed; inset: 0; background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center; z-index: var(--z-dialog);
}
.dialog {
  background: var(--bg-panel); border: 1px solid var(--border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-dialog);
  max-height: 90vh; display: flex; flex-direction: column; min-width: 320px;
}
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--border);
}
.title { font-size: var(--fs-md); font-weight: 600; }
.body { padding: var(--space-4); overflow: auto; flex: 1; min-height: 0; }
.footer {
  display: flex; justify-content: flex-end; gap: var(--space-2);
  padding: var(--space-3) var(--space-4); border-top: 1px solid var(--border);
}
```

- [ ] **Step 3:** Commit `feat(ui): add Dialog compound primitive`.

---

### Task 10: `FormField` compound primitive

**Files:** `src/components/ui/FormField/{FormField.tsx, FormField.module.css, index.ts}`

- [ ] **Step 1: Implement**

```tsx
import type { InputHTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';
import styles from './FormField.module.css';

function Root({ children }: { children: ReactNode }) {
  return <div className={styles.field}>{children}</div>;
}
function Label({ children, ...rest }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...rest} className={styles.label}>{children}</label>;
}
function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={[styles.input, props.className].filter(Boolean).join(' ')} />;
}
function ErrorText({ children }: { children: ReactNode }) {
  return children ? <div className={styles.error}>{children}</div> : null;
}

export const FormField = Object.assign(Root, { Label, Input, Error: ErrorText });
```

```css
.field { display: flex; flex-direction: column; gap: var(--space-1); margin-bottom: var(--space-3); }
.label { font-size: var(--fs-xs); color: var(--fg-dim); }
.input {
  font: inherit; color: var(--fg); background: var(--bg);
  border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-2);
}
.input:focus { outline: 1px solid var(--accent); }
.error { font-size: var(--fs-xs); color: var(--accent-red); }
```

- [ ] **Step 2:** Commit `feat(ui): add FormField compound primitive`.

---

### Task 11: `ListRow` primitive

**Files:** `src/components/ui/ListRow/{ListRow.tsx, ListRow.module.css, index.ts}`

- [ ] **Step 1: Implement**

```tsx
import type { HTMLAttributes, ReactNode } from 'react';
import styles from './ListRow.module.css';

interface ListRowProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean;
  icon?: ReactNode;
  trailing?: ReactNode;
  indent?: number;
  children: ReactNode;
}

export function ListRow({
  selected, icon, trailing, indent = 0, className, children, ...rest
}: ListRowProps) {
  const cls = [styles.row, selected && styles.selected, className].filter(Boolean).join(' ');
  return (
    <div {...rest} className={cls} style={{ paddingLeft: `calc(${indent} * var(--space-3) + var(--space-2))` }}>
      {icon && <span className={styles.icon}>{icon}</span>}
      <span className={styles.label}>{children}</span>
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </div>
  );
}
```

```css
.row {
  display: flex; align-items: center; gap: var(--space-2);
  padding: 4px var(--space-2); cursor: pointer; font-size: var(--fs-md);
  user-select: none; min-width: 0;
}
.row:hover { background: var(--bg-hover); }
.selected { background: var(--bg-hover); }
.icon { display: inline-flex; width: 16px; justify-content: center; color: var(--fg-dim); }
.label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.trailing { color: var(--fg-dim); font-size: var(--fs-xs); }
```

`paddingLeft` inline is a *dynamic* style (computed from a prop) — allowed by the spec rule.

- [ ] **Step 2:** Commit `feat(ui): add ListRow primitive`.

---

### Task 12: `ResizableSplit` primitive

**Files:** `src/components/ui/ResizableSplit/{ResizableSplit.tsx, ResizableSplit.module.css, index.ts}`

- [ ] **Step 1: Implement**

```tsx
import { Children, type ReactNode } from 'react';
import { useResizable } from '../hooks/useResizable';
import styles from './ResizableSplit.module.css';

interface Props {
  direction: 'horizontal' | 'vertical';
  initial: number; min: number; max: number;
  storageKey?: string;
  children: [ReactNode, ReactNode]; // exactly two children
}

export function ResizableSplit({ direction, initial, min, max, storageKey, children }: Props) {
  const { size, handlers } = useResizable({ initial, min, max, direction, storageKey });
  const [a, b] = Children.toArray(children);
  const aStyle = direction === 'horizontal' ? { width: size, flex: '0 0 auto' } : { height: size, flex: '0 0 auto' };
  return (
    <div className={direction === 'horizontal' ? styles.h : styles.v}>
      <div className={styles.pane} style={aStyle}>{a}</div>
      <div className={direction === 'horizontal' ? styles.handleH : styles.handleV} {...handlers} />
      <div className={styles.paneFlex}>{b}</div>
    </div>
  );
}
```

```css
.h { display: flex; flex-direction: row; width: 100%; height: 100%; min-height: 0; }
.v { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; }
.pane { min-width: 0; min-height: 0; overflow: hidden; }
.paneFlex { flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.handleH { width: 4px; cursor: col-resize; background: transparent; }
.handleH:hover { background: var(--border); }
.handleV { height: 4px; cursor: row-resize; background: transparent; }
.handleV:hover { background: var(--border); }
```

- [ ] **Step 2:** Commit `feat(ui): add ResizableSplit primitive`.

---

### Task 13: Barrel export

**Files:** `src/components/ui/index.ts`

- [ ] **Step 1: Add re-exports**

```ts
export * from './Button';
export * from './IconButton';
export * from './Panel';
export * from './Toolbar';
export * from './Dialog';
export * from './FormField';
export * from './ListRow';
export * from './ResizableSplit';
export * from './Stack';
export * from './Text';
export * from './hooks/useDisclosure';
export * from './hooks/useResizable';
export * from './hooks/useFocusTrap';
```

- [ ] **Step 2: Type check** — `npm run -s typecheck` (or `tsc --noEmit`) — PASS.

- [ ] **Step 3: Vitest** — `npx vitest run` — all existing + new tests PASS.

- [ ] **Step 4: Smoke test** — `npm run dev`, load app — no visual change.

- [ ] **Step 5:** Commit `feat(ui): barrel export design-system primitives`.

---

## PR 2 — Dialogs & ResultsPanel

**Scope:** Mechanical move of feature folders to `features/`. Migrate four dialogs and `ResultsPanel`. Introduce `ViewModeRegistry`. PR is visually no-op.

### Task 14: Mechanical rename `components/<feature>/` → `components/features/<feature>/`

- [ ] **Step 1: Move folders**

```bash
mkdir -p src/components/features
git mv src/components/results src/components/features/results
git mv src/components/ai src/components/features/ai
git mv src/components/connections src/components/features/connections
git mv src/components/editor src/components/features/editor
git mv src/components/saved-scripts src/components/features/saved-scripts
git mv src/components/layout src/components/features/layout
```

- [ ] **Step 2: Rewrite imports** — run a codemod (sed):

```bash
LC_ALL=C find src -name "*.ts" -o -name "*.tsx" | xargs sed -i '' \
  -e "s|components/results|components/features/results|g" \
  -e "s|components/ai|components/features/ai|g" \
  -e "s|components/connections|components/features/connections|g" \
  -e "s|components/editor|components/features/editor|g" \
  -e "s|components/saved-scripts|components/features/saved-scripts|g" \
  -e "s|components/layout|components/features/layout|g"
```

- [ ] **Step 3: Adjust relative imports** inside moved folders (one level deeper now): change `../../store/*` → `../../../store/*`, `../shared/*` → `../../shared/*`, etc. Per file as needed. Verify with `npm run -s typecheck`.

- [ ] **Step 4: Type check + tests pass.**

- [ ] **Step 5:** Commit `refactor: move feature components under components/features/`.

---

### Task 15: Migrate `ConnectionDialog` to `Dialog` + `FormField`

**Files:** `src/components/features/connections/ConnectionDialog.tsx` (rewrite)

- [ ] **Step 1: Rewrite using primitives** — replace the manual backdrop + form layout with `<Dialog>` + repeated `<FormField>` blocks. All inline `style={{…}}` removed. SSH inputs go in a `<details>` block per the existing UX.

- [ ] **Step 2: Snapshot before/after with the app running** — open the connection dialog, save a connection, edit it. Behavior identical.

- [ ] **Step 3: Test** — `src/components/features/connections/__tests__/ConnectionDialog.test.tsx`: renders fields, validation error for empty name, save calls `onSave` with trimmed input.

- [ ] **Step 4:** Commit `refactor(connections): migrate ConnectionDialog to Dialog/FormField`.

---

### Task 16: Migrate `HostKeyDialog`, `PassphraseDialog`, `SaveScriptDialog`

Same recipe as Task 15. Each gets its own commit.

- [ ] Migrate `HostKeyDialog.tsx` → Commit.
- [ ] Migrate `PassphraseDialog.tsx` → Commit.
- [ ] Migrate `SaveScriptDialog.tsx` → Commit.

---

### Task 17: Introduce `ViewModeRegistry` for results views

**Files:**
- Create: `src/components/features/results/viewModes/ViewModeRegistry.ts`
- Create: `src/components/features/results/viewModes/TableViewMode.tsx`
- Create: `src/components/features/results/viewModes/JsonViewMode.tsx`
- Create: `src/components/features/results/viewModes/index.ts`

- [ ] **Step 1: Define interface and registry**

```ts
// ViewModeRegistry.ts
import type { ReactNode } from 'react';
import type { ResultGroup } from '../../../../types';

export interface ResultViewMode {
  id: string;            // 'table' | 'json' | …
  label: string;         // shown in UI selector
  Component: (props: { group: ResultGroup }) => ReactNode;
}

class Registry {
  private byId = new Map<string, ResultViewMode>();
  register(mode: ResultViewMode) { this.byId.set(mode.id, mode); }
  get(id: string) { return this.byId.get(id); }
  list() { return Array.from(this.byId.values()); }
}

export const viewModeRegistry = new Registry();
```

Top-of-file comment: *"To add a new result view (Tree, Chart, …): implement `ResultViewMode`, register on module load in `viewModes/index.ts`."*

- [ ] **Step 2: Adapt existing `TableView` and `JsonView` as `TableViewMode`, `JsonViewMode`**.

- [ ] **Step 3: Self-register in `viewModes/index.ts`**

```ts
import { viewModeRegistry } from './ViewModeRegistry';
import { TableViewMode } from './TableViewMode';
import { JsonViewMode } from './JsonViewMode';
viewModeRegistry.register(TableViewMode);
viewModeRegistry.register(JsonViewMode);
export * from './ViewModeRegistry';
```

- [ ] **Step 4:** Commit `feat(results): introduce ViewModeRegistry`.

---

### Task 18: Refactor `ResultsPanel.tsx` into sub-components

**Files:**
- Modify: `src/components/features/results/ResultsPanel.tsx` (shrink ≤ 250L)
- Create: `src/components/features/results/ResultsToolbar.tsx`
- Create: `src/components/features/results/ResultsPagination.tsx`
- Create: `src/components/features/results/ConsolePanel.tsx`
- Create: `src/components/features/results/ErrorBanner.tsx`
- Create: `*.module.css` per file
- Test: extend existing tests under `src/components/features/results/__tests__/`

- [ ] **Step 1: Extract `ErrorBanner`** — wraps `<Text variant="error" selectable>` in a padded container. Props: `message: string`. The current `{res.lastError && <div style={…}>{res.lastError}</div>}` block becomes `<ErrorBanner message={res.lastError} />`.

- [ ] **Step 2: Extract `ResultsToolbar`** — view-mode selector (driven by `viewModeRegistry.list()`), export-CSV button, export-JSON button, refresh, etc.

- [ ] **Step 3: Extract `ResultsPagination`** — page-size dropdown, page nav buttons, "showing X-Y of Z".

- [ ] **Step 4: Extract `ConsolePanel`** — the `<pre>` log output.

- [ ] **Step 5: Trim `ResultsPanel.tsx`** — orchestrates: stores, modal, registers `RecordActions`, dispatches active view via `viewModeRegistry.get(view)?.Component`.

- [ ] **Step 6: Run tests + smoke** — open results, switch views, paginate, view error, copy error with Cmd+C.

- [ ] **Step 7:** Commit `refactor(results): decompose ResultsPanel into ResultsToolbar/ResultsPagination/ConsolePanel/ErrorBanner`.

---

### Task 19: PR 2 acceptance

- [ ] `git grep -nE 'style=\{\{' src/components/features/results src/components/features/connections | grep -v -E 'paddingLeft|width:|height:|flex:' | wc -l` returns 0 (no static color/spacing literals).
- [ ] All vitest suites pass.
- [ ] Manual: connect / edit connection / cancel host key / type passphrase / save script / run query / view error / Cmd+C error / paginate / switch view.

---

## PR 3 — AI Chat & App Shell

### Task 20: Refactor `AIChatPanel.tsx`

**Files:**
- Modify: `src/components/features/ai/AIChatPanel.tsx` (≤ 220L)
- Create: `AIChatHeader.tsx`, `AIChatMessageList.tsx`, `AIChatInput.tsx`
- Create: matching `.module.css`

- [ ] **Step 1: Extract `AIChatHeader`** — title, clear-context `IconButton`, open-settings `IconButton`, collapse `IconButton`.
- [ ] **Step 2: Extract `AIChatMessageList`** — virtualization not needed (already scrolls). Receives `messages: ChatMessage[]`, renders `AIMessageBubble` per item.
- [ ] **Step 3: Extract `AIChatInput`** — textarea autosize, send button, keyboard handling (Enter / Shift+Enter). Existing `MIN_TEXTAREA_ROWS`/`MAX_TEXTAREA_ROWS` constants move here.
- [ ] **Step 4: Replace width-resize with `ResizableSplit`** at the call site, OR keep panel docked-right and use `useResizable({ direction: 'horizontal', storageKey: 'ai.panel.width' })` for the left-edge drag handle. (Decision: keep current approach using `useResizable` — `ResizableSplit` is for in-tree splits, not edge-docked panels.)
- [ ] **Step 5:** Commit `refactor(ai): decompose AIChatPanel`.

---

### Task 21: Refactor `App.tsx`

**Files:**
- Modify: `src/App.tsx` (≤ 250L)
- Create: `src/components/features/layout/AppShell.tsx`
- Create: `src/components/features/layout/AppContextProviders.tsx`
- Create: `src/components/features/layout/AppKeyboardWiring.tsx`

- [ ] **Step 1: Extract providers** — wrap children with all current context providers in `AppContextProviders`.
- [ ] **Step 2: Extract keyboard wiring** — `useEffect` that registers shortcuts via `KeyboardService` and `recordActionRegistry`.
- [ ] **Step 3: Extract shell** — three-column layout using `ResizableSplit` (IconRail | SidePanel | (Editor over Results)). Side-dock AIChatPanel.
- [ ] **Step 4: `App.tsx` is now**:

```tsx
export default function App() {
  return (
    <AppContextProviders>
      <AppKeyboardWiring />
      <AppShell />
    </AppContextProviders>
  );
}
```

- [ ] **Step 5:** Commit `refactor(app): decompose App.tsx into AppShell / Providers / KeyboardWiring`.

---

### Task 22: Refactor `ConnectionPanel.tsx`

**Files:**
- Modify: `src/components/features/connections/ConnectionPanel.tsx` (≤ 200L)
- Create: `ConnectionPanelHeader.tsx`, `ConnectionSearchBar.tsx`

- [ ] **Step 1: Wrap content in `<Panel>` + `<Panel.Header>`** with title and add-connection `IconButton` in `right`.
- [ ] **Step 2: Extract search bar.**
- [ ] **Step 3: Use `ListRow` inside `ConnectionTree`** for entries — pass `selected`, `onClick`, `onContextMenu`, `icon`, `indent` per node.
- [ ] **Step 4:** Commit `refactor(connections): decompose ConnectionPanel`.

---

### Task 23: PR 3 acceptance

- [ ] `wc -l src/App.tsx src/components/features/ai/AIChatPanel.tsx src/components/features/connections/ConnectionPanel.tsx` all under thresholds.
- [ ] Manual: open/close AI panel, resize it, switch tab (per-tab chat history isolated), submit AI message, clear context, open settings; resize main split; expand connection tree; search; right-click connection.

---

## PR 4 — Remaining feature files

### Task 24: Refactor `EditorArea.tsx`

**Files:**
- Modify: `src/components/features/editor/EditorArea.tsx` (≤ 240L)
- Possibly extract: `EditorTabBar.tsx`, `EditorEmptyState.tsx`

- [ ] **Step 1: Identify substructure** (tab bar, editor host, empty state).
- [ ] **Step 2: Extract.** Use `<Toolbar>` for tab row container.
- [ ] **Step 3:** Commit `refactor(editor): decompose EditorArea`.

---

### Task 25: Refactor `SavedScriptsPanel.tsx`

- [ ] Wrap in `<Panel>` + `<Panel.Header>`.
- [ ] Convert each saved-script row to `<ListRow>` with `icon`, `trailing` (delete `IconButton`).
- [ ] Commit `refactor(saved-scripts): use Panel + ListRow`.

---

### Task 26: Refactor `ContextBar.tsx`, `IconRail.tsx`, `StatusBar.tsx`, `SidePanel.tsx`

- [ ] `ContextBar` → `<Toolbar>` with breadcrumb segments as left content.
- [ ] `IconRail` → `<VStack>` of `<IconButton pressed={…} />`.
- [ ] `StatusBar` → `<Toolbar>` variant or its own tiny styled component (it's already 32L; just remove inline styles).
- [ ] `SidePanel` → `<Panel>` shell that picks the active sub-panel.
- [ ] One commit per file.

---

### Task 27: Final inline-style sweep

- [ ] **Step 1:** Run

```bash
grep -rEn 'style=\{\{' src/components/features/ src/App.tsx
```

- [ ] **Step 2:** For each hit, decide:
  - Dynamic pixel from a prop / runtime value (e.g., `style={{ width: size }}`) → **keep**.
  - Static color / spacing / padding / margin → move to `.module.css`.

- [ ] **Step 3:** Verify

```bash
grep -rEn '(color:|background:|padding:|margin:)' src/components/features/ src/App.tsx | grep -v '\.css' | wc -l
```

returns 0.

- [ ] **Step 4:** Commit `chore(ui): final inline-style sweep`.

---

### Task 28: PR 4 acceptance & overall acceptance

- [ ] No file in `src/components/features/` exceeds 280 lines (`find src/components/features -name "*.tsx" -exec wc -l {} + | sort -rn | head`).
- [ ] `git grep -nE 'style=\{\{' src/components/features/ src/App.tsx | wc -l` < 20.
- [ ] `npx vitest run` — all pass.
- [ ] `npm run -s typecheck` — clean.
- [ ] `npm run build` — clean.
- [ ] Manual smoke (full pass): connect (with and without SSH), expand DB/collection tree, open new tab, run query (table + JSON), error state with Cmd+C, full record view F3 and edit F4, paginate, export CSV, export JSON, open AI chat, send AI message, switch tab (AI history isolated), open settings, change theme, open all plugin panels, resize all splits, restart app — sizes persisted.

---

## Final acceptance against spec

Every numbered item in `2026-05-27-ui-design-system-refactor-design.md §Acceptance` must hold. If any fails, the failing task reopens.
