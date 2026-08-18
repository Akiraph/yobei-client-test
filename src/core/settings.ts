import type { Theme } from './types';

export interface AppSettings {
  theme: Theme;
  autoLockMin: number;
  clipboardSec: number;
  confirmDays: number;
  lastConfirmAt: number;
}

export const defaultSettings: AppSettings = {
  theme: 'system',
  autoLockMin: 5,
  clipboardSec: 20,
  confirmDays: 14,
  lastConfirmAt: 0,
};

const storageKey = 'yobei-settings';

export function readSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { ...defaultSettings };
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return { ...defaultSettings };
  }
}

export function writeSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(settings));
  } catch {
    // Browser storage is optional in private or restricted contexts.
  }
}
