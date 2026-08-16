import { invoke } from '@tauri-apps/api/core';
import { ClientError, clientError, type ClientErrorCode } from './errors';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function call<T>(command: string, args?: Record<string, unknown>, fallback: ClientErrorCode = 'operation_failed'): Promise<T> {
  if (!inTauri) throw new ClientError('desktop_only');
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw clientError(error, fallback);
  }
}

export interface ItemSummary {
  id: string;
  item_type: string;
  version: number;
  created_at: number;
  updated_at: number;
}

export interface TotpCode {
  code: string;
  period: number;
  digits: number;
}

export interface CsvPreviewRow {
  title: string;
  username: string;
  url: string;
  hasPassword: boolean;
  hasTotp: boolean;
  hasRecoveryCodes: boolean;
  hasPasskeys: boolean;
}

export interface CsvPreview {
  format: string;
  rows: number;
  sample: CsvPreviewRow[];
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  errors: number;
}

export interface RestoreSummary {
  items: number;
}

export interface SyncStatus {
  configured: boolean;
  server_url: string | null;
  device_id: string | null;
  pending: number;
  last_synced: number;
  last_error: ClientErrorCode | null;
  last_sync_at: number | null;
}

export interface SyncSummary {
  pushed: number;
  pulled: number;
  current_version: number;
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

export interface StartedDeviceTransfer {
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

export type SecuritySettingsPatch = Partial<Pick<SecuritySettings, 'auto_lock_min' | 'confirm_days' | 'clipboard_sec'>>;

export const isInitialized = () => call<boolean>('is_initialized', undefined, 'not_initialized');
export const setupMasterPassword = (password: string) => call<void>('setup_master_password', { password });
export const startDeviceTransfer = (serverUrl: string, deviceName: string) =>
  call<StartedDeviceTransfer>('start_device_transfer', { serverUrl, deviceName }, 'network_failed');
export const pendingDeviceTransfer = () =>
  call<StartedDeviceTransfer | null>('pending_device_transfer', undefined, 'operation_failed');
export const cancelDeviceTransfer = () => call<void>('cancel_device_transfer');
export const approveDeviceTransfer = (qr: string) =>
  call<void>('approve_device_transfer', { qr }, 'pair_rejected');
export const completeDeviceTransfer = (password: string) =>
  call<void>('complete_device_transfer', { password }, 'transfer_pending');
export const listDevices = () => call<AuthorizedDevice[]>('list_devices', undefined, 'sync_failed');
export const revokeDevice = (deviceId: string) => call<void>('revoke_device', { deviceId }, 'sync_failed');
export const unlockVault = (password: string) => call<void>('unlock_vault', { password }, 'invalid_password');
export const lockVault = () => call<void>('lock_vault');
export const createItem = (itemType: string, plaintextJson: string) =>
  call<string>('create_item', { itemType, plaintextJson });
export const getItem = (itemId: string) => call<string>('get_item', { itemId });
export const listItems = () => call<ItemSummary[]>('list_items');
export const updateItem = (itemId: string, plaintextJson: string) =>
  call<void>('update_item', { itemId, plaintextJson });
export const deleteItem = (itemId: string) => call<void>('delete_item', { itemId });
export const computeTotp = (secret: string) => call<TotpCode>('compute_totp', { secret }, 'invalid_totp');
export const readExternalAsset = (path: string) => call<string>('read_external_asset', { path }, 'file_failed');
export const previewCsv = (content: string) => call<CsvPreview>('preview_csv', { content }, 'file_failed');
export const importCsv = (content: string) => call<ImportSummary>('import_csv', { content }, 'file_failed');
export const exportVault = () => call<string>('export_vault', undefined, 'file_failed');
export const importVault = (content: string, sourcePassword: string) =>
  call<RestoreSummary>('import_vault', { content, sourcePassword }, 'file_failed');
export const exportCsv = () => call<string>('export_csv', undefined, 'file_failed');
export const changeMasterPassword = (oldPassword: string, newPassword: string) =>
  call<void>('change_master_password', { oldPassword, newPassword }, 'invalid_password');
export const openTextFile = () => call<string | null>('open_text_file', undefined, 'file_failed');
export const saveTextFile = (fileName: string, content: string) =>
  call<string | null>('save_text_file', { fileName, content }, 'file_failed');
export const biometricAvailable = () => call<boolean>('biometric_available');
export const isBiometricEnabled = () => call<boolean>('is_biometric_enabled');
export const setupBiometric = (password: string) => call<void>('setup_biometric', { password }, 'invalid_password');
export const disableBiometric = () => call<void>('disable_biometric');
export const unlockWithBiometric = (message: string) => call<void>('unlock_with_biometric', { message }, 'invalid_password');
export const trySilentUnlock = () => call<boolean>('try_silent_unlock', undefined, 'biometric_unavailable');
export const getAppPrefs = () => call<AppPrefs>('get_app_prefs');
export const setAppPrefs = (patch: Partial<AppPrefs>) => call<AppPrefs>('set_app_prefs', { patch });
export const syncStatus = () => call<SyncStatus>('sync_status', undefined, 'sync_failed');
export const pairDevice = (serverUrl: string, setupCode: string, deviceName: string) =>
  call<string>('pair_device', { serverUrl, setupCode, deviceName }, 'pair_rejected');
export const syncNow = () => call<SyncSummary>('sync_now', undefined, 'sync_failed');
export const extensionPairingStatus = () => call<PairingStatus>('extension_pairing_status', undefined, 'bridge_unavailable');
export const extensionRegenerateCode = () => call<string>('extension_regenerate_code', undefined, 'bridge_unavailable');
export const extensionClearPaired = () => call<void>('extension_clear_paired', undefined, 'bridge_unavailable');
export const installExtension = (browser: string) => call<string>('install_extension', { browser }, 'extension_unavailable');
export const checkBrowsers = () => call<BrowserInfo[]>('check_browsers', undefined, 'bridge_unavailable');
export const markActivity = () => call<void>('mark_activity');
export const getSecuritySettings = () => call<SecuritySettings>('get_security_settings');
export const saveSecuritySettings = (patch: SecuritySettingsPatch) => call<void>('save_security_settings', { patch });
export const copyToClipboard = (text: string) => call<void>('copy_to_clipboard', { text });
export const captureQrFromScreen = () => call<string>('capture_qr_from_screen', undefined, 'operation_failed');

export async function openUrl(url: string): Promise<void> {
  if (!inTauri) throw new ClientError('desktop_only');
  const { openUrl: openExternalUrl } = await import('@tauri-apps/plugin-opener');
  try {
    await openExternalUrl(url);
  } catch (error) {
    throw clientError(error, 'operation_failed');
  }
}
