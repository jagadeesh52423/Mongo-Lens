import { loader } from '@monaco-editor/react';
import { getTheme } from './registry';

export const MONACO_THEME_ID = 'mongodb-dark';

export function applyTheme(themeId: string): void {
  const theme = getTheme(themeId);
  if (!theme) return;
  const root = document.documentElement;
  Object.entries(theme.variables).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });
}

export function applyMonacoTheme(themeId: string): void {
  const theme = getTheme(themeId);
  if (!theme) return;
  const vars = theme.variables;
  const bg = vars['--bg'] ?? '#001e2b';
  const panel = vars['--bg-panel'] ?? bg;
  const base = isLightColor(bg) ? 'vs' : 'vs-dark';

  loader.init().then((monaco) => {
    monaco.editor.defineTheme(MONACO_THEME_ID, {
      base,
      inherit: true,
      rules: [],
      colors: {
        'editor.background': bg,
        'editor.lineHighlightBackground': panel,
        'editorGutter.background': bg,
        'minimap.background': bg,
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
