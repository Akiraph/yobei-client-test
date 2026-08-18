import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ErrorCode } from './errors';
import { appError, AppError } from './errors';
import type { ItemData, ItemType } from './types';

export interface ItemSummary {
  id: string;
  item_type: string;
  created_at: number;
  updated_at: number;
}

export interface SecuritySettings {
  auto_lock_min: number;
  confirm_days: number;
  clipboard_sec: number;
  last_password_confirm_at: number;
}

export interface AppPrefs {
  autostart: boolean;
  silentStart: boolean;
}

export interface BackendSyncStatus {
  configured: boolean;
  server_url: string | null;
  device_id: string | null;
  pending: number;
  last_error: string | null;
  last_sync_at: number | null;
}

export interface SyncSummary {
  pushed: number;
  pulled: number;
  current_version: number;
}

export interface DeviceTransfer {
  qr: string;
  expires_at: number;
  approved: boolean;
}

export interface AuthorizedDevice {
  id: string;
  name: string;
  created_at: number;
  last_seen_at: number | null;
}

export interface PairingStatus {
  code: string;
  paired: string[];
}

export interface BrowserInfo {
  name: string;
  browser_installed: boolean;
  extension_installed: boolean;
}

export interface CsvPreview {
  format: string;
  rows: number;
  sample: Array<{
    title: string;
    username: string;
    url: string;
    hasPassword: boolean;
    hasTotp: boolean;
    hasRecoveryCodes: boolean;
    hasPasskeys: boolean;
  }>;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: number;
}

export interface RestoreSummary {
  items: number;
}

