import { Show, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { t } from '../core/locale';
import { IconX } from './icons';

interface DialogProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: JSX.Element;
}

export default function Dialog(props: DialogProps) {
  return (
    <Show when={props.open}>
      <Portal>
        <div class="dialog-root" role="presentation">
          <div class="dialog-overlay" onPointerDown={props.onClose} />
          <div class="dialog-panel" role="dialog" aria-modal="true">
            <Show when={props.title}>
              <div class="dialog-head">
                <span class="dialog-title">{props.title}</span>
                <button class="icon-btn dialog-close" onClick={props.onClose} aria-label={t('common.close')}>
                  <IconX size={14} />
                </button>
              </div>
            </Show>
            <div class="dialog-body">{props.children}</div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
