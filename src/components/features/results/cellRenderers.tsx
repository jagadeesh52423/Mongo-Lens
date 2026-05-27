import type { ReactNode } from 'react';

export interface CellRenderer {
  matches(value: unknown): boolean;
  render(value: unknown): ReactNode;
  /** String representation used when editing a cell. */
  toEditString(value: unknown): string;
}

/**
 * Factory that enforces type consistency between matches/render/toEditString
 * at definition time while keeping the stored interface non-generic.
 */
export function makeCellRenderer<T>(def: {
  matches: (v: unknown) => v is T;
  render: (v: T) => ReactNode;
  toEditString?: (v: T) => string;
}): CellRenderer {
  return {
    matches: def.matches,
    render: def.render as (v: unknown) => ReactNode,
    toEditString: def.toEditString
      ? (def.toEditString as (v: unknown) => string)
      : (v) => String(v),
  };
}

export const undefinedRenderer = makeCellRenderer({
  matches: (v): v is undefined => v === undefined,
  render: () => '—',
  toEditString: () => '',
});

export const nullRenderer = makeCellRenderer({
  matches: (v): v is null => v === null,
  render: () => <span style={{ color: 'var(--fg-dim)' }}>null</span>,
  toEditString: () => 'null',
});

export const booleanRenderer = makeCellRenderer({
  matches: (v): v is boolean => typeof v === 'boolean',
  render: (v) => <span style={{ color: 'var(--fg-dim)' }}>{String(v)}</span>,
  toEditString: (v) => String(v),
});

export const arrayRenderer = makeCellRenderer({
  matches: (v): v is unknown[] => Array.isArray(v),
  render: (v) => `[ ${v.length} elements ]`,
  toEditString: (v) => JSON.stringify(v),
});

export const objectRenderer = makeCellRenderer({
  matches: (v): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v),
  render: (v) => `{ ${Object.keys(v).length} fields }`,
  toEditString: (v) => JSON.stringify(v),
});

/**
 * Default ordered registry. First match wins.
 * Extend by prepending or appending your own renderer:
 *   const myRenderers = [myRenderer, ...DEFAULT_CELL_RENDERERS];
 */
export const DEFAULT_CELL_RENDERERS: CellRenderer[] = [
  undefinedRenderer,
  nullRenderer,
  booleanRenderer,
  arrayRenderer,
  objectRenderer,
];

function findRenderer(value: unknown, registry: CellRenderer[]): CellRenderer | undefined {
  return registry.find((r) => r.matches(value));
}

export function renderCell(
  value: unknown,
  registry = DEFAULT_CELL_RENDERERS,
): ReactNode {
  const r = findRenderer(value, registry);
  return r ? r.render(value) : String(value as string | number);
}

export function cellEditString(
  value: unknown,
  registry = DEFAULT_CELL_RENDERERS,
): string {
  const r = findRenderer(value, registry);
  return r ? r.toEditString(value) : String(value as string | number);
}
