export type ItemType = 'login' | 'note';
export type AppPhase = 'loading' | 'setup' | 'locked' | 'unlocked';
export type Theme = 'light' | 'dark' | 'system';
// Settings is a flat page; only rare/dangerous actions live on a subpage.
export type SettingsSubpage = 'advanced';

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

export interface SyncState {
  configured: boolean;
  serverUrl: string | null;
  deviceId: string | null;
  pending: number;
  lastError: string | null;
  lastSyncAt: number | null;
  syncing: boolean;
}
