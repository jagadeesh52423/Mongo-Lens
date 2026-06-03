# Connection Dialog Redesign + Save-While-Disabled (TLS / SSH / Proxy)

**Date:** 2026-06-03
**Status:** Design — awaiting approval
**Component:** `src/components/features/connections/dialog-v2/` (+ Rust `src-tauri/src/connection/`)

## 1. Goal

Two related improvements to the Add/Edit Connection dialog (`ConnectionDialogV2`):

1. **Visual redesign** — make the dialog look professional. Same layout family
   (titled header · left tab rail · panel · footer) and the same tab set; the
   change is spacing, hierarchy, typography, icons, and control polish.
2. **Save-while-disabled for TLS / SSH / Proxy** — show each feature's fields at
   all times with an enable toggle that is **off by default**, so a user can
   enter connection details, save them while the feature is disabled, and later
   just flip the toggle to activate — without re-entering anything.

Non-goals: no change to the connection flow (still a modal), no new tabs, no
change to auth mechanisms, no change to the connect/test pipeline beyond the
SSH/Proxy enable gate described in §5.

## 2. Approved visual direction

Converged from three mockups (see `.superpowers/brainstorm/`): **"A's header +
tab rail, C's density."**

- **Header (replaces the cramped one-row name field):**
  - Color **chip** on the left — the existing `ColorPicker`, restyled as a ~30px
    rounded chip that opens the swatch popover on click.
  - **Title** = the connection *name*, rendered as a 15px heading. It stays
    editable: a borderless input styled like a heading that reveals a subtle
    border + focus ring only on focus. (Keeps name editing in place; drops the
    "Connection name:" label.)
  - **Subtitle** = small dim, read-only context: `New connection` when adding,
    or `Editing connection · <scheme>` when editing (scheme derived from target:
    `mongodb+srv` / `mongodb` / `direct`).
  - **"Test connection"** — moves here as a quiet ghost button, right-aligned.
- **Tab rail:** two groups with uppercase group labels `CONNECTION` /
  `PREFERENCES` (replacing the dashed `<hr>`). Each tab gets a **line icon**
  (inline SVG, `currentColor`, matching the `ConnectionTree` glyph style) +
  label, a soft rounded **selected pill** (not the left-border bar), and a hover
  state. The existing error dot (red ●) and override dot (amber ●) are preserved.
- **Forms:** **normal-case** labels (`Host`, `Port`), tighter spacing, and
  **monospace** for technical identifier fields (host, port, URI, SSH host/port,
  proxy host/port, replica set). The three short radio groups all become the new
  **SegmentedControl** primitive: target type (2 options), proxy kind (3), and
  SSH auth method (3). Any radio/option list with more than ~4 entries stays a
  native control (none currently exceed that).
- **Footer:** single status region on the left (`✓ Connection OK` / `Testing…` /
  `⚠ N issues` / failure detail — same states as today), `Cancel` + primary
  `Save` on the right.

Visual values reuse `src/styles/tokens.css` (no hardcoded colors): elevations
(`--bg-elev-*`), `--accent`, `--border`, radii, spacing, `--focus-ring`,
`--font-mono`. All states must work across themes (dark/light) via tokens.

## 3. New reusable primitives (extension points)

### 3.1 `SegmentedControl` — `src/components/ui/SegmentedControl/`

A small generic segmented (pill) toggle. **Extension contract:** it renders an
arbitrary list of options; new variants need no edits — callers pass options.

```ts
interface SegmentedOption<T extends string> { value: T; label: string; }
interface SegmentedControlProps<T extends string> {
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}
```

Keyboard + ARIA: `role="radiogroup"` wrapper, each segment `role="radio"`
`aria-checked`, arrow-key navigation. Styled from tokens. Add to
`src/components/ui/index.ts`.

### 3.2 Tab icons + `TabSpec.icon`

- Add an optional `icon: ReactNode` (or `Icon: ComponentType`) field to `TabSpec`
  in `dialog-v2/tabs/types.ts`.
- Add one entry per tab in `dialog-v2/tabs/registry.ts` (Server, Auth, TLS, SSH,
  Proxy, IntelliShell, Tools, Advanced).
- Icons live in a new module `dialog-v2/tabs/icons.tsx` as small inline-SVG
  components (`viewBox="0 0 14 14"`, `stroke="currentColor"`, ~1.2 stroke),
  matching `ConnectionTree.tsx`. **Extension contract:** a future tab supplies
  its own icon in its registry entry — no other file changes.

## 4. Save-while-disabled — shared UI pattern

Applies to **TLS, SSH, Proxy** tab forms. Pattern (identical across the three):

1. **Render fields always**, from a render-fallback blank when the draft has no
   object yet: `const ssh = value.ssh ?? BLANK_SSH_DISABLED`. The fallback is
   **render-only** — it is not written to the draft on open.
2. **Enable toggle** at the top of the tab (a styled checkbox/switch), default
   **off**: `checked = !!value.<feature>?.enabled`. Toggling writes the object
   back preserving fields: `set({ ...current, enabled })`.
3. **Editing any field** materializes/updates the object, preserving `enabled`:
   `set({ ...current, host: e.target.value })`. (Fixes today's bug where
   un-checking wipes sibling fields — we never replace with a bare
   `{ enabled:false }`.)
4. **Disabled fields are editable** (so users can pre-fill) but visually
   de-emphasized when the feature is off (reduced opacity on the field group).
5. **Strip-blank on save** (in `collect`/save path): if a feature is disabled and
   carries no user data, omit it from the saved connection to keep storage tidy.
   Helpers `isBlankTls/isBlankSsh/isBlankProxy` (disabled + all fields empty/
   default). Disabled **with** data is persisted (the whole point).

