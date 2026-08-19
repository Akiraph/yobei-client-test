import { createSignal } from 'solid-js';

export interface ScanRequest {
  onResult: (value: string) => void | Promise<void>;
}

const [request, setRequest] = createSignal<ScanRequest | null>(null);

// Set while the scanner itself pops the history entry it pushed, so the
// vault-level popstate handler can tell a programmatic back from a user back.
let programmaticBack = false;

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 859px)').matches;
}

export const scanner = {
  open(next: ScanRequest): void {
    programmaticBack = false;
    setRequest(next);
    if (isMobileViewport() && history.state?.yobei !== 'scan') {
      history.pushState({ ...(history.state ?? {}), yobei: 'scan' }, '');
    }
  },

  close(): void {
    if (!request()) return;
    setRequest(null);
    if (history.state?.yobei === 'scan') {
      programmaticBack = true;
      history.back();
    }
  },

  // Tears the scanner down without touching the history stack (used when the
  // host unmounts, e.g. the vault auto-locks while a scan is running).
  clear(): void {
    programmaticBack = false;
    setRequest(null);
  },

  isOpen(): boolean {
    return request() !== null;
  },
};

export function consumeScannerBack(): boolean {
  if (!programmaticBack) return false;
  programmaticBack = false;
  return true;
}

export { request as scanRequest };
