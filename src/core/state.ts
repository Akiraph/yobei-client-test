import { createStore } from 'solid-js/store';
import { backend } from './backend';
import { errorCode } from './errors';
import { readSettings, writeSettings, type AppSettings } from './settings';
import type { AppPhase, ItemData, ItemType, SettingsSection, SyncState, Theme, VaultItem } from './types';

interface AppState {
  phase: AppPhase;
  theme: Theme;
  settings: AppSettings;
  settingsOpen: boolean;
  // Mobile settings are hierarchical: null means the root list, a value means a subpage.
  settingsSection: SettingsSection | null;
  condensing: boolean;
  items: VaultItem[];
  contents: Record<string, ItemData>;
  selectedId: string | null;
  search: string;
  nav: 'all' | 'notes';
  sync: SyncState;
}

function emptySync(): SyncState {
  return {
    configured: false,
    serverUrl: null,
    deviceId: null,
    pending: 0,
    lastError: null,
    lastSyncAt: null,
    syncing: false,
  };
}

const initialSettings = readSettings();

export const [state, setState] = createStore<AppState>({
  phase: 'loading',
  theme: initialSettings.theme,
  settings: initialSettings,
  settingsOpen: false,
  settingsSection: null,
  condensing: false,
  items: [],
  contents: {},
  selectedId: null,
  search: '',
  nav: 'all',
  sync: emptySync(),
});

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function normalize(data: ItemData): ItemData {
  return {
    title: data.title ?? '',
    username: data.username,
    password: data.password,
    url: data.url,
    totp: data.totp,
    recoveryCodes: data.recoveryCodes,
    passkeys: data.passkeys,
    notes: data.notes,
  };
}

function summarize(item: VaultItem, data: ItemData): VaultItem {
  return {
    ...item,
    title: data.title,
    username: data.username,
    url: data.url,
    hasTotp: Boolean(data.totp),
  };
}

async function loadItems(): Promise<void> {
  const summaries = await backend.listItems().catch(() => []);
  const items = await Promise.all(summaries.map(async (summary) => {
    const item: VaultItem = {
      id: summary.id,
      type: summary.item_type as ItemType,
      title: '',
      hasTotp: false,
      createdAt: summary.created_at,
      updatedAt: summary.updated_at,
    };

    try {
      return summarize(item, JSON.parse(await backend.getItem(item.id)) as ItemData);
    } catch {
      return item;
    }
  }));

  const contents: Record<string, ItemData> = {};
  await Promise.all(items.map(async (item) => {
    try {
      contents[item.id] = normalize(JSON.parse(await backend.getItem(item.id)) as ItemData);
    } catch {
      // A corrupt item should not prevent the rest of the vault from opening.
    }
  }));

  const selectedId = state.selectedId && items.some((item) => item.id === state.selectedId)
    ? state.selectedId
    : items[0]?.id ?? null;
  setState({ items, contents, selectedId });
}

