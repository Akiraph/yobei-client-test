import { createSignal } from 'solid-js';
import { locale as platformLocale } from '@tauri-apps/plugin-os';
import { inTauri, readExternalAsset } from './ipc';
import { isDesktop } from './window';
import bundledManifest from '../locales/index.json';
import bundledEnglish from '../locales/en-US.json';
import bundledChinese from '../locales/zh-CN.json';

export type Locale = string;

export interface LocaleOption {
  value: Locale;
  label: string;
}

interface LocaleResource {
  locale: Locale;
  displayName: string;
  messages: Record<string, string>;
}

const fallbackLocale = 'en-US';
const localeStorageKey = 'yobei-locale-v2';
const explicitLocaleStorageKey = 'yobei-locale-explicit-v2';
const resourceCache = new Map<Locale, Promise<LocaleResource>>();
const bundledResources: Record<Locale, LocaleResource> = {
  'en-US': bundledEnglish as LocaleResource,
  'zh-CN': bundledChinese as LocaleResource,
};
const [localeIds, setLocaleIds] = createSignal<Locale[]>(Object.keys(bundledResources));
const [resources, setResources] = createSignal<Record<Locale, LocaleResource>>(bundledResources);
const [currentLocale, setCurrentLocale] = createSignal<Locale>(fallbackLocale);
const localeListeners = new Set<() => void>();

async function readJson(path: string): Promise<unknown> {
  let externalError: unknown;
  if (inTauri && isDesktop()) {
    try {
      return JSON.parse(await readExternalAsset(path));
    } catch (error) {
      externalError = error;
      console.warn(`[yobei:i18n] external asset failed: ${path}`, error);
    }
  }
  try {
    const response = await fetch(`/${path}`);
    if (!response.ok) throw new Error(`${path} unavailable (${response.status})`);
    return response.json();
  } catch (error) {
    console.warn(`[yobei:i18n] web asset failed: ${path}`, { external: externalError, web: error });
    throw error;
  }
}

function loadResource(value: Locale): Promise<LocaleResource> {
  const cached = resourceCache.get(value);
  if (cached) return cached;
  const bundled = bundledResources[value];
  const request = (bundled ? Promise.resolve(bundled) : readJson(`locales/${value}.json`))
    .then((value) => value as LocaleResource)
    .then((resource) => {
      if (resource.locale !== value || typeof resource.displayName !== 'string' || !resource.messages) {
        throw new Error(`locale ${value} is invalid`);
      }
      setResources((current) => ({ ...current, [value]: resource }));
      return resource;
    })
    .catch((error) => {
      if (!bundled) throw error;
      console.warn(`[yobei:i18n] using bundled resource: ${value}`, error);
      setResources((current) => ({ ...current, [value]: bundled }));
      return bundled;
    });
  resourceCache.set(value, request);
  return request;
}

async function loadLocales(): Promise<void> {
  let manifest: { locales?: unknown };
  try {
    manifest = await readJson('locales/index.json') as { locales?: unknown };
  } catch (error) {
    console.warn('[yobei:i18n] using bundled locale manifest', error);
    manifest = bundledManifest;
  }
  const manifestLocales = Array.isArray(manifest.locales) ? manifest.locales : [];
  const bundledLocales = Array.isArray(bundledManifest.locales) ? bundledManifest.locales : [];
  const ids = [...manifestLocales, ...bundledLocales]
    .filter((value): value is string => typeof value === 'string' && /^[\w-]+$/.test(value));
  if (!ids.includes(fallbackLocale)) ids.unshift(fallbackLocale);
  const localeList = [...new Set(ids)];
  setLocaleIds(localeList);
  const next = await readLocale();
  await loadResource(fallbackLocale);
  if (next !== fallbackLocale) {
    try {
      await loadResource(next);
    } catch (error) {
      console.warn(`[yobei:i18n] locale resource unavailable: ${next}`, error);
      setCurrentLocale(fallbackLocale);
      if (typeof document !== 'undefined') document.documentElement.lang = fallbackLocale;
      return;
    }
  }
  setCurrentLocale(next);
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

const resourcesReady = loadLocales().catch(async () => {
  setLocaleIds([fallbackLocale]);
  await loadResource(fallbackLocale).catch(() => {});
});

async function systemLocale(): Promise<Locale> {
  const languages: string[] = [];
  if (inTauri && isDesktop()) {
    try {
      const value = await platformLocale();
      if (value) languages.push(value);
    } catch {}
  }
  if (typeof navigator !== 'undefined') {
    languages.push(...(navigator.languages ?? []), navigator.language);
  }
  const normalized = languages
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.toLowerCase());
  for (const language of normalized) {
    const exact = localeIds().find((value) => value.toLowerCase() === language);
    if (exact) return exact;
    const base = localeIds().find((value) => value.toLowerCase().split('-')[0] === language.split('-')[0]);
    if (base) return base;
  }
  return fallbackLocale;
}

async function readLocale(): Promise<Locale> {
  try {
    const value = localStorage.getItem(localeStorageKey);
    const explicit = localStorage.getItem(explicitLocaleStorageKey) === '1';
    return explicit && value && localeIds().includes(value) ? value : await systemLocale();
  } catch {
    return systemLocale();
  }
}

export function locales(): LocaleOption[] {
  return localeIds().map((value) => ({
    value,
    label: resources()[value]?.displayName ?? value,
  }));
}

export function locale(): Locale {
  return currentLocale();
}

export function onLocaleChange(listener: () => void): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

export function setLocale(value: Locale): void {
  const next = localeIds().includes(value) ? value : fallbackLocale;
  setCurrentLocale(next);
  void loadResource(next).catch(() => {});
  try {
    localStorage.setItem(localeStorageKey, next);
    localStorage.setItem(explicitLocaleStorageKey, '1');
  } catch {}
  if (typeof document !== 'undefined') document.documentElement.lang = next;
  for (const listener of localeListeners) listener();
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (placeholder, key: string) => {
    const value = vars[key];
    return value === undefined ? placeholder : String(value);
  });
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const value = resources()[currentLocale()]?.messages[key]
    ?? resources()[fallbackLocale]?.messages[key]
    ?? key;
  return interpolate(value, vars);
}

export { resourcesReady };
