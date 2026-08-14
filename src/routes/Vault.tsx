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
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  let touchStartX = 0;
  let touchStartY = 0;

  onMount(() => {
    const onResize = () => setMobile(window.innerWidth < 860);
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));

    const onPop = () => {
      if (mobile() && pane() === 'detail') {
        setPane('list');
        selectItem(null);
        setEditing(null);
      }
    };
    window.addEventListener('popstate', onPop);
    onCleanup(() => window.removeEventListener('popstate', onPop));
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

  function showDetail() {
    if (pane() === 'detail') return;
    setPane('detail');
    if (mobile()) history.pushState({ yobei: 'detail' }, '');
  }

  function handleSelect() {
    if (mobile()) showDetail();
  }

  function handleBack() {
    if (mobile() && history.state?.yobei === 'detail') {
      history.back();
      return;
    }
    setPane('list');
    selectItem(null);
    setEditing(null);
  }

  function handleNew() {
    selectItem(null);
    setEditing({ mode: 'new' });
    if (mobile()) showDetail();
  }

  function handleEdit(id: string) {
    setEditing({ mode: 'edit', id });
    if (mobile()) showDetail();
  }

  async function handleDelete(id: string) {
    try {
      await deleteItem(id);
    } catch (error) {
      notifyError(errorMessage(error));
      return;
    }
    setEditing(null);
    if (mobile()) handleBack();
  }

  function onTouchStart(event: TouchEvent) {
    if (event.touches.length === 0) return;
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
  }

  function onTouchMove(event: TouchEvent) {
    if (!mobile() || sidebarOpen() || event.touches.length === 0) return;
    const dx = event.touches[0].clientX - touchStartX;
    const dy = event.touches[0].clientY - touchStartY;
    if (touchStartX < 28 && dx > 64 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      setSidebarOpen(true);
    }
  }

  return (
    <div
      class={`vault-root fog-reveal${state.condensing ? ' fog-condense' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
    >
      <Show when={state.showSettings}>
        <Settings onClose={() => toggleSettings(false)} />
      </Show>

      <Show when={!state.showSettings}>
        <Show when={!mobile()}>
          <aside class="vault-sidebar">
            <Sidebar />
          </aside>
        </Show>

        <Show when={mobile() && sidebarOpen()}>
          <div class="sidebar-scrim" onClick={() => setSidebarOpen(false)} />
          <aside class="vault-sidebar drawer">
            <Sidebar onNavigate={() => setSidebarOpen(false)} />
          </aside>
        </Show>

        <Show when={!mobile() || pane() === 'list'}>
          <section class="vault-list">
            <ItemList
              onSelect={handleSelect}
              onNew={handleNew}
              onMenu={mobile() ? () => setSidebarOpen(true) : undefined}
            />
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
