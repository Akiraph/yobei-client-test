import { createStore } from 'solid-js/store';
import type { AppPhase, Theme, VaultItem, ItemData, ItemType, SyncState } from './types';
import { loadSettings, persistSettings } from './settings';
import type { AppSettings } from './settings';
import {
  listItems as ipcListItems,
  getItem as ipcGetItem,
  createItem as ipcCreateItem,
  updateItem as ipcUpdateItem,
  deleteItem as ipcDeleteItem,
  inTauri,
  syncStatus as ipcSyncStatus,
  pairDevice as ipcPairDevice,
  syncNow as ipcSyncNow,
  lockVault as ipcLockVault,
  getSecuritySettings as ipcGetSecuritySettings,
  saveSecuritySettings as ipcSaveSecuritySettings,
} from './ipc';
import type { SecuritySettingsPatch } from './ipc';
import { ClientError } from './errors';
import { listen } from '@tauri-apps/api/event';

interface AppState {
  phase: AppPhase;
  theme: Theme;
  settings: AppSettings;
  showSettings: boolean;
  condensing: boolean;
  items: VaultItem[];
  selectedItemId: string | null;
  itemContent: Record<string, ItemData>;
  search: string;
  activeNav: string;
  sync: SyncState;
}

const initialSettings = loadSettings();
const emptySyncState = (): SyncState => ({
  configured: false,
  serverUrl: null,
  deviceId: null,
  pending: 0,
  lastSynced: 0,
  lastError: null,
  lastSyncAt: null,
  syncing: false,
});

const [state, setState] = createStore<AppState>({
  phase: 'loading',
  theme: initialSettings.theme,
  settings: initialSettings,
  showSettings: false,
  condensing: false,
  items: [],
  selectedItemId: null,
  itemContent: {},
  search: '',
  activeNav: 'all',
  sync: emptySyncState(),
});

export { state };

export function setTheme(theme: Theme) {
  setState('theme', theme);
  setState('settings', 'theme', theme);
  persistSettings(state.settings);
  applyTheme(theme);
}

export function updateSettings(patch: Partial<AppSettings>) {
  setState('settings', patch);
  persistSettings(state.settings);
  if (patch.theme) applyTheme(patch.theme);
  if (inTauri) {
    const security: SecuritySettingsPatch = {};
    if (patch.autoLockMin !== undefined) security.auto_lock_min = patch.autoLockMin;
    if (patch.clipboardSec !== undefined) security.clipboard_sec = patch.clipboardSec;
    if (patch.confirmDays !== undefined) security.confirm_days = patch.confirmDays;
    if (Object.keys(security).length > 0) {
      ipcSaveSecuritySettings(security).catch(() => {});
    }
  }
}

export async function syncSecuritySettings(): Promise<void> {
  if (!inTauri) return;
  try {
    const s = await ipcGetSecuritySettings();
    setState('settings', {
      autoLockMin: s.auto_lock_min,
      clipboardSec: s.clipboard_sec,
      confirmDays: s.confirm_days,
      lastConfirmAt: s.last_password_confirm_at,
    });
    persistSettings(state.settings);
  } catch {
  }
}

export function toggleSettings(show?: boolean) {
  setState('showSettings', show ?? !state.showSettings);
}

export function recordPasswordEntry() {
  setState('settings', 'lastConfirmAt', Date.now());
  persistSettings(state.settings);
}

