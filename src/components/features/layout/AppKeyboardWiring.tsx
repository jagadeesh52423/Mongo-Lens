import { useEffect } from 'react';
import { keyboardService } from '../../../services/KeyboardService';
import { DEFAULT_SHORTCUTS } from '../../../shortcuts/defaults';

// Define the global open-settings shortcut at module load. Defining the
// shortcut is idempotent — the KeyboardService maps it to an ID, and the
// `register` call below attaches the actual handler.
const openSettingsDef = DEFAULT_SHORTCUTS.find((d) => d.id === 'open-settings');
if (openSettingsDef) keyboardService.defineShortcut(openSettingsDef);

interface Props {
  onToggleSettings: () => void;
}

/**
 * Renderless component that owns the app's global keyboard wiring:
 *  - Suppresses Escape's WKWebView default so it doesn't exit fullscreen.
 *  - Pipes all keydowns through `KeyboardService.dispatch` on capture phase
 *    (so we see keys BEFORE Monaco's editor keymap consumes them).
 *  - Registers the handler for the `open-settings` shortcut.
 *
 * Extension point: to wire additional global shortcuts, call
 * `keyboardService.register(...)` in a new `useEffect` alongside the existing
 * registrations — no other files need to change.
 */
export function AppKeyboardWiring({ onToggleSettings }: Props) {
  useEffect(() => {
    // Prevent WKWebView from forwarding Escape to the native macOS responder
    // chain, which exits fullscreen. Capture phase fires before any element
    // handler (including Monaco), so this covers all focus positions.
    function suppressEscDefault(e: KeyboardEvent) {
      if (e.key === 'Escape') e.preventDefault();
    }
    window.addEventListener('keydown', suppressEscDefault, true);
    return () => window.removeEventListener('keydown', suppressEscDefault, true);
  }, []);

  useEffect(() => {
    // Capture phase: we need to see keys BEFORE Monaco's internal keymap
    // consumes them. Monaco binds F3 ("find next") and Cmd+F ("find") on its
    // own editor instance and stops propagation, so a bubble-phase listener
    // never receives those keys when Monaco has focus. With capture, we see
    // every key first; dispatch() only stopPropagation()s on an actual match,
    // so unmatched keys flow through to Monaco as normal. Scope is resolved
    // strictly from the focused element's ancestor chain — panel shortcuts
    // only fire when focus is actually inside the panel (ResultsPanel
    // auto-focuses itself after a run so F3/F4 work without an extra click).
    const handler = (e: KeyboardEvent) => keyboardService.dispatch(e);
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);

  useEffect(() => {
    return keyboardService.register('open-settings', onToggleSettings);
  }, [onToggleSettings]);

  return null;
}
