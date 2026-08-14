import { createSignal, For } from 'solid-js';
import { t } from './i18n';

type NotifKind = 'error' | 'ok';

interface Notif {
  id: number;
  kind: NotifKind;
  text: string;
  timeout: ReturnType<typeof setTimeout>;
}

let nextId = 0;
const [notifs, setNotifs] = createSignal<Notif[]>([]);

function add(kind: NotifKind, text: string, duration = 5000) {
  const id = ++nextId;
  const timeout = setTimeout(() => remove(id), duration);
  setNotifs((list) => [...list, { id, kind, text, timeout }]);
}

export function notifyError(text: string) { add('error', text); }
export function notifyOk(text: string) { add('ok', text); }

export function remove(id: number) {
  setNotifs((list) => {
    const n = list.find((n) => n.id === id);
    if (n) clearTimeout(n.timeout);
    return list.filter((n) => n.id !== id);
  });
}

export function NotificationStack() {
  return (
    <div class="notif-stack" aria-label={t('common.notifications')}>
      <For each={notifs()}>
        {(n) => (
          <button class={`notif notif-${n.kind}`} onClick={() => remove(n.id)} type="button" aria-live={n.kind === 'error' ? 'assertive' : 'polite'}>
            <span class="notif-text">{n.text}</span>
          </button>
        )}
      </For>
    </div>
  );
}
