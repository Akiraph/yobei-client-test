import { createSignal } from 'solid-js';
import { errorCode, type ExtensionErrorCode } from './errors';

export type Locale = string;
export type MessageKey = string;

interface LocaleResource {
  locale: Locale;
  displayName: string;
  messages: Record<string, string>;
}

const fallbackLocale = 'en';
const resourceCache = new Map<Locale, Promise<LocaleResource>>();
const resources: Record<Locale, LocaleResource> = {};
const [locale, setLocaleSignal] = createSignal<Locale>(fallbackLocale);
let localeIds: Locale[] = [fallbackLocale];
const LOCALE_KEY = 'yobei-locale';

function localeUrl(value: Locale): string {
  return chrome.runtime.getURL(`locales/${encodeURIComponent(value)}.json`);
}

function loadResource(value: Locale): Promise<LocaleResource> {
  const cached = resourceCache.get(value);
  if (cached) return cached;
  const request = fetch(localeUrl(value))
    .then((response) => {
      if (!response.ok) throw new Error(`locale ${value} unavailable`);
      return response.json() as Promise<LocaleResource>;
    })
    .then((resource) => {
      if (resource.locale !== value || typeof resource.displayName !== 'string' || !resource.messages) {
        throw new Error(`locale ${value} is invalid`);
      }
      resources[value] = resource;
      return resource;
    });
  resourceCache.set(value, request);
  return request;
}

async function loadLocales(): Promise<void> {
  const response = await fetch(chrome.runtime.getURL('locales/index.json'));
  if (!response.ok) throw new Error('locale manifest unavailable');
  const manifest = await response.json() as { locales?: unknown };
  const ids = Array.isArray(manifest.locales)
    ? manifest.locales.filter((value): value is string => typeof value === 'string' && /^[\w-]+$/.test(value))
    : [];
  if (!ids.includes(fallbackLocale)) ids.unshift(fallbackLocale);
  localeIds = [...new Set(ids)];
  await Promise.all(localeIds.map((value) => loadResource(value)));
}

const resourcesReady = loadLocales().catch(() => loadResource(fallbackLocale).catch(() => undefined));

function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return fallbackLocale;
  const language = navigator.language.toLowerCase();
  const exact = localeIds.find((value) => value.toLowerCase() === language);
  if (exact) return exact;
  const base = localeIds.find((value) => value.toLowerCase().split('-')[0] === language.split('-')[0]);
  return base ?? fallbackLocale;
}

export async function initializeLocale(): Promise<void> {
  await resourcesReady;
  try {
    const result = await chrome.storage.local.get(LOCALE_KEY);
    const stored = result[LOCALE_KEY];
    setLocaleSignal(typeof stored === 'string' && localeIds.includes(stored) ? stored : detectLocale());
  } catch {
    setLocaleSignal(detectLocale());
  }
}

export function setLocale(next: Locale): void {
  const value = localeIds.includes(next) ? next : fallbackLocale;
  setLocaleSignal(value);
  void loadResource(value).catch(() => {});
  void chrome.storage.local.set({ [LOCALE_KEY]: value });
}

export function toggleLocale(): void {
  const index = localeIds.indexOf(locale());
  setLocale(localeIds[(index + 1) % localeIds.length] ?? fallbackLocale);
}

export function nextLocaleDisplayName(): string {
  const index = localeIds.indexOf(locale());
  const next = localeIds[(index + 1) % localeIds.length] ?? fallbackLocale;
  return resources[next]?.displayName ?? next;
}

export function t(key: MessageKey): string {
  return resources[locale()]?.messages[key] ?? resources[fallbackLocale]?.messages[key] ?? key;
}

export function errorText(value: unknown): string {
  const keys: Record<ExtensionErrorCode, MessageKey> = {
    invalid_input: 'error.generic',
    invalid_password: 'error.generic',
    vault_locked: 'error.vaultLocked',
    item_not_found: 'error.generic',
    data_corrupt: 'error.snapshotInvalid',
    bridge_unavailable: 'error.bridgeUnavailable',
    bridge_disconnected: 'error.bridgeDisconnected',
    bridge_auth_timeout: 'error.bridgeAuthTimeout',
    pair_rejected: 'error.pairingRejected',
    extension_unavailable: 'error.noResponse',
    operation_failed: 'error.generic',
  };
  return t(keys[errorCode(value, 'operation_failed')]);
}

export { locale };
