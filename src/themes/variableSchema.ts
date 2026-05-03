export type VariableKind = 'color' | 'font';
export type VariableGroup = 'Background' | 'Foreground' | 'Border' | 'Accents' | 'Fonts';

export interface VariableSpec {
  name: string;
  label: string;
  group: VariableGroup;
  kind: VariableKind;
}

export const VARIABLE_SCHEMA: VariableSpec[] = [
  { name: '--bg',              label: 'Background',          group: 'Background', kind: 'color' },
  { name: '--bg-panel',        label: 'Panel background',    group: 'Background', kind: 'color' },
  { name: '--bg-rail',         label: 'Rail background',     group: 'Background', kind: 'color' },
  { name: '--bg-hover',        label: 'Hover background',    group: 'Background', kind: 'color' },
  { name: '--fg',              label: 'Foreground',          group: 'Foreground', kind: 'color' },
  { name: '--fg-dim',          label: 'Foreground (dim)',    group: 'Foreground', kind: 'color' },
  { name: '--border',          label: 'Border',              group: 'Border',     kind: 'color' },
  { name: '--accent',          label: 'Accent',              group: 'Accents',    kind: 'color' },
  { name: '--accent-green',    label: 'Accent — green',      group: 'Accents',    kind: 'color' },
  { name: '--accent-red',      label: 'Accent — red',        group: 'Accents',    kind: 'color' },
  { name: '--accent-red-dim',  label: 'Accent — red (dim)',  group: 'Accents',    kind: 'color' },
  { name: '--accent-blue',     label: 'Accent — blue',       group: 'Accents',    kind: 'color' },
  { name: '--accent-blue-dim', label: 'Accent — blue (dim)', group: 'Accents',    kind: 'color' },
  { name: '--font-mono',       label: 'Monospace font',      group: 'Fonts',      kind: 'font' },
  { name: '--font-sans',       label: 'Sans font',           group: 'Fonts',      kind: 'font' },
];

export const VARIABLE_GROUP_ORDER: VariableGroup[] =
  ['Background', 'Foreground', 'Border', 'Accents', 'Fonts'];
