import { registerTheme } from './registry';

const FONT_MONO = '"SF Mono", Menlo, Consolas, monospace';
const FONT_SANS =
  '-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif';

registerTheme({
  id: 'mongodb-dark',
  name: 'MongoDB Dark',
  variables: {
    '--bg': '#001e2b',
    '--bg-panel': '#0d2d3c',
    '--bg-rail': '#022e45',
    '--bg-hover': '#1a3d4f',
    '--fg': '#d4d4d4',
    '--fg-dim': '#858585',
    '--border': '#1e4d63',
    '--accent': '#00ed64',
    '--accent-green': '#00ed64',
    '--accent-red': '#f48771',
    '--font-mono': FONT_MONO,
    '--font-sans': FONT_SANS,
  },
});

registerTheme({
  id: 'light',
  name: 'Light',
  variables: {
    '--bg': '#f5f5f5',
    '--bg-panel': '#e8e8e8',
    '--bg-rail': '#dcdcdc',
    '--bg-hover': '#d0d0d0',
    '--fg': '#333333',
    '--fg-dim': '#777777',
    '--border': '#c8c8c8',
    '--accent': '#0066cc',
    '--accent-green': '#008a3c',
    '--accent-red': '#c0392b',
    '--font-mono': FONT_MONO,
    '--font-sans': FONT_SANS,
  },
});

registerTheme({
  id: 'midnight',
  name: 'Midnight',
  variables: {
    '--bg': '#0a0a0a',
    '--bg-panel': '#111111',
    '--bg-rail': '#050505',
    '--bg-hover': '#1a1a1a',
    '--fg': '#aaaaaa',
    '--fg-dim': '#666666',
    '--border': '#2a2a2a',
    '--accent': '#ffffff',
    '--accent-green': '#7cff7c',
    '--accent-red': '#ff7c7c',
    '--font-mono': FONT_MONO,
    '--font-sans': FONT_SANS,
  },
});
