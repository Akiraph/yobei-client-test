import type { Theme } from './types';

export interface AppSettings {
  theme: Theme;
  autoLockMin: number;
  clipboardSec: number;
  confirmDays: number;
  defaultLen: number;
  lastConfirmAt: number;
}

const KEY = 'yobei-settings';

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  autoLockMin: 5,
  clipboardSec: 20,
  confirmDays: 14,
  defaultLen: 20,
  lastConfirmAt: 0,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AppSettings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function persistSettings(s: AppSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
  }
}
