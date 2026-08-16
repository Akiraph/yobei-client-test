export type ItemType = 'login' | 'note';

export interface VaultItem {
  id: string;
  type: ItemType;
  title: string;
  username?: string;
  url?: string;
  hasTotp: boolean;
  createdAt: number;
  updatedAt: number;
}

export type AppPhase = 'loading' | 'setup' | 'locked' | 'unlocked';

export type Theme = 'light' | 'dark' | 'system';

export interface ItemData {
  title: string;
  username?: string;
  password?: string;
  url?: string;
  totp?: string;
  recoveryCodes?: string;
  passkeys?: string[];
  notes?: string;
}

export type EditableVaultItem = VaultItem & ItemData;

export interface SyncState {
  configured: boolean;
  serverUrl: string | null;
  deviceId: string | null;
  pending: number;
  lastSynced: number;
  lastError: import('./errors').ClientErrorCode | null;
  lastSyncAt: number | null;
  syncing: boolean;
}
