import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { Store } from '@tauri-apps/plugin-store';

const STORE_FILE = 'settings.json';
const SETTINGS_KEY = 'settings';
const DEFAULT_THEME_ID = 'mongodb-dark';
const DEFAULT_ACTIVE_SECTION = 'shortcuts';

export interface PersistedSettings {
  themeId: string;
  shortcutOverrides: Record<string, string>;
}

export interface SettingsState extends PersistedSettings {
  activeSection: string;
  setActiveSection: (id: string) => void;
  setTheme: (id: string) => void;
  setShortcutOverride: (shortcutId: string, combo: string) => void;
  resetShortcut: (shortcutId: string) => void;
}

let storePromise: Promise<Store> | null = null;

async function getStore(): Promise<Store> {
  if (!storePromise) {
    storePromise = Store.load(STORE_FILE);
  }
  return storePromise;
}

function toPersisted(state: SettingsState): PersistedSettings {
  return { themeId: state.themeId, shortcutOverrides: state.shortcutOverrides };
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
  })),
);

export async function loadSettings(): Promise<void> {
  try {
    const store = await getStore();
    const loaded = await store.get<PersistedSettings>(SETTINGS_KEY);
    if (loaded && typeof loaded === 'object') {
      useSettingsStore.setState({
        themeId: typeof loaded.themeId === 'string' ? loaded.themeId : DEFAULT_THEME_ID,
        shortcutOverrides:
          loaded.shortcutOverrides && typeof loaded.shortcutOverrides === 'object'
            ? loaded.shortcutOverrides
            : {},
      });
    }
  } catch (err) {
    console.warn('Failed to load settings; using defaults', err);
  }
}
