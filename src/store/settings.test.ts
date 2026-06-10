import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { hydrateOverrides, setVariable, getAllOverrides } from '../themes/overrides';
import { migrateThemeId } from './settings';
import { useNotificationsStore } from './notifications';

// Mocked store instance returned by Store.load()
const mockStoreGet = vi.fn();
const mockStoreSet = vi.fn();
const mockStoreSave = vi.fn();
const mockStoreInstance = {
  get: mockStoreGet,
  set: mockStoreSet,
  save: mockStoreSave,
};

vi.mock('@tauri-apps/plugin-store', () => ({
  Store: {
    load: vi.fn(async () => mockStoreInstance),
  },
}));

// Import after mocks are wired so the module picks up the mock.
// settings.ts runs overridesSubscribe at module load — that is fine;
// the subscription is registered against the real overrides module.
const { loadSettings, useSettingsStore } = await import('./settings');

const DEFAULT_THEME_ID = 'precision-dark';

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreGet.mockResolvedValue(null);
  mockStoreSet.mockResolvedValue(undefined);
  mockStoreSave.mockResolvedValue(undefined);

  // Reset overrides state between tests
  hydrateOverrides({});
  useNotificationsStore.setState({ notifications: [] });

  // Reset store state to defaults
  useSettingsStore.setState({
    themeId: DEFAULT_THEME_ID,
    shortcutOverrides: {},
    aiConfig: {
      baseUrl: 'https://api.openai.com/v1',
      apiToken: '',
      model: 'gpt-4o',
      streaming: true,
    },
    activeSection: 'shortcuts',
  });
});

describe('loadSettings', () => {
  it('calls hydrateOverrides with persisted themeOverrides', async () => {
    const persisted = {
      themeId: 'mongodb-light',
      shortcutOverrides: {},
      themeOverrides: { dark: { '--bg': '#000' } },
      aiConfig: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', streaming: true },
    };
    mockStoreGet.mockResolvedValue(persisted);

    await loadSettings();

    expect(getAllOverrides()).toEqual({ dark: { '--bg': '#000' } });
  });

  it('defaults themeOverrides to {} when field is missing from persisted data', async () => {
    const persisted = {
      themeId: 'mongodb-light',
      shortcutOverrides: {},
      aiConfig: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', streaming: true },
    };
    mockStoreGet.mockResolvedValue(persisted);

    await loadSettings();

    expect(getAllOverrides()).toEqual({});
  });

  it('does not trigger a persist write during hydration (no store.set call)', async () => {
    const persisted = {
      themeId: 'mongodb-light',
      shortcutOverrides: {},
      themeOverrides: { dark: { '--bg': '#000' } },
      aiConfig: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', streaming: true },
    };
    mockStoreGet.mockResolvedValue(persisted);

    await loadSettings();

    // hydrateOverrides must NOT notify subscribers, so no persist write should occur
    expect(mockStoreSet).not.toHaveBeenCalled();
  });

  it('applies migrateThemeId to the persisted themeId (legacy id -> precision)', async () => {
    const persisted = {
      themeId: 'mongodb-dark',
      shortcutOverrides: {},
      themeOverrides: {},
      aiConfig: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', streaming: true },
    };
    mockStoreGet.mockResolvedValue(persisted);

    await loadSettings();

    expect(useSettingsStore.getState().themeId).toBe('precision-dark');
  });
});

describe('toPersisted includes themeOverrides', () => {
  it('persist payload includes themeOverrides from getAllOverrides after setTheme', async () => {
    setVariable('dark', '--accent', '#ff0000');

    // Trigger a settings mutation that calls persist
    useSettingsStore.getState().setTheme('mongodb-light');

    // Wait a microtask for the async persist call to reach store.set
    await new Promise((r) => setTimeout(r, 0));

    const [[_key, payload]] = (mockStoreSet as MockedFunction<typeof mockStoreSet>).mock.calls;
    expect(payload.themeOverrides).toEqual({ dark: { '--accent': '#ff0000' } });
  });
});

describe('overrides subscription → persist', () => {
  it('fires persist when setVariable mutates overrides', async () => {
    mockStoreSet.mockResolvedValue(undefined);

    setVariable('mongodb-dark', '--bg-primary', '#111');

    // Wait a microtask for the async persist call
    await new Promise((r) => setTimeout(r, 0));

    expect(mockStoreSet).toHaveBeenCalled();
    const [[_key, payload]] = (mockStoreSet as MockedFunction<typeof mockStoreSet>).mock.calls;
    expect(payload.themeOverrides).toEqual({ 'mongodb-dark': { '--bg-primary': '#111' } });
  });
});

describe('persist failure surfacing', () => {
  it('pushes an error notification when the store save rejects', async () => {
    mockStoreSave.mockRejectedValueOnce(new Error('disk full'));

    useSettingsStore.getState().setTheme('precision-light');

    // Wait for the async persist call to settle and hit the catch block.
    await new Promise((r) => setTimeout(r, 0));

    const notifications = useNotificationsStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].level).toBe('error');
    expect(notifications[0].detail).toContain('disk full');
  });

  it('does not notify when persistence succeeds', async () => {
    useSettingsStore.getState().setTheme('precision-light');
    await new Promise((r) => setTimeout(r, 0));
    expect(useNotificationsStore.getState().notifications).toHaveLength(0);
  });
});

describe('migrateThemeId', () => {
  it('maps legacy + retired ids to precision themes', () => {
    expect(migrateThemeId('mongodb-dark')).toBe('precision-dark');
    expect(migrateThemeId('light')).toBe('precision-light');
    expect(migrateThemeId('orangy')).toBe('precision-dark');
    expect(migrateThemeId('midnight')).toBe('precision-dark');
  });
  it('passes through current ids unchanged', () => {
    expect(migrateThemeId('precision-dark')).toBe('precision-dark');
    expect(migrateThemeId('precision-light')).toBe('precision-light');
  });
  it('passes unknown / installed-theme ids through unchanged', () => {
    expect(migrateThemeId('some-installed-theme')).toBe('some-installed-theme');
  });
});