export interface Backend {
  readonly kind: 'tauri' | 'memory';
  isInitialized(): Promise<boolean>;
  setupMasterPassword(password: string): Promise<void>;
  unlockVault(password: string): Promise<void>;
  lockVault(): Promise<void>;
  trySilentUnlock(): Promise<boolean>;
  unlockWithBiometric(message: string): Promise<void>;
  biometricAvailable(): Promise<boolean>;
  isBiometricEnabled(): Promise<boolean>;
  setupBiometric(password: string): Promise<void>;
  disableBiometric(): Promise<void>;
  listItems(): Promise<ItemSummary[]>;
  getItem(id: string): Promise<string>;
  createItem(type: ItemType, data: ItemData): Promise<string>;
  updateItem(id: string, data: ItemData): Promise<void>;
  deleteItem(id: string): Promise<void>;
  computeTotp(secret: string): Promise<{ code: string; period: number }>;
  getSecuritySettings(): Promise<SecuritySettings>;
  saveSecuritySettings(patch: Partial<SecuritySettings>): Promise<void>;
  getAppPrefs(): Promise<AppPrefs>;
  setAppPrefs(patch: Partial<AppPrefs>): Promise<AppPrefs>;
  syncStatus(): Promise<BackendSyncStatus>;
  syncNow(): Promise<SyncSummary>;
  pairDevice(serverUrl: string, setupCode: string, deviceName: string): Promise<void>;
  startDeviceTransfer(serverUrl: string, deviceName: string): Promise<DeviceTransfer>;
  pendingDeviceTransfer(): Promise<DeviceTransfer | null>;
  cancelDeviceTransfer(): Promise<void>;
  completeDeviceTransfer(password: string): Promise<void>;
  approveDeviceTransfer(qr: string): Promise<void>;
  listDevices(): Promise<AuthorizedDevice[]>;
  revokeDevice(deviceId: string): Promise<void>;
  extensionPairingStatus(): Promise<PairingStatus>;
  extensionRegenerateCode(): Promise<string>;
  extensionClearPaired(): Promise<void>;
  installExtension(browser: string): Promise<string>;
  checkBrowsers(): Promise<BrowserInfo[]>;
  version(): Promise<string>;
  openTextFile(): Promise<string | null>;
  saveTextFile(fileName: string, content: string): Promise<string | null>;
  exportVault(): Promise<string>;
  importVault(content: string, password: string): Promise<RestoreSummary>;
  exportCsv(): Promise<string>;
  previewCsv(content: string): Promise<CsvPreview>;
  importCsv(content: string): Promise<ImportSummary>;
  captureQrFromScreen(): Promise<string>;
  changeMasterPassword(oldPassword: string, newPassword: string): Promise<void>;
  markActivity(): Promise<void>;
  onVaultEvent(event: 'vault-locked' | 'vault-unlocked', handler: () => void): () => void;
}

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function createTauriBackend(): Backend {
  async function call<T>(
    command: string,
    args?: Record<string, unknown>,
    fallback: ErrorCode = 'operation_failed',
  ): Promise<T> {
    try {
      return await invoke<T>(command, args);
    } catch (error) {
      throw appError(error, fallback);
    }
  }

  const serialize = (data: ItemData) => JSON.stringify(data);

  return {
    kind: 'tauri',
    isInitialized: () => call('is_initialized', undefined, 'not_initialized'),
    setupMasterPassword: (password) => call('setup_master_password', { password }),
    unlockVault: (password) => call('unlock_vault', { password }, 'invalid_password'),
    lockVault: () => call('lock_vault'),
    trySilentUnlock: () => call('try_silent_unlock', undefined, 'biometric_unavailable'),
    unlockWithBiometric: (message) => call('unlock_with_biometric', { message }, 'invalid_password'),
    biometricAvailable: () => call('biometric_available'),
    isBiometricEnabled: () => call('is_biometric_enabled'),
    setupBiometric: (password) => call('setup_biometric', { password }, 'invalid_password'),
    disableBiometric: () => call('disable_biometric'),
    listItems: () => call<ItemSummary[]>('list_items'),
    getItem: (id) => call('get_item', { itemId: id }),
    createItem: (type, data) => call('create_item', { itemType: type, plaintextJson: serialize(data) }),
    updateItem: (id, data) => call('update_item', { itemId: id, plaintextJson: serialize(data) }),
    deleteItem: (id) => call('delete_item', { itemId: id }),
    computeTotp: (secret) => call('compute_totp', { secret }, 'invalid_totp'),
    getSecuritySettings: () => call('get_security_settings'),
    saveSecuritySettings: (patch) => call('save_security_settings', { patch }),
    getAppPrefs: () => call('get_app_prefs'),
    setAppPrefs: (patch) => call('set_app_prefs', { patch }),
    syncStatus: () => call('sync_status', undefined, 'sync_failed'),
    syncNow: () => call('sync_now', undefined, 'sync_failed'),
    pairDevice: (serverUrl, setupCode, deviceName) => call('pair_device', { serverUrl, setupCode, deviceName }, 'pair_rejected'),
    startDeviceTransfer: (serverUrl, deviceName) => call('start_device_transfer', { serverUrl, deviceName }, 'network_failed'),
    pendingDeviceTransfer: () => call('pending_device_transfer'),
    cancelDeviceTransfer: () => call('cancel_device_transfer'),
    completeDeviceTransfer: (password) => call('complete_device_transfer', { password }, 'transfer_pending'),
    approveDeviceTransfer: (qr) => call('approve_device_transfer', { qr }, 'pair_rejected'),
    listDevices: () => call('list_devices', undefined, 'sync_failed'),
    revokeDevice: (deviceId) => call('revoke_device', { deviceId }, 'sync_failed'),
    extensionPairingStatus: () => call('extension_pairing_status', undefined, 'bridge_unavailable'),
    extensionRegenerateCode: () => call('extension_regenerate_code', undefined, 'bridge_unavailable'),
    extensionClearPaired: () => call('extension_clear_paired', undefined, 'bridge_unavailable'),
    installExtension: (browser) => call('install_extension', { browser }, 'extension_unavailable'),
    checkBrowsers: () => call('check_browsers', undefined, 'bridge_unavailable'),
    version: async () => {
      try {
        const { getVersion } = await import('@tauri-apps/api/app');
        return await getVersion();
      } catch {
        return '0.1.0';
      }
    },
    openTextFile: () => call('open_text_file', undefined, 'file_failed'),
    saveTextFile: (fileName, content) => call('save_text_file', { fileName, content }, 'file_failed'),
    exportVault: () => call('export_vault', undefined, 'file_failed'),
    importVault: (content, password) => call('import_vault', { content, sourcePassword: password }, 'file_failed'),
    exportCsv: () => call('export_csv', undefined, 'file_failed'),
    previewCsv: (content) => call('preview_csv', { content }, 'file_failed'),
    importCsv: (content) => call('import_csv', { content }, 'file_failed'),
    captureQrFromScreen: () => call('capture_qr_from_screen', undefined, 'operation_failed'),
    changeMasterPassword: (oldPassword, newPassword) => call('change_master_password', { oldPassword, newPassword }, 'invalid_password'),
    markActivity: () => call('mark_activity'),
    onVaultEvent: (event, handler) => {
      let disposed = false;
      let remove: (() => void) | undefined;
      void listen(event, handler)
        .then((stop) => {
          if (disposed) stop();
          else remove = stop;
        })
        .catch(() => {});
      return () => {
        disposed = true;
        remove?.();
      };
    },
  };
}

