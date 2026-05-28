import { loader } from '@monaco-editor/react';
import { getTheme } from './registry';
import { getOverrides } from './overrides';

export const MONACO_THEME_ID = 'mongodb-dark';

function mergedVariables(themeId: string): Record<string, string> | null {
  const theme = getTheme(themeId);
  if (!theme) return null;
  return { ...theme.variables, ...getOverrides(themeId) };
}

export function applyTheme(themeId: string): void {
  const merged = mergedVariables(themeId);
  if (!merged) return;
  const root = document.documentElement;
  Object.entries(merged).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

/** Strip a leading '#' so Monaco's `foreground` (which wants bare hex) is happy. */
function bareHex(v: string): string {
  return v.trim().replace(/^#/, '');
}

/**
 * Build Monaco token color rules from a CSS-var reader. Extracted as a pure
 * function so it is unit-testable without the Monaco loader.
 * To add a token mapping: add a row here referencing a --syntax-* var.
 */
export function buildMonacoSyntaxRules(
  read: (name: string) => string,
): { token: string; foreground: string }[] {
  return [
    { token: 'keyword', foreground: bareHex(read('--syntax-key')) },
    { token: 'string', foreground: bareHex(read('--syntax-string')) },
    { token: 'number', foreground: bareHex(read('--syntax-number')) },
    { token: 'identifier', foreground: bareHex(read('--syntax-func')) },
    { token: 'type.identifier', foreground: bareHex(read('--syntax-func')) },
    { token: 'delimiter', foreground: bareHex(read('--syntax-punct')) },
    { token: 'delimiter.bracket', foreground: bareHex(read('--syntax-punct')) },
  ];
}

export function applyMonacoTheme(themeId: string): void {
  const merged = mergedVariables(themeId);
  if (!merged) return;
  const panel = merged['--bg-elev-1'] ?? merged['--bg-panel'] ?? merged['--bg'] ?? '#0a0b0d';
  const base = isLightColor(panel) ? 'vs' : 'vs-dark';
  const read = (name: string) => merged[name] ?? '';
  const rules = buildMonacoSyntaxRules(read).filter((r) => /^[0-9a-fA-F]{6}$/.test(r.foreground));

  loader.init().then((monaco) => {
    monaco.editor.defineTheme(MONACO_THEME_ID, {
      base,
      inherit: true,
      rules,
      colors: {
        'editor.background': panel,
        'editor.lineHighlightBackground': panel,
        'editorGutter.background': panel,
        'minimap.background': panel,
      },
    });
    monaco.editor.setTheme(MONACO_THEME_ID);
  });
}

function isLightColor(hex: string): boolean {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return false;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}
