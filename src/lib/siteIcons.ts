interface SiteIconResource {
  version: number;
  icons: Record<string, string>;
}

import { inTauri, readExternalAsset } from './ipc';
import { isDesktop } from './window';

let resourcePromise: Promise<SiteIconResource> | undefined;
const RESOLVED_CACHE_KEY = 'yobei.site-icons.v1';

function loadResolvedCache(): Array<[string, string]> {
  try {
    const raw = localStorage.getItem(RESOLVED_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<[string, string]>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const resolvedCache = new Map<string, string | undefined>(loadResolvedCache());

function persistResolvedCache() {
  try {
    const entries: Array<[string, string]> = [];
    for (const [host, value] of resolvedCache) {
      if (value) entries.push([host, value]);
    }
    localStorage.setItem(RESOLVED_CACHE_KEY, JSON.stringify(entries));
  } catch {
  }
}

function loadResource(): Promise<SiteIconResource> {
  if (!resourcePromise) {
    resourcePromise = (inTauri && isDesktop()
      ? readExternalAsset('site-icons.json').then((content) => JSON.parse(content) as SiteIconResource)
      : fetch('/site-icons.json').then((response) => response.ok
        ? response.json() as Promise<SiteIconResource>
        : Promise.reject(new Error('site icon resource unavailable'))))
      .catch(() => ({ version: 1, icons: {} }));
  }
  return resourcePromise;
}

function hostFrom(value?: string): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : `https://${raw}`)
      .hostname.toLowerCase()
      .replace(/^www\./, '');
  } catch {
    return raw.toLowerCase().replace(/^www\./, '').split('/')[0];
  }
}

function lookupMaintained(resource: SiteIconResource, host: string): string | undefined {
  const exact = resource.icons[host];
  if (exact) return exact;
  const parent = Object.keys(resource.icons).find((domain) => host.endsWith(`.${domain}`));
  return parent ? resource.icons[parent] : undefined;
}

export async function siteIconUrl(url?: string, title?: string): Promise<string | undefined> {
  const host = hostFrom(url) || hostFrom(title);
  if (!host) return undefined;
  if (resolvedCache.has(host)) return resolvedCache.get(host);

  const resource = await loadResource();
  let resolved = lookupMaintained(resource, host);

  // Title-only items have no host suffix (e.g. title "GitHub" -> "github"), so
  // also match the first segment of a maintained domain against the title.
  if (!resolved) {
    const token = (title ?? '').trim().toLowerCase().split(/\s+/)[0];
    const domain = Object.keys(resource.icons).find((candidate) => candidate.split('.')[0] === token);
    if (domain) resolved = resource.icons[domain];
  }

  // Last resort: Google's favicon service. Keep it behind the cache so a host
  // is never resolved twice during a session.
  if (!resolved && host.includes('.')) {
    resolved = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  }

  resolvedCache.set(host, resolved);
  persistResolvedCache();
  return resolved;
}
