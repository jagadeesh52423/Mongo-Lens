# Code Review — ai-selection-context

Reviewer: reviewer-ai
Scope: `git diff main...HEAD` (working tree, not yet committed)
Files reviewed:
- `src/types.ts`
- `src/store/editor.ts`
- `src/components/editor/ScriptEditor.tsx`
- `src/components/editor/EditorArea.tsx`
- `src/services/ai/ContextCollector.ts`
- `TEST_REPORT.md` (new)

Verdict: **APPROVED.** No blocking issues found across both stages. Coder-ai did not need iteration.

---

## Stage 1 — Spec compliance

| Spec item | Result | Evidence |
|---|---|---|
| Empty/whitespace selection → byte-identical AI prompt | PASS | `SelectionContextCollector.collect()` returns `''` when `activeTabId` is null, when `sel` is missing, or when `sel.text.trim()` is empty. `ContextCollector.collectAll()` filters empty parts before joining, so the assembled prompt is byte-identical to pre-change behavior in those cases. (`src/services/ai/ContextCollector.ts:37-45`, `:142-153`) |
| Non-empty selection → `Selected portion (lines X–Y):` block with fenced code | PASS | Literal format: `Selected portion (lines ${startLine}–${endLine}):\n\`\`\`\n${text}\n\`\`\``. Dash is U+2013 en-dash, matching the spec. (`src/services/ai/ContextCollector.ts:43`) |
| 1-based Monaco line numbers | PASS | Lines come straight from `e.selection.startLineNumber` / `endLineNumber`, which Monaco emits 1-based. Backward selections (drag-up) are normalised via `Math.min/Math.max`. (`src/components/editor/ScriptEditor.tsx:78-94`) |
| Registered in existing collector registry, no if/else dispatch | PASS | Added as the 3rd entry in the default `collectors` array; no type-switching anywhere. (`src/services/ai/ContextCollector.ts:131-138`) |
| Extensibility — new collectors / future QueryResultLocator without modifying existing code | PASS | `ContextCollectorInterface` is the plugin point (documented inline, `:11-20`). Constructor accepts an injected `collectors[]` array, so additional collectors can be appended without touching existing classes. |
| Option 3 skipped with informative TODO | PASS | Multi-line TODO in `SelectionContextCollector`'s class JSDoc names the future `QueryResultLocator` strategy, references the harness investigation in `TEST_REPORT.md`, and explicitly states existing collectors stay closed for modification. No half-built scaffolding committed. (`src/services/ai/ContextCollector.ts:29-35`) |
| `.claude/superpowers/` not committed | PASS | `.gitignore` already lists `.claude/` and `.superpowers/`. `git check-ignore` confirms `.claude/superpowers` is ignored. |
| No over-building / no new global store | PASS | Selection state added to existing `useEditorStore` (not a new store), per spec. No extra abstractions or helpers beyond what is needed. |

---

## Stage 2 — Quality review

Reviewed against /code-standards-style criteria (Open/Closed, plugin extensibility, comment quality, no dead code, no hidden regressions).

### CLAUDE.md compliance

Global `~/.claude/CLAUDE.md`:
- **Extensibility-First / Open-Closed**: New behaviour added by introducing a class implementing the existing interface, without editing existing collectors. PASS.
- **No hardcoded enumerations**: Collector chain remains a plain array; no `if (type ==…)` branching. PASS.
- **Name plugin points explicitly**: `ContextCollectorInterface` already carries the "implement this interface to add a new context source" comment; the new TODO uses the same idiom. PASS.
- **Composition over inheritance**: Plain class implementing an interface, injected via constructor array. PASS.
- **Git hygiene — never commit superpowers**: Verified via `.gitignore` + `git check-ignore`. PASS.

Project `CLAUDE.md`:
- The harness deployment rule applies only to `runner/*.js` edits. No `runner/` files were touched (verified by `git diff --stat`). N/A.

### Bug scan

- **Backward (drag-up) selection direction**: Handled via `Math.min`/`Math.max` normalisation in `ScriptEditor.tsx:85-88`. Correct.
- **Tab close → selection leak**: `closeTab` strips the selection entry from the `selections` map via destructure-and-rest. (`src/store/editor.ts:88-93`) No leak.
- **Reference-equality guard in `setSelection`**: Compares `text`/`startLine`/`endLine`. Prevents subscriber churn when Monaco fires identical selection events. Behaviour is identical to the prior local-state version. (`src/store/editor.ts:39-54`)
- **`activeSelection` truthiness in `EditorArea`**: Pre-change, `selections[id]` was `string | null` and `!selections[id]` was falsy for null/empty-string. Post-change, the type is `EditorSelection | null`. The prior implementation in `ScriptEditor` never stored empty strings (`sel.length > 0 ? sel : null`), and the new implementation likewise sends `null` for zero-length; so `!activeSelection` semantics are unchanged in practice. No regression in the `currentStatement`/`highlightRange` derivation. (`src/components/editor/EditorArea.tsx:72-80`)
- **Execution modes still receive `string | null`**: `handleExecute` extracts `.text` from the new shape with optional chaining; same payload as before. (`src/components/editor/EditorArea.tsx:117`) No regression for run-selection mode.
- **Whitespace-only selection**: `ScriptEditor` still stores it (length > 0), but the collector skips it via `trim()`. Store/UI behaviour is unchanged from pre-PR (which also stored whitespace strings); the AI prompt enforces the byte-identical guarantee, which is exactly what the spec requires.
- **Concurrent selection updates**: Collector calls `getState()` synchronously inside `collect()` — same pattern as the four existing collectors. No new race surface.
- **Backtick collision in selected text**: A user selecting code containing ``` would break the fenced block. This risk is pre-existing (`EditorContextCollector` has the identical pattern, `:54`). Not introduced by this PR — out of scope.

### Code comments compliance

`ContextCollectorInterface` carries a "keep `collect()` cheap" hint (`:14-16`). The new collector reads two fields from a Zustand store snapshot and runs a single `trim()` — well within budget. PASS.

### TEST_REPORT.md

Harness investigation is concise and concrete (names file/line refs for harness `emitGroup` and `splitStatements`). Manual repro paths cover all five scenarios that tester-ai will exercise. PASS.

---

## Issues found

None at blocking severity. None at score ≥ 80.

Two cosmetic observations (deliberately not requested as fixes):
1. The TODO inside `SelectionContextCollector` is rendered as multi-line JSDoc rather than a one-line `// TODO`. This matches surrounding multi-line JSDocs for other collectors in the same file and is consistent project style.
2. The reference-equality guard in `setSelection` could short-circuit to `s` when `current === selection` only, but it also handles the deep-equal-by-fields case to absorb Monaco's frequent event firings. This is a sensible micro-optimisation, not over-building.

---

## Final result

Spec compliance: PASS.
Code quality: PASS.

STATUS: APPROVED. Cleared to proceed to task #4 (testing).
