import { Show, createSignal, onMount } from 'solid-js';
import { winMinimize, winToggleMaximize, winClose, winIsMaximized, isMac } from '../lib/window';
import { t } from '../lib/i18n';
import { IconMaximize, IconMinus, IconRestore, IconX } from './Icon';

interface Props {
  title?: string;
}

export default function Titlebar(props: Props) {
  const [maximized, setMaximized] = createSignal(false);

  onMount(async () => {
    setMaximized(await winIsMaximized());
  });

  async function toggleMax() {
    await winToggleMaximize();
    setMaximized(await winIsMaximized());
  }

  return (
    <header
      class="titlebar"
      classList={{ 'titlebar-mac': isMac() }}
      data-tauri-drag-region
      onDblClick={(e) => {
        if ((e.target as HTMLElement).closest('.tb-btn')) return;
        winToggleMaximize();
      }}
    >
      <Show when={isMac()}>
        <div class="tb-traffic-spacer" />
      </Show>

      <div class="tb-title font-serif" data-tauri-drag-region>
        {props.title ?? t('app.name')}
      </div>

      <Show when={!isMac()}>
        <div class="tb-controls">
          <button class="tb-btn tb-min" onClick={winMinimize} aria-label={t('titlebar.minimize')} title={t('titlebar.minimize')}>
            <IconMinus size={14} />
          </button>
          <button class="tb-btn tb-max" onClick={toggleMax} aria-label={maximized() ? t('titlebar.restore') : t('titlebar.maximize')} title={maximized() ? t('titlebar.restore') : t('titlebar.maximize')}>
            <Show when={maximized()} fallback={
              <IconMaximize size={14} />
            }>
              <IconRestore size={14} />
            </Show>
          </button>
          <button class="tb-btn tb-close" onClick={winClose} aria-label={t('common.close')} title={t('common.close')}>
            <IconX size={14} />
          </button>
        </div>
      </Show>
    </header>
  );
}
