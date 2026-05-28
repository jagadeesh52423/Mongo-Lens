# Design: "Precision" UI/UX Refactor

**Date:** 2026-05-28
**Status:** Approved (design) — pending spec review
**Topic:** Futuristic, production-quality visual overhaul of mongo-lens

---

## 1. Overview & Goals

Refresh mongo-lens from a functional VS-Code-style clone into a **futuristic, production-quality** desktop app, **without** changing layout or information architecture. The chosen design language is **"Linear Precision"**: near-black surfaces, hairline borders, a single surgically-used accent, immaculate native type, real depth (elevation), and balanced micro-interactions. Futuristic *through restraint*, not neon.

**Ambition (confirmed):** Token-deep visual overhaul **+** bespoke polish on the four hero screens. Keep the current layout/IA.

**Non-goals (YAGNI):**
- No layout/navigation/IA changes.
- No new product features.
- No webfont (we use native SF Pro, not Inter).
- No animation library — CSS transitions/keyframes only.
- No bespoke per-theme hero variants — hero CSS Modules are theme-agnostic (token-driven) so they render correctly in both themes automatically.

## 2. Design DNA (locked decisions)

| Aspect | Decision |
|---|---|
| Direction | Linear Precision — near-black, hairline borders, futuristic via restraint |
| Accent | **Refined Green `#3ddc84`** (dark) — single-accent system |
| Typography | **SF Pro** (native `-apple-system`) for UI; **SF Mono** for code |
| Themes | Two hand-tuned: **`precision-dark`** (flagship) + **`precision-light`**; **retire `orangy` & `midnight`** |
| Motion | **Balanced** micro-interactions; **`prefers-reduced-motion` disables all** |
| Strategy | **Extend the existing token + theme system** (single source of truth) |

## 3. Token System (the foundation)

Today `src/styles/tokens.css` + `src/themes/variableSchema.ts` theme only **color and font**. We grow the token system into the single source of truth for the whole visual language. The split below is dictated by two hard constraints discovered in the code:

- `applyTheme()` (`src/themes/applyTheme.ts`) iterates a theme's `variables` and calls `root.style.setProperty(k, v)` for **every** entry — so any token placed in a theme's `variables` is applied, **whether or not** it is in the schema.
- The Theme Editor (`src/settings/sections/ThemeEditor.tsx`) renders **one row per `VARIABLE_SCHEMA` entry**, and `renderInput` supports only `kind: 'color'` (a 6-hex `<input type=color>`) and `kind: 'font'` (text). Non-hex values (rgba, box-shadow strings) cannot be edited there.

### 3a. Token taxonomy

**A. Global constants — `tokens.css :root`, same across all themes, NOT themeable, NOT in schema**

```
/* radii — retuned upward; the single biggest "modern" tell */
--radius-sm: 6px;  --radius-md: 9px;  --radius-lg: 13px;  --radius-pill: 999px;

/* spacing — unchanged 4px base */
--space-1..6 (existing)

/* type scale — existing fs-xs..lg retained; add larger steps for headers */
--fs-xs:11px; --fs-sm:12px; --fs-md:13px; --fs-lg:15px; --fs-xl:18px; --fs-2xl:22px;

/* motion — one standard duration + easing, used everywhere */
--dur-fast: 120ms;  --dur-base: 180ms;
--ease-standard: cubic-bezier(.2,.6,.2,1);
--ease-out: cubic-bezier(.16,1,.3,1);

/* z-index — existing (--z-dropdown/dialog/tooltip) retained */
```

**B. Global derived — `tokens.css :root`, computed via `color-mix()` from themeable hex, NOT in schema**

