import { state } from './store';
import { copyToClipboard, inTauri } from './ipc';

export async function copyText(text: string): Promise<void> {
  if (inTauri) {
    await copyToClipboard(text);
    return;
  }
  await navigator.clipboard.writeText(text);
  const sec = state.settings.clipboardSec;
  if (sec > 0) {
    const expected = text;
    window.setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === expected) {
          await navigator.clipboard.writeText('');
        }
      } catch {
      }
    }, sec * 1000);
  }
}
