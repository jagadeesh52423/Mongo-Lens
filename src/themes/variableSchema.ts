export type VariableKind = 'color' | 'font';
export type VariableGroup = 'Background' | 'Foreground' | 'Border' | 'Accents' | 'Syntax' | 'Fonts';

export interface VariableSpec {
  name: string;
  label: string;
  group: VariableGroup;
  kind: VariableKind;
}

export const VARIABLE_SCHEMA: VariableSpec[] = [
  // Background / surfaces
  { name: '--bg',             label: 'Background',           group: 'Background', kind: 'color' },
  { name: '--bg-elev-1',      label: 'Surface · raised 1',   group: 'Background', kind: 'color' },
  { name: '--bg-elev-2',      label: 'Surface · raised 2',   group: 'Background', kind: 'color' },
  { name: '--bg-elev-3',      label: 'Surface · raised 3',   group: 'Background', kind: 'color' },
  { name: '--bg-rail',        label: 'Rail background',      group: 'Background', kind: 'color' },
  { name: '--bg-panel',       label: 'Editor surface',       group: 'Background', kind: 'color' },
  // Foreground
  { name: '--fg',             label: 'Foreground',           group: 'Foreground', kind: 'color' },
  { name: '--fg-muted',       label: 'Foreground · muted',   group: 'Foreground', kind: 'color' },
  { name: '--fg-dim',         label: 'Foreground · dim',     group: 'Foreground', kind: 'color' },
  // Border
  { name: '--border',         label: 'Border',               group: 'Border',     kind: 'color' },
  { name: '--border-strong',  label: 'Border · strong',      group: 'Border',     kind: 'color' },
  // Accents
  { name: '--accent',         label: 'Accent',               group: 'Accents',    kind: 'color' },
  { name: '--accent-press',   label: 'Accent · pressed',     group: 'Accents',    kind: 'color' },
  { name: '--accent-contrast',label: 'Accent · on-text',     group: 'Accents',    kind: 'color' },
  { name: '--accent-green',   label: 'Accent · green',       group: 'Accents',    kind: 'color' },
  { name: '--accent-red',     label: 'Accent · red',         group: 'Accents',    kind: 'color' },
  { name: '--accent-red-dim', label: 'Accent · red (dim)',   group: 'Accents',    kind: 'color' },
  { name: '--accent-blue',    label: 'Accent · blue',        group: 'Accents',    kind: 'color' },
  { name: '--accent-blue-dim',label: 'Accent · blue (dim)',  group: 'Accents',    kind: 'color' },
  // Syntax
  { name: '--syntax-key',     label: 'Syntax · keyword',     group: 'Syntax',     kind: 'color' },
  { name: '--syntax-string',  label: 'Syntax · string',      group: 'Syntax',     kind: 'color' },
  { name: '--syntax-number',  label: 'Syntax · number',      group: 'Syntax',     kind: 'color' },
  { name: '--syntax-func',    label: 'Syntax · function',    group: 'Syntax',     kind: 'color' },
  { name: '--syntax-punct',   label: 'Syntax · punctuation', group: 'Syntax',     kind: 'color' },
  // Fonts
  { name: '--font-mono',      label: 'Monospace font',       group: 'Fonts',      kind: 'font' },
  { name: '--font-sans',      label: 'Sans font',            group: 'Fonts',      kind: 'font' },
];

export const VARIABLE_GROUP_ORDER: VariableGroup[] =
  ['Background', 'Foreground', 'Border', 'Accents', 'Syntax', 'Fonts'];
