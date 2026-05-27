/**
 * ViewModeRegistry — strategy/registry for result-pane render modes.
 *
 * To add a new result view (Tree, Chart, …):
 *   1. Implement `ResultViewMode` with a unique `id`, a `label` for the
 *      toolbar selector, and a `Component` that accepts `ViewRenderContext`.
 *   2. Self-register on module load in `viewModes/index.ts`. No edits to
 *      ResultsPanel or the registry itself are needed — the toolbar picks
 *      new variants up via `viewModeRegistry.list()`.
 *
 * Navigation contract (REQUIRED for views that reorder/filter docs):
 *   Every view MUST call `onRenderedDocsChange(docs, columns)` whenever the
 *   sequence of docs (and column key list) it actually draws on screen
 *   changes — initial render, sort change, filter change, etc. The host
 *   pipes these into `docsRef`/`columnsRef` so record-action keyboard
 *   navigation (F3/↑/↓) follows the user-visible display order rather than
 *   raw insertion order. Views that don't transform docs (e.g. JSON) still
 *   publish `group.docs` (and `[]` for columns) so docsRef stays consistent
 *   across view switches.
 */
import type { ReactNode } from 'react';
import type { ResultGroup } from '../../../../types';

export interface ViewRenderContext {
  /** The active result group being rendered. */
  group: ResultGroup;
  /**
   * Publish the docs (and column key list) the view actually draws, in
   * display order. The host wires this into the refs that drive record-
   * action keyboard navigation. See the navigation contract above.
   */
  onRenderedDocsChange?: (docs: unknown[], columns: string[]) => void;
}

export interface ResultViewMode {
  /** Stable id (persisted in UI state, e.g. 'table' | 'json' | …). */
  id: string;
  /** Human-readable label shown in the view selector. */
  label: string;
  /** Renders the view for the active group. */
  Component: (props: ViewRenderContext) => ReactNode;
}

class Registry {
  private readonly byId = new Map<string, ResultViewMode>();
  private readonly order: string[] = [];

  register(mode: ResultViewMode): void {
    if (!this.byId.has(mode.id)) this.order.push(mode.id);
    this.byId.set(mode.id, mode);
  }

  get(id: string): ResultViewMode | undefined {
    return this.byId.get(id);
  }

  list(): ResultViewMode[] {
    return this.order
      .map((id) => this.byId.get(id))
      .filter((mode): mode is ResultViewMode => mode !== undefined);
  }
}

export const viewModeRegistry = new Registry();
