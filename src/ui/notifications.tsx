import { For, createSignal } from 'solid-js';
import { t } from '../core/locale';

type NoticeKind = 'ok' | 'error';
interface Notice { id: number; kind: NoticeKind; text: string; }

let nextId = 0;
const [notices, setNotices] = createSignal<Notice[]>([]);

function push(kind: NoticeKind, text: string): void {
  const id = ++nextId;
  setNotices((items) => [...items, { id, kind, text }]);
  window.setTimeout(() => {
    setNotices((items) => items.filter((item) => item.id !== id));
  }, 5000);
}

export const notify = {
  ok: (text: string) => push('ok', text),
  error: (text: string) => push('error', text),
};

export function NotificationStack() {
  return (
    <div class="notif-stack" aria-label={t('common.notifications')}>
      <For each={notices()}>
        {(notice) => (
          <button
            class={`notif notif-${notice.kind}`}
            type="button"
            onClick={() => setNotices((items) => items.filter((item) => item.id !== notice.id))}
          >
            <span class="notif-text">{notice.text}</span>
          </button>
        )}
      </For>
    </div>
  );
}
