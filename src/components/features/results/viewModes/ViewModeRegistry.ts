/**
 * ViewModeRegistry — strategy/registry for result-pane render modes.
 *
 * To add a new result view (Tree, Chart, …): implement `ResultViewMode`,
 * register on module load in `viewModes/index.ts`. No edits to ResultsPanel
 * or the registry itself are needed — new variants self-register and the
 * toolbar picks them up via `viewModeRegistry.list()`.
 */
import type { ReactNode } from 'react';
import type { ResultGroup } from '../../../../types';

export interface ResultViewMode {
  /** Stable id (used in stored UI state, e.g. 'table' | 'json' | …). */
  id: string;
  /** Human-readable label shown in the view selector. */
  label: string;
  /** Renders the view for the active group. */
  Component: (props: { group: ResultGroup }) => ReactNode;
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
