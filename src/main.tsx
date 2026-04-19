import './themes/definitions';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import { loadSettings, useSettingsStore } from './store/settings';
import { applyTheme, applyMonacoTheme } from './themes/applyTheme';
import { keyboardService } from './services/KeyboardService';

async function bootSettings(): Promise<void> {
  try {
    await loadSettings();
    const { themeId, shortcutOverrides } = useSettingsStore.getState();
    applyTheme(themeId);
    applyMonacoTheme(themeId);
    keyboardService.applyOverrides(shortcutOverrides);
  } catch (err) {
    console.warn('Settings boot failed; continuing with defaults', err);
  }
}

void bootSettings().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

  useSettingsStore.subscribe(
    (state) => state.shortcutOverrides,
    (overrides) => keyboardService.applyOverrides(overrides),
  );
});
