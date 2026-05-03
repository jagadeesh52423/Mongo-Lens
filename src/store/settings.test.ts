import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { hydrateOverrides, setVariable, getAllOverrides } from '../themes/overrides';

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

const DEFAULT_THEME_ID = 'mongodb-dark';

beforeEach(() => {
  vi.clearAllMocks();
  mockStoreGet.mockResolvedValue(null);
  mockStoreSet.mockResolvedValue(undefined);
  mockStoreSave.mockResolvedValue(undefined);

  // Reset overrides state between tests
  hydrateOverrides({});

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
