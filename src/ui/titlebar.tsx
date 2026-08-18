import { Show, createSignal, onMount } from 'solid-js';
import { t } from '../core/locale';
import { isDesktop, winClose, winIsMaximized, winMinimize, winToggleMaximize } from '../core/window';
import { IconMaximize, IconMinus, IconRestore, IconX } from './icons';

export default function Titlebar() {
  const [maximized, setMaximized] = createSignal(false);

  onMount(() => {
    void winIsMaximized().then(setMaximized).catch(() => {});
  });

  async function toggleMaximize() {
    await winToggleMaximize().catch(() => {});
    setMaximized(await winIsMaximized());
  }

  return (
    <Show when={isDesktop()}>
      <header class="titlebar" data-tauri-drag-region>
        <div class="tb-title font-serif">{t('app.name')}</div>
        <div class="tb-controls">
          <button class="tb-btn" onClick={winMinimize} aria-label={t('titlebar.minimize')}>
            <IconMinus size={14} />
          </button>
          <button
            class="tb-btn"
            onClick={() => void toggleMaximize()}
            aria-label={maximized() ? t('titlebar.restore') : t('titlebar.maximize')}
          >
            {maximized() ? <IconRestore size={14} /> : <IconMaximize size={14} />}
          </button>
          <button class="tb-btn tb-close" onClick={winClose} aria-label={t('common.close')}>
            <IconX size={14} />
          </button>
        </div>
      </header>
    </Show>
  );
}