export const actions = {
  setTheme(theme: Theme): void {
    setState({ theme, settings: { ...state.settings, theme } });
    writeSettings(state.settings);
    applyTheme(theme);
  },

  updateSettings(patch: Partial<AppSettings>): void {
    setState('settings', patch);
    if (patch.theme) {
      setState('theme', patch.theme);
      applyTheme(patch.theme);
    }
    writeSettings(state.settings);
  },

  async saveSecurity(patch: Partial<AppSettings>): Promise<void> {
    actions.updateSettings(patch);
    if (backend.kind !== 'tauri') return;
    await backend.saveSecuritySettings({
      ...(patch.autoLockMin === undefined ? {} : { auto_lock_min: patch.autoLockMin }),
      ...(patch.confirmDays === undefined ? {} : { confirm_days: patch.confirmDays }),
      ...(patch.clipboardSec === undefined ? {} : { clipboard_sec: patch.clipboardSec }),
    });
  },

  setSearch(search: string): void {
    setState('search', search);
  },

  setNav(nav: 'all' | 'notes'): void {
    setState('nav', nav);
  },

  toggleSettings(open?: boolean): void {
    setState({ settingsOpen: open ?? !state.settingsOpen, settingsSection: null });
  },

  openSettingsSection(section: SettingsSection | null): void {
    setState('settingsSection', section);
  },

  select(id: string | null): void {
    setState('selectedId', id);
  },

  selected(): VaultItem | undefined {
    return state.items.find((item) => item.id === state.selectedId);
  },

  content(id: string | null = state.selectedId): ItemData | undefined {
    return id ? state.contents[id] : undefined;
  },

  visibleItems(): VaultItem[] {
    const query = state.search.trim().toLowerCase();
    return state.items
      .filter((item) => state.nav === 'all' || item.type === 'note')
      .filter((item) => !query || [item.title, item.username, item.url].some((value) => value?.toLowerCase().includes(query)))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  },

  async initialize(): Promise<void> {
    applyTheme(state.theme);
    if (backend.kind === 'memory') {
      setState('phase', 'unlocked');
      return;
    }

    if (!(await backend.isInitialized())) {
      setState('phase', 'setup');
      return;
    }

    if (await backend.trySilentUnlock().catch(() => false)) {
      await actions.unlockReady();
      return;
    }

    setState('phase', 'locked');
  },

  async setup(password: string): Promise<void> {
    await backend.setupMasterPassword(password);
    await actions.unlockReady();
  },

  async unlock(password: string): Promise<void> {
    await backend.unlockVault(password);
    setState('settings', 'lastConfirmAt', Date.now());
    writeSettings(state.settings);
    await actions.unlockReady();
  },

  async unlockBiometric(message: string): Promise<void> {
    await backend.unlockWithBiometric(message);
    await actions.unlockReady();
  },

  async unlockReady(): Promise<void> {
    setState({ phase: 'unlocked', settingsOpen: false });
    await Promise.all([loadItems(), actions.refreshSecurity(), actions.refreshSync()]);
  },

  async reloadItems(): Promise<void> {
    await loadItems();
  },

  async lock(): Promise<void> {
    if (state.phase !== 'unlocked' || state.condensing) return;
    await backend.lockVault().catch(() => {});
    setState('condensing', true);
    window.setTimeout(() => {
      setState({
        phase: 'locked',
        condensing: false,
        items: [],
        contents: {},
        selectedId: null,
        settingsOpen: false,
      });
    }, 520);
  },

  async contentFor(id: string): Promise<ItemData> {
    const cached = state.contents[id];
    if (cached) return cached;
    const data = normalize(JSON.parse(await backend.getItem(id)) as ItemData);
    setState('contents', id, data);
    return data;
  },

  async save(input: { id?: string; type: ItemType; data: ItemData }): Promise<string> {
    const data = normalize(input.data);
    const id = input.id ?? await backend.createItem(input.type, data);
    if (input.id) await backend.updateItem(id, data);

    const previous = state.items.find((item) => item.id === id);
    const now = Date.now();
    const next = summarize(previous ?? {
      id,
      type: input.type,
      title: '',
      hasTotp: false,
      createdAt: now,
      updatedAt: now,
    }, data);

    setState('items', (items) => previous
      ? items.map((item) => item.id === id ? { ...item, ...next, updatedAt: now } : item)
      : [next, ...items]);
    setState('contents', id, data);
    setState('selectedId', id);
    return id;
  },

  async remove(id: string): Promise<void> {
    await backend.deleteItem(id);
    setState('items', (items) => items.filter((item) => item.id !== id));
    setState('contents', (contents) => {
      const next = { ...contents };
      delete next[id];
      return next;
    });
    if (state.selectedId === id) setState('selectedId', null);
  },

  async refreshSecurity(): Promise<void> {
    if (backend.kind !== 'tauri') return;
    const value = await backend.getSecuritySettings().catch(() => null);
    if (!value) return;
    setState('settings', {
      autoLockMin: value.auto_lock_min,
      confirmDays: value.confirm_days,
      clipboardSec: value.clipboard_sec,
      lastConfirmAt: value.last_password_confirm_at,
    });
    writeSettings(state.settings);
  },

  async refreshSync(): Promise<void> {
    const value = await backend.syncStatus().catch(() => null);
    if (!value) return;
    setState('sync', {
      configured: value.configured,
      serverUrl: value.server_url,
      deviceId: value.device_id,
      pending: value.pending,
      lastError: value.last_error,
      lastSyncAt: value.last_sync_at,
    });
  },

  async sync(): Promise<boolean> {
    if (!state.sync.configured || state.sync.syncing) return false;
    setState('sync', 'syncing', true);
    try {
      const result = await backend.syncNow();
      if (result.pulled > 0) await loadItems();
      await actions.refreshSync();
      return true;
    } catch (error) {
      setState('sync', 'lastError', errorCode(error, 'sync_failed'));
      return false;
    } finally {
      setState('sync', 'syncing', false);
    }
  },
};

export function applyInitialTheme(): void {
  applyTheme(state.theme);
}
