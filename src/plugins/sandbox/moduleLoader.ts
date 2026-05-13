// Scrubbed by bare-identifier shadow only. We intentionally do NOT shadow
// `window` / `self` / `globalThis` — bundled libraries (React DOM in
// particular) probe those at module init and break when the binding is
// undefined. The sandbox is a "soft" boundary: it discourages direct use
// of network/storage/Tauri APIs by making the bare identifiers undefined,
// but a plugin that wants to bypass via `window.fetch(...)` can — that's
// covered by the trust-on-install model, not by the wrapper.
const SCRUBBED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'localStorage', 'sessionStorage', 'indexedDB',
  '__TAURI__', '__TAURI_INVOKE__', '__TAURI_INTERNALS__',
];

export function wrapPluginSource(source: string): string {
  const decls = SCRUBBED_GLOBALS.map(g => `  let ${g} = undefined;`).join('\n');
  // Note: the wrapped source is itself an ES module so we use a block, not a function.
  return `// mongo-lens plugin sandbox wrapper\n${decls}\n${source}\n`;
}

export interface LoadedModule {
  activate?: (context: unknown) => unknown | Promise<unknown>;
  deactivate?: () => unknown | Promise<unknown>;
}

export async function loadPluginModule(source: string): Promise<LoadedModule> {
  const wrapped = wrapPluginSource(source);
  const blob = new Blob([wrapped], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return (await import(/* @vite-ignore */ url)) as LoadedModule;
  } finally {
    URL.revokeObjectURL(url);
  }
}
