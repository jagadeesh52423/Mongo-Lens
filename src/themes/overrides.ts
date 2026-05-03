export type ThemeOverrides = Record<string, Record<string, string>>;

type Listener = () => void;

let state: ThemeOverrides = {};
const listeners: Set<Listener> = new Set();

function notify(): void {
  Array.from(listeners).forEach((l) => l());
}

export function getOverrides(themeId: string): Record<string, string> {
  return { ...(state[themeId] ?? {}) };
}

export function setVariable(themeId: string, varName: string, value: string): void {
  if (!state[themeId]) {
    state[themeId] = {};
  }
  state[themeId][varName] = value;
  notify();
}

export function resetVariable(themeId: string, varName: string): void {
  if (!state[themeId] || !(varName in state[themeId])) {
    return;
  }
  delete state[themeId][varName];
  if (Object.keys(state[themeId]).length === 0) {
    delete state[themeId];
  }
  notify();
}

export function resetTheme(themeId: string): void {
  if (!state[themeId]) {
    return;
  }
  delete state[themeId];
  notify();
}

export function getAllOverrides(): ThemeOverrides {
  return { ...state };
}

// Hydration replaces state wholesale without notifying — avoids a persist write
// for data we just loaded from storage.
export function hydrateOverrides(initial: ThemeOverrides): void {
  state = { ...initial };
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
