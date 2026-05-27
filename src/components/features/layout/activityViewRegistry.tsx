import { createElement, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BuiltInActivityRegistry } from '../../../layout/activityBar';
import { ConnectionPanel } from '../connections/ConnectionPanel';
import { SavedScriptsPanel } from '../saved-scripts/SavedScriptsPanel';

/**
 * Mount a React component into the SidePanel's container. For scrollable
 * views, the wrapper must NOT pin height to 100% — the host container handles
 * vertical scroll, and the wrapper needs to grow with natural content height
 * to expand scrollHeight beyond the viewport. Non-scrollable views fill the
 * container fully and own their internal layout.
 */
export function mountReactView(
  container: HTMLElement,
  component: () => ReactNode,
  scrollable: boolean,
): { dispose(): void } {
  // Each render gets an isolated wrapper so the old React root and the
  // incoming new root never share the same container node.
  const wrapper = document.createElement('div');
  wrapper.style.width = '100%';
  if (!scrollable) wrapper.style.height = '100%';
  container.appendChild(wrapper);
  const root = createRoot(wrapper);
  root.render(createElement(component));
  return {
    dispose() {
      // Remove wrapper from the live DOM synchronously so the next render
      // mounts into a clean container. Then unmount React deferred so we
      // don't call root.unmount() during a React commit phase.
      wrapper.remove();
      queueMicrotask(() => root.unmount());
    },
  };
}

/**
 * Built-in activity items (Connections / Saved Scripts). Plugins contribute
 * additional items via `PluginActivityRegistry` in `useActivitySystem`.
 *
 * To add a new built-in: append a `reg.add({...})` entry here — no other code
 * changes needed.
 */
export function makeBuiltInRegistry(): BuiltInActivityRegistry {
  const reg = new BuiltInActivityRegistry();
  reg.add({
    id: 'connections',
    title: 'Connections',
    icon: '⚡',
    scrollable: true,
    render: (container) => mountReactView(container, ConnectionPanel, true),
  });
  reg.add({
    id: 'saved',
    title: 'Saved Scripts',
    icon: '⭐',
    scrollable: true,
    render: (container) => mountReactView(container, SavedScriptsPanel, true),
  });
  return reg;
}
