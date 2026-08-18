import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform } from '@tauri-apps/plugin-os';
import { inTauri } from './backend';

export function isDesktop(): boolean {
  return Boolean(__YOBEI_DESKTOP__);
}

export function isMac(): boolean {
  return inTauri
    ? platform() === 'macos'
    : navigator.platform?.toLowerCase().includes('mac') ?? false;
}

export async function winMinimize(): Promise<void> {
  if (inTauri) await getCurrentWindow().minimize();
}

export async function winToggleMaximize(): Promise<void> {
  if (inTauri) await getCurrentWindow().toggleMaximize();
}

export async function winClose(): Promise<void> {
  if (inTauri) await getCurrentWindow().close();
}

export async function winIsMaximized(): Promise<boolean> {
  return inTauri ? getCurrentWindow().isMaximized() : false;
}
