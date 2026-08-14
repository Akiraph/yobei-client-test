import { invoke } from '@tauri-apps/api/core';
import { inTauri, isDesktop } from './window';
import { onLocaleChange, t } from './i18n';

export async function syncTrayLocale(): Promise<void> {
  if (!__YOBEI_DESKTOP__ || !inTauri || !isDesktop()) return;
  try {
    await invoke('set_tray_labels', {
      labels: {
        show: t('tray.show'),
        quit: t('tray.quit'),
      },
    });
  } catch {
    // The tray is unavailable in web previews and during early startup.
  }
}

onLocaleChange(() => {
  void syncTrayLocale();
});
