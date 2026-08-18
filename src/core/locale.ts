import { createSignal } from 'solid-js';
import manifest from '../locales/index.json';
import english from '../locales/en-US.json';
import { inTauri } from './backend';

export type Locale = string;

interface Resource {
  locale: Locale;
  displayName: string;
  messages: Record<string, string>;
}

const fallbackLocale = 'en-US';
const localeStorageKey = 'yobei-locale-v2';
const explicitLocaleStorageKey = 'yobei-locale-explicit-v2';
const resourceCache = new Map<Locale, Promise<Resource>>();
const bundledResources: Record<Locale, Resource> = {
  [fallbackLocale]: english as Resource,
};

const [localeIds, setLocaleIds] = createSignal<Locale[]>([fallbackLocale]);
const [resources, setResources] = createSignal<Record<Locale, Resource>>(bundledResources);
const [currentLocale, setCurrentLocale] = createSignal<Locale>(fallbackLocale);

async function readJson(path: string): Promise<unknown> {
  if (inTauri) {
    try {
      const { readExternalAsset } = await import('./backend-assets');
      return JSON.parse(await readExternalAsset(path));
    } catch {
      // Web fallback below also works in a Tauri development server.
    }
  }
  const response = await fetch(`/${path}`);
  if (!response.ok) throw new Error(`${path} unavailable`);
  return response.json();
}

function loadResource(locale: Locale): Promise<Resource> {
  const cached = resourceCache.get(locale);
  if (cached) return cached;

  const request = (bundledResources[locale]
    ? Promise.resolve(bundledResources[locale])
    : readJson(`locales/${locale}.json`)
  )
    .then((value) => value as Resource)
    .then((resource) => {
      setResources((current) => ({ ...current, [locale]: resource }));
      return resource;
    });

  resourceCache.set(locale, request);
  return request;
}

async function detectLocale(): Promise<Locale> {
  try {
    const saved = localStorage.getItem(localeStorageKey);
    const explicit = localStorage.getItem(explicitLocaleStorageKey) === '1';
    if (explicit && saved && localeIds().includes(saved)) return saved;
  } catch {
    // Browser storage is optional.
  }

  const languages = typeof navigator === 'undefined'
    ? []
    : [...navigator.languages, navigator.language];

  for (const language of languages.map((value) => value.toLowerCase())) {
    const exact = localeIds().find((value) => value.toLowerCase() === language);
    if (exact) return exact;

    const base = localeIds().find((value) => value.toLowerCase().split('-')[0] === language.split('-')[0]);
    if (base) return base;
  }

  return fallbackLocale;
}

export const ready = (async () => {
  try {
    const values = Array.isArray((manifest as { locales?: unknown }).locales)
      ? (manifest as { locales: unknown[] }).locales
      : [];
    const valid = values.filter((value): value is string => typeof value === 'string' && /^[\w-]+$/.test(value));
    setLocaleIds([...new Set([fallbackLocale, ...valid])]);
    const next = await detectLocale();
    await loadResource(next);
    setCurrentLocale(next);
    if (typeof document !== 'undefined') document.documentElement.lang = next;
  } catch {
    // English is bundled and remains a valid fallback if asset discovery fails.
  }
})();

export function locale(): Locale {
  return currentLocale();
}

export function locales(): Array<{ value: Locale; label: string }> {
  return localeIds().map((value) => ({
    value,
    label: resources()[value]?.displayName ?? value,
  }));
}

export function setLocale(value: Locale): void {
  const next = localeIds().includes(value) ? value : fallbackLocale;
  setCurrentLocale(next);
  void loadResource(next);
  try {
    localStorage.setItem(localeStorageKey, next);
    localStorage.setItem(explicitLocaleStorageKey, '1');
  } catch {
    // Browser storage is optional.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}

export function toggleLocale(): void {
  const next = locales().find((item) => item.value !== currentLocale());
  if (next) setLocale(next.value);
}

export function nextLocaleLabel(): string {
  return locales().find((item) => item.value !== currentLocale())?.label ?? currentLocale();
}

export function t(key: string, vars: Record<string, string | number> = {}): string {
  const template = resources()[currentLocale()]?.messages[key]
    ?? resources()[fallbackLocale]?.messages[key]
    ?? key;
  return template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined ? match : String(value);
  });
}
