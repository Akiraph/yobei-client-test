import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform } from '@tauri-apps/plugin-os';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const desktopBuild = __YOBEI_DESKTOP__;

export function isDesktop(): boolean {
  return desktopBuild && (!inTauri || !['android', 'ios'].includes(platform()));
}

export function isMac(): boolean {
  return inTauri ? platform() === 'macos' : navigator.platform?.toLowerCase().includes('mac') ?? false;
}

export async function winMinimize() {
  if (!inTauri) return;
  await getCurrentWindow().minimize();
}

export async function winToggleMaximize() {
  if (!inTauri) return;
  await getCurrentWindow().toggleMaximize();
}

export async function winClose() {
  if (!inTauri) return;
  await getCurrentWindow().close();
}

export async function winIsMaximized(): Promise<boolean> {
  if (!inTauri) return false;
  return getCurrentWindow().isMaximized();
}
