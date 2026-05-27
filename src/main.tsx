import './themes/definitions';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
import './styles/globals.css';
import { loadSettings, useSettingsStore } from './store/settings';
import { applyTheme, applyMonacoTheme } from './themes/applyTheme';
import { keyboardService } from './services/KeyboardService';
import { createLogger, LoggerProvider, type Logger, type LogLevel } from './services/logger';

function pickEnv(): 'dev' | 'prod' | 'test' {
  if (import.meta.env.MODE === 'test') return 'test';
  return import.meta.env.DEV ? 'dev' : 'prod';
}

const logger: Logger = createLogger({
  env: pickEnv(),
  level:
    (import.meta.env.VITE_LOG_LEVEL as LogLevel | undefined) ??
    (import.meta.env.DEV ? 'debug' : 'info'),
  invoke: (cmd, payload) => invoke(cmd, payload as Record<string, unknown>),
});

keyboardService.setLogger(logger.child({ logger: 'services.keyboard' }));

async function bootSettings(): Promise<void> {
  try {
    await loadSettings();
    const { themeId, shortcutOverrides } = useSettingsStore.getState();
    applyTheme(themeId);
    applyMonacoTheme(themeId);
    keyboardService.applyOverrides(shortcutOverrides);
  } catch (err) {
    logger.warn('settings boot failed; continuing with defaults', { err: String(err) });
  }
}

// Wall-clock anchor for the splash's minimum visible duration. Set at module
// load (i.e. as soon as the JS bundle starts executing) so we measure from
// roughly when the user first sees the splash, not from when bootSettings
// finishes.
const BOOT_SPLASH_MIN_MS = 1700;
const bootSplashStart = performance.now();

function dismissBootSplash(): void {
  const el = document.getElementById('boot-splash');
  if (!el) return;
  const elapsed = performance.now() - bootSplashStart;
  const wait = Math.max(0, BOOT_SPLASH_MIN_MS - elapsed);
  setTimeout(() => {
    // Two RAFs ensures the first React paint has flushed before we start the
    // fade — otherwise a slow first render can briefly flash an unstyled app
    // behind the still-opaque splash.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.add('hide');
        const remove = () => el.remove();
        el.addEventListener('transitionend', remove, { once: true });
        // Safety net in case transitionend never fires (e.g. reduced motion).
        setTimeout(remove, 800);
      });
    });
  }, wait);
}

void bootSettings().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <LoggerProvider value={logger}>
        <App />
      </LoggerProvider>
    </React.StrictMode>,
  );

  useSettingsStore.subscribe(
    (state) => state.shortcutOverrides,
    (overrides) => keyboardService.applyOverrides(overrides),
  );

  dismissBootSplash();
});