These adapt automatically to whatever the active theme sets for `--fg`/`--accent`, and a single formula works for both dark and light, so they need no per-theme duplication and stay out of the editor (they're alpha values).

```
--bg-hover:        color-mix(in srgb, var(--fg) 4.5%, transparent);
--bg-active:       color-mix(in srgb, var(--accent) 10%, transparent);
--accent-soft:     color-mix(in srgb, var(--accent) 12%, transparent);
--focus-ring-color:color-mix(in srgb, var(--accent) 35%, transparent);
--focus-ring:      0 0 0 3px var(--focus-ring-color);
```

Each derived token also gets a static rgba fallback declared *before* the `color-mix` line in `tokens.css` so unsupported engines degrade gracefully (target is macOS WKWebView, which supports `color-mix`; fallback is defensive).

**C. Themeable hex/font — in each theme's `variables` AND in `VARIABLE_SCHEMA` (editable)**

| Group | Tokens |
|---|---|
| Background | `--bg`, `--bg-elev-1`, `--bg-elev-2`, `--bg-elev-3`, `--bg-rail`, `--bg-panel` (retained alias → editor surface) |
| Foreground | `--fg`, `--fg-muted`, `--fg-dim` |
| Border | `--border`, `--border-strong` |
| Accents | `--accent`, `--accent-press`, `--accent-contrast` (on-accent text), `--accent-red`, `--accent-red-dim`, `--accent-blue`, `--accent-blue-dim`, `--accent-green` (alias) |
| Syntax | `--syntax-key`, `--syntax-string`, `--syntax-number`, `--syntax-func`, `--syntax-punct` |
| Fonts | `--font-mono`, `--font-sans` |

**D. Themeable strings — in each theme's `variables`, NOT in schema** (applied by `applyTheme`, skipped by editor because they're not color/font):

```
--shadow-1 / --shadow-2 / --shadow-3   (full box-shadow strings; dark uses heavier black alpha, light uses soft low-alpha cool tint)
--shadow-dialog  (retained alias → --shadow-3)
```

`VARIABLE_GROUP_ORDER` becomes: `Background, Foreground, Border, Accents, Syntax, Fonts`. `variableSchema.ts` adds a `Syntax` group; `VariableGroup` union extends accordingly.

### 3b. Backward-compatibility aliases (retained so un-migrated CSS keeps rendering)

`--bg-panel` (→ same value as `--bg-elev-1`), `--fg-dim` (kept), `--accent-green`, `--accent-red`, `--accent-blue`, `--accent-red-dim`, `--accent-blue-dim`, `--radius-sm/md/lg` (retuned values), `--shadow-dialog` (→ `--shadow-3`). Removed tokens: none required immediately — old names stay valid during/after migration.

## 4. Theme Definitions, Editor & Migration

### 4a. `src/themes/definitions.ts`
Replace the four `registerTheme(...)` calls with **two**: `precision-dark` and `precision-light`. Representative values (final values tuned during implementation against AA contrast):

**`precision-dark`** (flagship — matches approved mockup)
```
--bg:#0a0b0d; --bg-elev-1:#0e1012; --bg-elev-2:#131619; --bg-elev-3:#181b1f; --bg-rail:#08090b; --bg-panel:#0e1012;
--fg:#e6e8eb; --fg-muted:#9aa0a8; --fg-dim:#6b7079;
--border:#1c1f24; --border-strong:#2a2e34;
--accent:#3ddc84; --accent-press:#2fc472; --accent-contrast:#05140c;
--accent-green:#3ddc84; --accent-red:#f0796a; --accent-blue:#7fb3ff; --accent-red-dim:#3a1714; --accent-blue-dim:#16263a;
--syntax-key:#3ddc84; --syntax-string:#e3b341; --syntax-number:#7fb3ff; --syntax-func:#b39bff; --syntax-punct:#9aa0a8;
--shadow-1:0 1px 2px rgba(0,0,0,.45);
--shadow-2:0 6px 18px rgba(0,0,0,.45);
--shadow-3:0 20px 50px rgba(0,0,0,.6);
--font-mono / --font-sans (unchanged)
```

**`precision-light`**
```
--bg:#ffffff; --bg-elev-1:#f7f8fa; --bg-elev-2:#eef0f3; --bg-elev-3:#e7eaee; --bg-rail:#f0f1f4; --bg-panel:#f7f8fa;
--fg:#1a1d21; --fg-muted:#5b6270; --fg-dim:#8a909c;
--border:#e3e6ea; --border-strong:#d2d6dc;
--accent:#12a150; --accent-press:#0e8a44; --accent-contrast:#ffffff;   /* deeper green for contrast on white */
--accent-green:#12a150; --accent-red:#d64a3c; --accent-blue:#2f6fed; --accent-red-dim:#f7d7d2; --accent-blue-dim:#d9e6fb;
--syntax-key:#0a8f4d; --syntax-string:#b06a00; --syntax-number:#1d6fe0; --syntax-func:#7a4ddb; --syntax-punct:#5b6270;
--shadow-1:0 1px 2px rgba(20,30,40,.10);
--shadow-2:0 6px 18px rgba(20,30,40,.12);
--shadow-3:0 20px 50px rgba(20,30,40,.18);
```

