import type { ReactNode } from 'react';

/**
 * App-wide context providers. Currently a passthrough — the app has no
 * top-level contexts yet (CellSelectionProvider lives inside ResultsPanel
 * because selection is panel-scoped, and the LoggerProvider lives in
 * `main.tsx` so it wraps the entire React root).
 *
 * Extension point: when a new context needs to wrap the whole shell (e.g.
 * a ThemeProvider or a feature-flag provider), add it here so the wiring
 * stays in one place. No other code in `App.tsx` should need to change.
 */
export function AppContextProviders({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
