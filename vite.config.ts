import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * `runner/query-classifier.js` is CommonJS (`module.exports`) because the Node
 * harness loads it via `require()`. Vite's dev server serves source `.js` as
 * native ESM and does NOT wrap CJS, so importing it in the browser bundle throws
 * `module is not defined` at module-eval (which aborts app boot). This plugin
 * rewrites that one file's trailing `module.exports = { ... }` into an ESM
 * `export { ... }` for the browser bundle only — the on-disk file the harness
 * requires is untouched. All exported names are top-level declarations, so the
 * named-export form is equivalent.
 */
function classifierCjsToEsm(): Plugin {
  return {
    name: 'classifier-cjs-to-esm',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('runner/query-classifier.js')) return null;
      const out = code.replace(
        /module\.exports\s*=\s*\{([\s\S]*?)\}\s*;?/,
        (_m, names: string) => `export {${names}}`,
      );
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  plugins: [classifierCjsToEsm(), react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