export function biometricConfirmBlocked(): boolean {
  const { confirmDays, lastConfirmAt } = state.settings;
  if (confirmDays <= 0) return false;
  if (lastConfirmAt <= 0) return true;
  return Date.now() - lastConfirmAt >= confirmDays * 86_400_000;
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

export function setSearch(q: string) {
  setState('search', q);
}

export function setActiveNav(nav: string) {
  setState('activeNav', nav);
}

export function selectItem(id: string | null) {
  if (state.selectedItemId === id) return;
  setState('selectedItemId', id);
  setState('itemContent', (current) => id && current[id] ? { [id]: current[id] } : {});
  if (id && inTauri && !state.itemContent[id]) void itemContentFor(id).catch(() => {});
}

export async function itemContentFor(id: string): Promise<ItemData> {
  let c = state.itemContent[id];
  if (!c && inTauri) {
    c = normalizeItemData(JSON.parse(await ipcGetItem(id)) as ItemData);
    if (state.selectedItemId === id) setState('itemContent', id, c);
  }
  return c ?? { title: '' };
}

export function normalizedAccountPart(value?: string): string {
  return (value ?? '').trim().toLocaleLowerCase();
}

export function normalizedService(value?: string): string {
  const raw = (value ?? '').trim().toLocaleLowerCase();
  if (!raw) return '';
  try {
    const url = new URL(raw.includes('://') ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./, '');
  } catch {
    return raw.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

export function accountMatches(item: VaultItem, data: ItemData, username?: string, service?: string, title?: string): boolean {
  if (item.type !== 'login') return false;
  const expectedUser = normalizedAccountPart(username);
  const actualUser = normalizedAccountPart(data.username ?? item.username);
  if (expectedUser && actualUser !== expectedUser) return false;

  const expectedService = normalizedService(service);
  const actualService = normalizedService(data.url ?? item.url);
  const expectedTitle = normalizedAccountPart(title);
  const actualTitle = normalizedAccountPart(data.title || item.title);
  if (expectedService && actualService) {
    return expectedService === actualService
      || actualService.startsWith(`${expectedService}.`)
      || expectedService.startsWith(`${actualService}.`)
      || actualTitle === expectedService;
  }
  return (!!expectedTitle && actualTitle === expectedTitle)
    || (!!expectedService && actualTitle === expectedService);
}

export async function saveAccountCredential(
  item: VaultItem,
  patch: Partial<Pick<ItemData, 'username' | 'url' | 'totp' | 'recoveryCodes' | 'passkeys'>>,
): Promise<string> {
  const current = await itemContentFor(item.id);
  return saveItem({
    id: item.id,
    type: 'login',
    data: { ...current, ...patch, title: current.title || item.title },
  });
}

interface SaveItemInput {
  id?: string;
  type: ItemType;
  data: ItemData;
}

function normalizeItemData(data: ItemData): ItemData {
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

export async function saveItem(input: SaveItemInput): Promise<string> {
  const data = normalizeItemData(input.data);
  const json = JSON.stringify(data);

  if (input.id) {
    if (inTauri) {
      await ipcUpdateItem(input.id, json);
    }
    const current = state.items.find((item) => item.id === input.id);
    if (current) {
      setState('items', (item) => item.id === input.id, summarizeItem({ ...current, updatedAt: Date.now() }, data));
    }
    if (state.selectedItemId === input.id) setState('itemContent', input.id, data);
    syncAfterChange();
    return input.id;
  }

  const id = inTauri ? await ipcCreateItem(input.type, json) : crypto.randomUUID();
  const now = Date.now();
  const item = summarizeItem({ id, type: input.type, createdAt: now, updatedAt: now }, data);
  setState('items', (list) => [item, ...list]);
  setState('itemContent', { [id]: data });
  setState('selectedItemId', id);
  syncAfterChange();
  return id;
}

export async function deleteItem(id: string): Promise<void> {
  if (inTauri) {
    await ipcDeleteItem(id);
  }
  setState('items', (list) => list.filter((i) => i.id !== id));
  setState('itemContent', (content) => {
    const { [id]: _removed, ...rest } = content;
    return rest;
  });
  if (state.selectedItemId === id) {
    setState('selectedItemId', null);
  }
  syncAfterChange();
}


function animateLock() {
  if (state.condensing || state.phase !== 'unlocked') return;
  setState('condensing', true);
  window.setTimeout(() => {
    setState('condensing', false);
    setState('phase', 'locked');
    setState('items', []);
    setState('itemContent', {});
    setState('selectedItemId', null);
    setState('showSettings', false);
  }, 800);
}

export function lock() {
  if (state.condensing || state.phase !== 'unlocked') return;
  if (inTauri) ipcLockVault().catch(() => {});
  animateLock();
}

export function initVaultLockListener(): () => void {
  if (!inTauri) return () => {};
  let disposed = false;
  let unlisten: (() => void) | undefined;
  listen('vault-locked', animateLock)
    .then((remove) => {
      if (disposed) remove();
      else unlisten = remove;
    })
    .catch(() => {});
  return () => {
    disposed = true;
    unlisten?.();
  };
}

// The Rust side can unlock the vault by itself (silent Windows Hello unlock on
// boot/wake); mirror that into the UI so the lock screen swaps to the vault.
export function initVaultUnlockListener(): () => void {
  if (!inTauri) return () => {};
  let disposed = false;
  let unlisten: (() => void) | undefined;
  listen('vault-unlocked', () => {
    if (state.phase === 'locked') void unlock();
  })
    .then((remove) => {
      if (disposed) remove();
      else unlisten = remove;
    })
    .catch(() => {});
  return () => {
    disposed = true;
    unlisten?.();
  };
}

async function finishUnlock() {
  setState('phase', 'unlocked');
  if (inTauri) {
    await loadItemsFromBackend();
    await afterUnlock();
    await syncSecuritySettings();
  }
}

export async function completeSetup() {
  recordPasswordEntry();
  await finishUnlock();
}

export async function unlock() {
  await finishUnlock();
}

export function setPhase(phase: AppPhase) {
  setState('phase', phase);
}

async function loadItemsFromBackend() {
  try {
    const summaries = await ipcListItems();
    const items: VaultItem[] = summaries.map((s) => ({
      id: s.id,
      type: s.item_type as VaultItem['type'],
      title: '',
      hasTotp: false,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));
    const firstItemId = items[0]?.id;
    let firstItemContent: ItemData | undefined;
    const CHUNK = 12;
    for (let i = 0; i < items.length; i += CHUNK) {
      const batch = items.slice(i, i + CHUNK).map((item, offset) => ({ item, index: i + offset }));
      await Promise.all(batch.map(async ({ item, index }) => {
        try {
          const json = await ipcGetItem(item.id);
          const data = normalizeItemData(JSON.parse(json) as ItemData);
          items[index] = summarizeItem(item, data);
          if (item.id === firstItemId) firstItemContent = data;
        } catch {
        }
      }));
    }
    setState('items', items);
    const selectedId = items[0]?.id ?? null;
    setState('itemContent', firstItemContent && selectedId ? { [selectedId]: firstItemContent } : {});
    setState('selectedItemId', selectedId);
    if (selectedId && !firstItemContent) void itemContentFor(selectedId).catch(() => {});
  } catch {
  }
}

function summarizeItem(
  item: Pick<VaultItem, 'id' | 'type' | 'createdAt' | 'updatedAt'>,
  data: ItemData,
): VaultItem {
  return {
    ...item,
    title: data.title,
    username: data.username,
    url: data.url,
    hasTotp: Boolean(data.totp),
  };
}

export function visibleItems(): VaultItem[] {
  const q = state.search.trim().toLowerCase();
  let list = state.items;

  const nav = state.activeNav;
  if (nav === 'notes') list = list.filter((i) => i.type === 'note');

  if (q) {
    list = list.filter((i) =>
      i.title.toLowerCase().includes(q) ||
      i.username?.toLowerCase().includes(q) ||
      i.url?.toLowerCase().includes(q)
    );
  }

  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function selectedItem(): VaultItem | undefined {
  return state.items.find((i) => i.id === state.selectedItemId);
}

export function selectedItemContent(): ItemData | undefined {
  const id = state.selectedItemId;
  return id ? state.itemContent[id] : undefined;
}


async function afterUnlock(): Promise<void> {
  await refreshSyncStatus();
  syncAfterChange();
}

export async function refreshSyncStatus(): Promise<void> {
  if (!inTauri) {
    setState('sync', emptySyncState());
    return;
  }
  try {
    const s = await ipcSyncStatus();
    setState('sync', {
      configured: s.configured,
      serverUrl: s.server_url,
      deviceId: s.device_id,
      pending: s.pending,
      lastSynced: s.last_synced,
      lastError: s.last_error,
      lastSyncAt: s.last_sync_at,
    });
  } catch {
  }
}

export async function runSync(): Promise<boolean> {
  if (!inTauri || !state.sync.configured || state.sync.syncing) return false;
  setState('sync', 'syncing', true);
  let ok = false;
  try {
    const summary = await ipcSyncNow();
    if (summary.pulled > 0) await loadItemsFromBackend();
    setState('sync', { lastError: null, lastSyncAt: Date.now() });
    ok = true;
  } catch {
    setState('sync', 'lastError', 'sync_failed');
  } finally {
    setState('sync', 'syncing', false);
    void refreshSyncStatus();
  }
  return ok;
}

export async function pairServer(serverUrl: string, setupCode: string, deviceName: string): Promise<void> {
  if (!inTauri) throw new ClientError('desktop_only');
  await ipcPairDevice(serverUrl, setupCode, deviceName);
  await refreshSyncStatus();
  void runSync();
}

function syncAfterChange(): void {
  if (state.phase === 'unlocked' && state.sync.configured) {
    void runSync();
  }
}

let syncTimer: number | undefined;

export function startSyncPolling(): () => void {
  if (!inTauri || syncTimer !== undefined) return () => {};
  syncTimer = window.setInterval(syncAfterChange, 30_000);
  return () => {
    if (syncTimer === undefined) return;
    window.clearInterval(syncTimer);
    syncTimer = undefined;
  };
}
