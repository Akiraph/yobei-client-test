import { createSignal, createEffect, onCleanup, onMount, Show } from 'solid-js';
import { state, selectItem, toggleSettings, deleteItem } from '../lib/store';
import { inTauri, markActivity } from '../lib/ipc';
import Sidebar from '../components/Sidebar';
import ItemList from '../components/ItemList';
import ItemDetail from '../components/ItemDetail';
import ItemEditor from '../components/ItemEditor';
import Settings from './Settings';
import { notifyError } from '../lib/notify';
import { errorMessage } from '../lib/errors';

type Pane = 'list' | 'detail';
type EditState = { mode: 'new' } | { mode: 'edit'; id: string } | null;

export default function Vault() {
  const [mobile, setMobile] = createSignal(window.innerWidth < 860);
  const [pane, setPane] = createSignal<Pane>('list');
  const [editing, setEditing] = createSignal<EditState>(null);

  onMount(() => {
    const onResize = () => setMobile(window.innerWidth < 860);
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });

  createEffect(() => {
    if (!inTauri) return;
    let last = 0;
    const ping = () => {
      const now = Date.now();
      if (now - last >= 5000) {
        last = now;
        markActivity().catch(() => {});
      }
    };
    const events: (keyof WindowEventMap)[] = [
      'pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll',
    ];
    events.forEach((e) => window.addEventListener(e, ping, { passive: true }));
    onCleanup(() => {
      events.forEach((e) => window.removeEventListener(e, ping));
    });
  });

  function handleSelect() {
    if (mobile()) setPane('detail');
  }

  function handleBack() {
    setPane('list');
    selectItem(null);
    setEditing(null);
  }

  function handleNew() {
    selectItem(null);
    setEditing({ mode: 'new' });
    if (mobile()) setPane('detail');
  }

  function handleEdit(id: string) {
    setEditing({ mode: 'edit', id });
    if (mobile()) setPane('detail');
  }

  async function handleDelete(id: string) {
    try {
      await deleteItem(id);
    } catch (error) {
      notifyError(errorMessage(error));
      return;
    }
    setEditing(null);
    if (mobile()) setPane('list');
  }

  return (
    <div class={`vault-root fog-reveal${state.condensing ? ' fog-condense' : ''}`}>
      <Show when={state.showSettings}>
        <Settings onClose={() => toggleSettings(false)} />
      </Show>

      <Show when={!state.showSettings}>
        <Show when={!mobile()}>
          <aside class="vault-sidebar">
            <Sidebar />
          </aside>
        </Show>

        <Show when={!mobile() || pane() === 'list'}>
          <section class="vault-list">
            <ItemList onSelect={handleSelect} onNew={handleNew} />
          </section>
        </Show>

        <Show when={!mobile() || pane() === 'detail'}>
          <aside class="vault-detail">
            <Show when={editing()} fallback={
              <ItemDetail onBack={mobile() ? handleBack : undefined} onEdit={handleEdit} onDelete={handleDelete} />
            }>
              <ItemEditor
                item={editing()?.mode === 'edit' ? state.items.find((i) => i.id === (editing() as any).id) : null}
                onClose={() => setEditing(null)}
                onSaved={() => setEditing(null)}
              />
            </Show>
          </aside>
        </Show>
      </Show>
    </div>
  );
}