### 4b. Theme Editor
No code change required to `ThemeEditor.tsx` — it is schema-driven and will auto-render the new `Syntax` group and all new hex rows. Verify the new `Syntax` group label flows through `VARIABLE_GROUP_ORDER`.

### 4c. Migration (`src/store/settings.ts`)
- `DEFAULT_THEME_ID`: `'mongodb-dark'` → `'precision-dark'`.
- On settings hydrate, map persisted `themeId` through:
  `{ 'mongodb-dark':'precision-dark', 'light':'precision-light', 'orangy':'precision-dark', 'midnight':'precision-dark' }` (unknown/absent → `precision-dark`).
- Persisted `themeOverrides` keyed by retired ids become orphaned (harmless). Optionally remap `mongodb-dark` override bucket → `precision-dark` so a user's prior tweaks survive. Decide during implementation; default: leave orphaned (clean slate on the new flagship).

## 5. Monaco Editor Theme (`src/themes/applyTheme.ts`)
- Keep keying the base on a surface token but read `--bg-elev-1` (fallback `--bg`); update the hardcoded `'#001e2b'` default to the new base.
- Enrich `defineTheme` with `rules[]` mapping JS/Mongo tokens (keyword, string, number, identifier/function, delimiter, comment) to the **computed** values of `--syntax-*`, resolved via `getComputedStyle(document.documentElement).getPropertyValue(...)` at apply time (Monaco needs concrete hex, not `var()`). Re-run on theme change (already wired through `applyMonacoTheme`).
- `MONACO_THEME_ID` may stay `'mongodb-dark'` (internal id; renaming is cosmetic and optional).

## 6. Shared Primitive Refactor (`src/components/ui/*`)
Refit primitives to consume new tokens + add interaction states. CSS-Module-level changes; component APIs unchanged (extension-point doc comments preserved).

- **Button** — replace hardcoded `#001e2b` with `var(--accent-contrast)`; add `:active` press transform + `--shadow-1`; `:focus-visible` → `--focus-ring`; refine `ghost`/`danger`; transitions via motion tokens.
- **IconButton** — hover `--bg-hover`, active state, focus ring, `--radius-md`.
- **Dialog** — `--bg-elev-3`, `--shadow-3`, backdrop blur + dim, `--radius-lg`, entrance transition.
- **Panel** — `--bg-elev-1`, hairline `--border`, `--radius-md`.
- **ListRow** — hover `--bg-hover`, selected `--bg-active` + inset accent bar, transition.
- **Toolbar** — surface + hairline divider, consistent control sizing.
- **FormField** — label/hint scale, input focus ring, error via `--accent-red`.
- **Text / Stack** — wire to `--fs-*` scale + `--fg`/`--fg-muted`/`--fg-dim`.
- **ContextMenu** — `--bg-elev-3`, `--shadow-3`, hover rows, separators.
- **ResizableSplit / SplitHandle** — invisible-until-hover handle that lights to `--accent` on hover/drag.
- **`globals.css`** — base `button`/`input`/`select`/`textarea` to new tokens + `--focus-ring`; thin custom scrollbars (WebKit) using `--border-strong`/transparent.

## 7. Hero Screens (bespoke polish)

1. **App shell + IconRail + StatusBar** (`layout/AppShell`, `IconRail`, `StatusBar`)
   - Layered rail (`--bg-rail`), active item: accent left-indicator bar (`::before`) + `--bg-active` + accent icon.
   - Status bar: `--bg-elev-1`, hairline top, **pulsing connection dot** (keyframe, reduced-motion-gated), tabular-numeric stats.