function createMemoryBackend(): Backend {
  const items = new Map<string, { type: ItemType; data: ItemData; created: number; updated: number }>();
  let initialized = false;
  let unlocked = true;

  const summaries = () => [...items].map(([id, value]) => ({
    id,
    item_type: value.type,
    created_at: value.created,
    updated_at: value.updated,
  }));

  return {
    kind: 'memory',
    isInitialized: async () => initialized,
    setupMasterPassword: async () => { initialized = true; unlocked = true; },
    unlockVault: async () => { initialized = true; unlocked = true; },
    lockVault: async () => { unlocked = false; },
    trySilentUnlock: async () => false,
    unlockWithBiometric: async () => { initialized = true; unlocked = true; },
    biometricAvailable: async () => false,
    isBiometricEnabled: async () => false,
    setupBiometric: async () => {},
    disableBiometric: async () => {},
    listItems: async () => summaries(),
    getItem: async (id) => {
      const item = items.get(id);
      if (!item || !unlocked) throw new AppError('item_not_found');
      return JSON.stringify(item.data);
    },
    createItem: async (type, data) => {
      const id = crypto.randomUUID();
      const time = Date.now();
      items.set(id, { type, data, created: time, updated: time });
      return id;
    },
    updateItem: async (id, data) => {
      const item = items.get(id);
      if (!item) throw new AppError('item_not_found');
      item.data = data;
      item.updated = Date.now();
    },
    deleteItem: async (id) => { items.delete(id); },
    computeTotp: async () => { throw new AppError('unsupported_browser'); },
    getSecuritySettings: async () => ({ auto_lock_min: 5, confirm_days: 14, clipboard_sec: 20, last_password_confirm_at: 0 }),
    saveSecuritySettings: async () => {},
    getAppPrefs: async () => ({ autostart: false, silentStart: false }),
    setAppPrefs: async () => ({ autostart: false, silentStart: false }),
    syncStatus: async () => ({ configured: false, server_url: null, device_id: null, pending: 0, last_error: null, last_sync_at: null }),
    syncNow: async () => ({ pushed: 0, pulled: 0, current_version: 0 }),
    pairDevice: async () => { throw new AppError('desktop_only'); },
    startDeviceTransfer: async () => { throw new AppError('desktop_only'); },
    pendingDeviceTransfer: async () => null,
    cancelDeviceTransfer: async () => {},
    completeDeviceTransfer: async () => { throw new AppError('desktop_only'); },
    approveDeviceTransfer: async () => { throw new AppError('desktop_only'); },
    listDevices: async () => [],
    revokeDevice: async () => { throw new AppError('desktop_only'); },
    extensionPairingStatus: async () => { throw new AppError('desktop_only'); },
    extensionRegenerateCode: async () => { throw new AppError('desktop_only'); },
    extensionClearPaired: async () => { throw new AppError('desktop_only'); },
    installExtension: async () => { throw new AppError('desktop_only'); },
    checkBrowsers: async () => [],
    version: async () => '0.1.0',
    openTextFile: async () => null,
    saveTextFile: async () => null,
    exportVault: async () => '',
    importVault: async () => ({ items: 0 }),
    exportCsv: async () => '',
    previewCsv: async () => ({ format: 'csv', rows: 0, sample: [] }),
    importCsv: async () => ({ imported: 0, skipped: 0, errors: 0 }),
    captureQrFromScreen: async () => { throw new AppError('desktop_only'); },
    changeMasterPassword: async () => {},
    markActivity: async () => {},
    onVaultEvent: () => () => {},
  };
}

export const backend: Backend = inTauri ? createTauriBackend() : createMemoryBackend();
