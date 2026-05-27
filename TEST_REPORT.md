# PR 1 Test Report
Date: 2026-05-28T00:30:00Z
Worktree: .claude/worktrees/feat-ui-design-system-pr1-foundations
Branch: worktree-feat-ui-design-system-pr1-foundations

## 1. vitest         — PASS (543 tests, 90 files)
Command: `npx vitest run --reporter=default`
Baseline 527 + 16 new primitive tests across:
- `src/components/ui/Button/__tests__/Button.test.tsx` (3 tests)
- `src/components/ui/IconButton/__tests__/IconButton.test.tsx` (3 tests)
- `src/components/ui/Panel/__tests__/Panel.test.tsx` (2 tests)
- `src/components/ui/hooks/__tests__/useDisclosure.test.ts` (3 tests)
- (plus other primitive tests folded into existing files; total delta = 543 − 527 = 16)

Duration 11.48s. Zero failures.

Pre-existing noise (NOT introduced by PR 1):
- `layout.test.tsx` logs `TypeError: Cannot read properties of undefined (reading 'invoke')` and `act(...)` warnings in stderr — these come from Tauri-store/settings persistence under jsdom, unrelated to primitives. Tests still pass.

## 2. tsc --noEmit   — PASS
Command: `npx tsc --noEmit`
Exit 0, no diagnostics.

## 3. npm run build  — PASS
Command: `npm run build` (`tsc && vite build`)
- 507 modules transformed
- Output: `dist/assets/index-CD4ouDeH.js` 664.98 kB (gzip 203.79 kB), `index-DwfhLJgN.css` 1.48 kB
- Built in 919 ms

Pre-existing warnings (unrelated to PR 1):
- Static + dynamic import mix on `src/ipc.ts` and `src/plugins/sandbox/moduleLoader.ts` (informational; both predate this branch).
- Chunk-size > 500 kB warning (pre-existing).

## 4. dev smoke      — PASS (port 1420 reachable)
Command: `npm run dev` (Vite bound to Tauri's configured port 1420, not 5173).
- Logs `VITE v5.4.21 ready in 172 ms` and `Local: http://localhost:1420/`.
- `curl -sI http://localhost:1420/` → `HTTP/1.1 200 OK`.
- Dev server killed cleanly after probe.

## 5. cargo check    — PASS
Command: `cd src-tauri && cargo check`
- Workspace compiled clean in `dev` profile (1m 03s).
- Exit 0, no errors.

## Notes
- Visual identity not headlessly verifiable; PR 1 touches no consumer files (primitives only — Button, IconButton, Panel, useDisclosure), so visual delta should be 0 by construction. The user must confirm visually in PR 2+ when primitives are adopted by consumers.
- Console errors observed during test run: only the pre-existing Tauri-store invoke TypeError and React `act()` warnings from `layout.test.tsx`, both unrelated to PR 1 primitives.
- Dev server's reported port differs from the task description's expected 5173 — the project configures Vite for 1420 (`vite.config.ts`), so 1420 is correct.