This requires `enabled` to be representable on each feature (see §5).

## 5. Model, validation, builder, migration changes

### 5.1 TLS — frontend-only
`Tls` already has `enabled` (TS `model.ts` and Rust `model.rs`), and Rust
`apply_tls` already honors it (`Tls::Disabled` when off). **No Rust change.**
Only the TLS tab form + strip-blank helper change.

### 5.2 SSH — add `enabled`
- **TS** `src/connection/model.ts`: add `enabled: boolean` to `SshTunnel`.
- **Rust** `src-tauri/src/connection/model.rs`: add `pub enabled: bool` to
  `SshTunnel` with `#[serde(default = "default_true")]` (absent ⇒ legacy active
  config ⇒ `true`; new disabled saves write `false` explicitly). Add a shared
  `fn default_true() -> bool { true }`.
- **Rust** `builder.rs` `open_ssh_if_configured`: after the `Some(ssh)` bind,
  add `if !ssh.enabled { return Ok(SshStepOutcome::Open(None)); }`.
- **Validation** `validation.ts` `validateSsh`: `if (!ssh || !ssh.enabled) return [];`.
- **Migration**: TS `migrateLegacy` and Rust `build_ssh` set `enabled: true` on
  migrated SSH (legacy tunnels were always active). Update Rust migration
  fixtures under `tests/fixtures/connection/migrated/*.json` to include
  `"enabled": true` where `ssh` is present.

### 5.3 Proxy — add `enabled`
- **TS** `model.ts`: add `enabled: boolean` to `Proxy`.
- **Rust** `model.rs`: add `pub enabled: bool` to `Proxy` with
  `#[serde(default = "default_true")]`.
- **Rust** `builder.rs` `apply_proxy`: after the `Some(proxy)` bind, add
  `if !proxy.enabled { return Ok(()); }`.
- **Validation** `validateProxy`: `if (!proxy || !proxy.enabled) return [];`.
- **Migration**: no legacy proxy source exists (migration omits proxy), so only
  the serde default matters for forward-compat.

### 5.4 New-connection defaults
New drafts: TLS/SSH/Proxy start absent (toggles off). When a user enables one or
types into it, the object materializes with `enabled` as toggled and sensible
defaults (SSH port 22, `knownHostsPolicy: 'strict'`; proxy `socks5`, port 1080).

## 6. Files touched

**Frontend — visual:**
- `dialog-v2/ConnectionDialogV2.tsx` + `.module.css` — header/title/subtitle,
  rail groups + icons + selected pill, footer.
- `dialog-v2/tabs/registry.ts`, `tabs/types.ts` — `icon` field + entries.
- `dialog-v2/tabs/icons.tsx` *(new)* — inline-SVG tab icons.
- `dialog-v2/tabs/ServerTab.tsx` (+ css) — SegmentedControl for target type,
  mono fields, normal labels.
- `ui/SegmentedControl/` *(new)* + `ui/index.ts`.

**Frontend — save-while-disabled:**
- `dialog-v2/tabs/TlsTab.tsx`, `SshTab.tsx`, `ProxyTab.tsx` (+ their css) —
  always-show fields, enable toggle, de-emphasis, no field-wipe.
- `dialog-v2/ConnectionDialogV2.tsx` / a small `collect` helper — strip-blank on
  save (`isBlankTls/Ssh/Proxy`).
- `src/connection/model.ts` — `enabled` on `SshTunnel`, `Proxy`.
- `src/connection/validation.ts` — gate `validateSsh`, `validateProxy`.
- `src/connection/migration.ts` — `enabled: true` on migrated SSH.

**Rust:**
- `src-tauri/src/connection/model.rs` — `enabled` on `SshTunnel`, `Proxy` +
  `default_true`.
- `src-tauri/src/connection/builder.rs` — gate SSH open + proxy apply.
- `src-tauri/src/connection/migration.rs` — `enabled: true` on migrated SSH.
- `tests/fixtures/connection/migrated/*.json` — add `enabled` to ssh blocks.

## 7. Tests

- **Update** existing tab tests that assert "checkbox hides fields": `TlsTab`,
  `SshTab`, `ProxyTab` tests → fields now always present; assert toggle drives
  `enabled` and that data survives toggling off.
- **Update** `ServerTab` test (radio → SegmentedControl roles preserved as
  radiogroup/radio).
- **New** `SegmentedControl` test (selection, keyboard, ARIA).
- **Update** `connection-panel.dialog-v2` test for header/footer structure
  (keep role/label queries stable where possible).
- **Validation** tests: disabled SSH/Proxy with partial data → no issues;
  enabled with missing required → issues.
- **Rust** `builder` tests: disabled SSH does not open a tunnel; disabled proxy
  not applied; enabled paths unchanged. Migration fixture tests updated.

## 8. Risks / decisions

- **Serde default = true for `enabled`:** chosen so an upgrade does not silently
  disable users' existing SSH tunnels / proxies. New disabled records always
  serialize `enabled: false` explicitly, so the default only ever applies to
  pre-upgrade rows. Covered by a Rust deserialization test (absent field ⇒ true).
- **DOM stability:** keep `role`/`aria-label`/`htmlFor` ids stable so most
  existing tests and a11y behavior carry over.
- **No behavior change to test/connect** beyond the SSH/Proxy enable gate.

## 9. Extension contract summary

- New tab → add a `TabSpec` entry with its `icon`; no other edits.
- New segmented toggle anywhere → use `SegmentedControl` with an options array.
- New "optional feature with enable flag" → follow the §4 pattern (render-
  fallback + materialize-on-edit + strip-blank-on-save) and the §5 `enabled` +
  `default_true` + builder-gate recipe.
