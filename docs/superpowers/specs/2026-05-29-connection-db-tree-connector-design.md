# Design: Connection → Database Tree Connectors (file-tree elbows)

**Date:** 2026-05-29
**Status:** Approved (design)
**Topic:** Make the active-connection subtree read as one nested tree by drawing file-tree elbow connectors (├─ └─ │) at both the connection→database and database→collection levels.

---

## 1. Problem

In the Connections panel, collections nest under their database with an indent **and** a hairline vertical guide (`ConnectionTree.module.css` `.children::before`), but database rows sit at nearly the same indent as the connection header with **no** connector — so databases read as siblings of the connection, not its children ("disconnected and independent").

## 2. Goal

Render the active connection's subtree (databases + collections) as a classic file-tree with **elbow connectors**:
- The connection header (rendered by `ConnectionPanel`, outside `ConnectionTree`) is the **root** — no connector.
- Each **database** gets `├─` if more databases follow, `└─` if it is the last.
- Each **collection** gets `├─`/`└─` within its database, preceded by a continuation `│` when the parent database is **not** the last (and a blank gutter when it is).

Matches the approved preview:
```
▾ ● staging-cluster        ◉
├─ ▸ admin
├─ ▾ acme_app
│  ├─ users
│  └─ orders
└─ ▸ logs
```

## 3. Rendering technique — CSS-drawn (NOT box-drawing characters)

Connectors are drawn with 1px lines (`var(--border)`) via pseudo-elements on fixed-width, **full-height** guide cells — NOT with `│ ├ └` glyphs (which leave row-to-row gaps in the proportional UI font and look broken in the precision theme). Full-height cells + flush rows make the vertical lines connect seamlessly between rows.

### 3a. Segment model

A pure helper computes, per row, the list of guide segments (outermost → innermost):

```ts
// src/components/features/connections/treeGuides.ts
export type GuideSegment = 'line' | 'tee' | 'elbow' | 'empty';

/**
 * Guide segments for one tree row.
 * @param ancestorsHaveMoreSiblings outermost→innermost parent: true if that ancestor
 *        has siblings after it (draw a continuation line in its column), else false.
 * @param isLast whether THIS row is the last among its own siblings.
 * Returns one segment per column; the final segment is this row's connector
 * ('elbow' when isLast, else 'tee'); each preceding column is 'line' (ancestor has
 * more siblings → continuation) or 'empty'.
 */
export function treeGuides(ancestorsHaveMoreSiblings: boolean[], isLast: boolean): GuideSegment[] {
  return [
    ...ancestorsHaveMoreSiblings.map((more): GuideSegment => (more ? 'line' : 'empty')),
    isLast ? 'elbow' : 'tee',
  ];
}
```

- **Database row** (depth 1, no in-tree ancestors): `treeGuides([], isLastDb)` → `['tee'|'elbow']` (one column).
- **Collection row** (depth 2, ancestor = its database): `treeGuides([dbIsNotLast], isLastCol)` → `['line'|'empty', 'tee'|'elbow']` (two columns).

### 3b. Segment CSS semantics (per guide cell)

Each cell is fixed width (`14px`) and stretches the full row height (parent row `align-items: stretch`). The vertical line sits at the cell's centre column; the elbow's horizontal stub runs from centre to the cell's right edge at mid-height, meeting the row content.

| Segment | Vertical | Horizontal stub |
|---|---|---|
| `empty` | none | none |
| `line` | full height (top→bottom) at centre | none |
| `tee` (├) | full height at centre | mid-height, centre→right |
| `elbow` (└) | top→mid-height at centre | mid-height, centre→right |

Color `var(--border)`; `pointer-events: none`. Disabled under `prefers-reduced-motion` is N/A (static lines).

## 4. Components / files (≤3)

- **`treeGuides.ts`** (new) + **`__tests__/treeGuides.test.ts`** (new) — the pure segment helper + unit tests for last/not-last and ancestor continuation across both levels.
- **`ConnectionTree.tsx`** (modify) — render each db/collection as a custom row: a `.guides` strip (one `.guide` cell per segment, classed by segment) followed by `.content` (the existing caret/▸▾ for dbs, `colIcon` for collections, and the name). Compute `isLastDb`, `dbIsNotLast`, `isLastCol` from array index/length. Preserve ALL existing behavior: lazy db/collection loading, expand/collapse on db click, type-to-search, ArrowUp/Down selection, `Enter`/double-click to open, `rowRefs` `scrollIntoView`, the `selected` highlight and the `list-row-focused` global class used by `.wrap:focus :global(.list-row-focused)`.
- **`ConnectionTree.module.css`** (modify) — add `.treeRow` (flex, `align-items: stretch`, hover/`selected` styles equivalent to the old `ListRow`), `.guides`, `.guide` + `.line`/`.tee`/`.elbow` pseudo-element rules, `.content`. **Remove** `.children` / `.children::before`. Keep `.dbRow` sticky offset, `.caret`, `.colIcon`, `.error`, and the `:focus` highlight rule. Align the depth-1 elbow's vertical roughly under the connection header's caret column (tune `.wrap` padding / cell width).

`ConnectionPanel.tsx`/`.module.css` and the connection header are **unchanged** (connection is the root; its databases' top-level elbows live inside `ConnectionTree`).

## 5. Acceptance criteria

- Databases show `├─`/`└─` (last = `└─`); collections show `│`/blank + `├─`/`└─` exactly per the preview.
- Vertical lines are continuous across rows (no gaps) and use `var(--border)`.
- `ListRow` no longer used by the tree, or if kept, guide cells still render full-height — either is acceptable as long as lines connect.
- Existing tree tests (`src/__tests__/connection-tree.test.tsx`, `src/components/features/connections/__tests__/connection-tree.test.tsx`) still pass (db/collection names render; color-dot test unaffected). Keyboard selection + open-on-Enter/double-click still work.
- New `treeGuides` unit tests pass. `tsc --noEmit` clean. Full `npm test` green.

## 6. Extension contract

`treeGuides` already generalizes to arbitrary depth (N ancestor flags → N+1 columns). A future deeper level (e.g. collection → index) just passes one more ancestor flag; the CSS `.guide` cell rules are depth-agnostic. No other changes needed.
