import { createEffect, onCleanup, onMount, Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { IconX } from './Icon';
import { t } from '../lib/i18n';
import { isDesktop } from '../lib/window';

interface Props {
  open: boolean;
  title?: string;
  onClose?: () => void;
  children: JSX.Element;
}

export default function Dialog(props: Props) {
  let panel: HTMLDivElement | undefined;
  let restore: HTMLElement | null = null;
  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!props.open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose?.();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  });

  createEffect(() => {
    if (props.open) {
      restore = document.activeElement as HTMLElement;
      queueMicrotask(() => panel?.focus());
    } else if (restore) {
      restore.focus();
      restore = null;
    }
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div class="dialog-root" classList={{ 'dialog-with-titlebar': isDesktop() }} role="presentation">
          <div class="dialog-overlay" aria-hidden="true" onPointerDown={() => props.onClose?.()} />
          <div ref={panel} class="dialog-panel" role="dialog" aria-modal="true" aria-labelledby={props.title ? 'dialog-title' : undefined} tabindex="-1">
          <Show when={props.title}>
            <div class="dialog-head">
              <span id="dialog-title" class="dialog-title">{props.title}</span>
              <button class="icon-btn dialog-close" onClick={() => props.onClose?.()} aria-label={t('common.close')}>
                <IconX size={14} />
              </button>
            </div>
          </Show>
          <div class="dialog-body">
            {props.children}
          </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
