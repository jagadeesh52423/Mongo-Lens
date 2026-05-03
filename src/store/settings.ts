import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Store } from '@tauri-apps/plugin-store';
import {
  getAllOverrides,
  hydrateOverrides,
  subscribe as overridesSubscribe,
} from '../themes/overrides';

const STORE_FILE = 'settings.json';
const SETTINGS_KEY = 'settings';
const DEFAULT_THEME_ID = 'mongodb-dark';
const DEFAULT_ACTIVE_SECTION = 'shortcuts';

export interface AIConfig {
  baseUrl: string;
  /**
   * In-memory only. NEVER persisted to disk — the real token lives in the OS
   * keychain (see `ipc.ts` `getAiToken` / `setAiToken`). This field exists so
   * runtime callers (e.g. AIService) can populate it from the keychain at
   * startup and pass the full config around in one object.
   */
  apiToken: string;
  model: string;
  streaming: boolean;
}

/** The slice of `AIConfig` that is safe to write to `settings.json`. */
export type PersistedAIConfig = Omit<AIConfig, 'apiToken'>;

export const DEFAULT_AI_CONFIG: AIConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiToken: '',
  model: 'gpt-4o',
  streaming: true,
};

export interface PersistedSettings {
  themeId: string;
  shortcutOverrides: Record<string, string>;
  themeOverrides: Record<string, Record<string, string>>;
  aiConfig: PersistedAIConfig;
}

export interface SettingsState {
  themeId: string;
  shortcutOverrides: Record<string, string>;
  /** In-memory AI config; `apiToken` is never persisted. */
  aiConfig: AIConfig;
  activeSection: string;
  setActiveSection: (id: string) => void;
  setTheme: (id: string) => void;
  setShortcutOverride: (shortcutId: string, combo: string) => void;
  resetShortcut: (shortcutId: string) => void;
  resetAllShortcuts: () => void;
  setAIConfig: (patch: Partial<AIConfig>) => void;
}

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE);
  }
  return storePromise;
}

function toPersisted(state: SettingsState): PersistedSettings {
  // Strip `apiToken` — it must never reach disk. Token lives in the OS keychain.
  const { apiToken: _apiToken, ...persistedAi } = state.aiConfig;
  return {
    themeId: state.themeId,
    shortcutOverrides: state.shortcutOverrides,
    themeOverrides: getAllOverrides(),
    aiConfig: persistedAi,
  };
}

async function persist(settings: PersistedSettings): Promise<void> {
  try {
    const store = await getStore();
    await store.set(SETTINGS_KEY, settings);
    await store.save();
  } catch (err) {
    console.warn('Failed to persist settings', err);
  }
}

export const useSettingsStore = create<SettingsState>()(
  subscribeWithSelector((set, get) => ({
  themeId: DEFAULT_THEME_ID,
  shortcutOverrides: {},
  aiConfig: DEFAULT_AI_CONFIG,
  activeSection: DEFAULT_ACTIVE_SECTION,

  setActiveSection: (id) => set({ activeSection: id }),

  setTheme: (id) => {
    set({ themeId: id });
    void persist(toPersisted(get()));
  },

  setShortcutOverride: (shortcutId, combo) => {
    set((s) => ({ shortcutOverrides: { ...s.shortcutOverrides, [shortcutId]: combo } }));
    void persist(toPersisted(get()));
  },

  resetShortcut: (shortcutId) => {
    set((s) => {
      const { [shortcutId]: _removed, ...rest } = s.shortcutOverrides;
      return { shortcutOverrides: rest };
    });
    void persist(toPersisted(get()));
  },

  resetAllShortcuts: () => {
    set({ shortcutOverrides: {} });
    void persist(toPersisted(get()));
  },

  setAIConfig: (patch) => {
    set((s) => ({ aiConfig: { ...s.aiConfig, ...patch } }));
    void persist(toPersisted(get()));
  },
  })),
);

overridesSubscribe(() => {
  void persist(toPersisted(useSettingsStore.getState()));
});

export async function loadSettings(): Promise<void> {
  try {
    const store = await getStore();
    const loaded = await store.get<PersistedSettings>(SETTINGS_KEY);
    if (loaded && typeof loaded === 'object') {
      const loadedAi = (loaded as Partial<PersistedSettings>).aiConfig as
        | Partial<PersistedAIConfig>
        | undefined;
      // Merge persisted non-secret fields over defaults; apiToken is always
      // reset to '' here — runtime code must hydrate it from the keychain via
      // `getAiToken()` in `ipc.ts`.
      const aiConfig: AIConfig =
        loadedAi && typeof loadedAi === 'object'
          ? { ...DEFAULT_AI_CONFIG, ...loadedAi, apiToken: '' }
          : DEFAULT_AI_CONFIG;
      hydrateOverrides(
        loaded.themeOverrides && typeof loaded.themeOverrides === 'object'
          ? loaded.themeOverrides
          : {},
      );
      useSettingsStore.setState({
        themeId: typeof loaded.themeId === 'string' ? loaded.themeId : DEFAULT_THEME_ID,
        shortcutOverrides:
          loaded.shortcutOverrides && typeof loaded.shortcutOverrides === 'object'
            ? loaded.shortcutOverrides
            : {},
        aiConfig,
      });
    }
  } catch (err) {
    console.warn('Failed to load settings; using defaults', err);
  }
}