2. **Editor + Results workspace** (`editor/*`, `results/*`)
   - `EditorTabBar`: active tab accent underline + dirty dot; hover/close affordances.
   - `ContextBar`: rounded **pills** for connection/namespace/mode.
   - Monaco: token-mapped syntax theme (see §5).
   - `ResultsToolbar`: **segmented** Table/JSON toggle (active = `--accent-soft`/`--accent`), refined pagination (tabular numerals), latency/count meta.
   - `TableView` + `cellRenderers`: sticky **uppercase** headers (`--bg-elev-1`), monospace cells, **type-colored values** (ObjectId→`--syntax-func`, string→`--syntax-string`, number→`--syntax-number`, bool→`--accent`), **status badges** (`--accent-soft` / neutral), row hover + selected states.
   - `JsonView`: token-colored, comfortable line-height.

3. **Connection dialog V2** (`connections/dialog-v2/*`)
   - Dialog elevation (`--bg-elev-3`, `--shadow-3`), refined tab rail (active accent), polished form rows/sections, `ColorPicker` swatches with focus ring.

4. **AI panel + floating button** (`ai/*`)
   - Gradient fab (`--accent`→darker) with hover lift + glow (`--shadow-2`).
   - Chat header/message bubbles/input refined to elevation tokens; `CodeBlock` matched to editor syntax palette.

## 8. Motion & Accessibility
- All transitions/animations use `--dur-*` + `--ease-*`. Patterns: hover lifts/tints, focus rings, row/selection/tab transitions, dialog/panel entrances, button press, status-dot pulse, fab hover.
- **Global** `@media (prefers-reduced-motion: reduce) { *,*::before,*::after { animation:none!important; transition:none!important; } }` in `globals.css`.
- Contrast: target WCAG AA for text on `--bg`/elevations in both themes; verify `--fg-dim`/`--fg-muted` and accent-on-surface during implementation.

## 9. Rollout Sequence
1. **Tokens** — expand `tokens.css` (global constants + derived) and `variableSchema.ts` (new groups/rows).
2. **Themes** — rewrite `definitions.ts` (two themes); `settings.ts` default + migration.
3. **Monaco** — `applyTheme.ts` rules + surface token.
4. **Primitives** — `components/ui/*` + `globals.css` (cascades to every screen).
5. **Hero screens** — one at a time, in the order above.
6. **Test/visual sweep** — update any tests asserting retired themes/old values; manual visual pass in both themes.

## 10. Extension Contract (extensibility-first)
- **Add a theme:** create one `registerTheme({...})` in `definitions.ts` with the themeable hex/string tokens. No schema, no component, no editor change.
- **Add a themeable token:** (a) append one row to `VARIABLE_SCHEMA` (color/font kinds render automatically in the editor); (b) add it to each theme's `variables`; (c) add a default in `tokens.css :root`. Derived/alpha or string tokens skip the schema and live only in `tokens.css` (derived) or theme `variables` (strings).
- **Add a Button variant:** unchanged existing contract — extend the union + add a `.variant` rule.

## 11. Testing & Verification
- Existing tests are logic/RTL and mostly token-agnostic. **At risk:** any test asserting the theme set or specific legacy values — `themes/*.test.ts` (`applyTheme.test`, `overrides.test`) and any test referencing `orangy`/`midnight`/`mongodb-dark` ids or `#001e2b`. Update these to the new ids/values.
- `npm test` must pass after each rollout step.
- `color-mix` support: macOS WKWebView (Tauri v2) supports it; static rgba fallbacks precede each derived token.
- Manual: launch app, toggle `precision-dark` ↔ `precision-light`, exercise hero screens, verify reduced-motion (OS setting), verify Theme Editor renders/edits new tokens and Monaco recolors live.

## 12. Risks
- **Monaco var resolution timing** — resolve computed `--syntax-*` *after* `applyTheme` sets them; recolor on every theme switch.
- **CSS-module churn breadth** — many modules touched; mitigated by token cascade (most "changes" are just new var references) and step-wise rollout.
- **Light-theme shadow/contrast tuning** — per-theme `--shadow-*` strings + AA pass address this.
- **Tests referencing retired themes** — enumerated in §11; update alongside §9 step 2.
