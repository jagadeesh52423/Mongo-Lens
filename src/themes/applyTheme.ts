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

export function applyMonacoTheme(themeId: string): void {
  const merged = mergedVariables(themeId);
  if (!merged) return;
  const panel = merged['--bg-panel'] ?? merged['--bg'] ?? '#001e2b';
  const base = isLightColor(panel) ? 'vs' : 'vs-dark';

  loader.init().then((monaco) => {
    monaco.editor.defineTheme(MONACO_THEME_ID, {
      base,
      inherit: true,
      rules: [],
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
