import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { consumeScannerBack, scanner } from '../../core/scan';
import { state, actions } from '../../core/state';
import SettingsPage from '../settings/SettingsPage';
import DetailPane from './DetailPane';
import ItemList from './ItemList';
import Sidebar from './Sidebar';
import { addTotpFromUri } from './totp';
import { useMediaQuery } from './useMediaQuery';

export default function VaultPage() {
  const mobile = useMediaQuery('(max-width: 859px)');
  const [pane, setPane] = createSignal<'list' | 'detail'>('list');
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null | undefined>(undefined);
  let startX = 0;
  let startY = 0;

  onMount(() => {
    function onPopState() {
      if (!mobile()) return;
      if (consumeScannerBack()) return;
      if (scanner.isOpen()) {
        scanner.close();
        return;
      }
      if (state.settingsOpen) {
        actions.toggleSettings(false);
        return;
      }
      if (sidebarOpen()) {
        setSidebarOpen(false);
        return;
      }
      setPane('list');
      setEditingId(undefined);
      actions.select(null);
    }

    window.addEventListener('popstate', onPopState);
    onCleanup(() => window.removeEventListener('popstate', onPopState));
  });

  function openItem(id: string) {
    actions.select(id);
    setEditingId(undefined);
    setPane('detail');
    if (mobile() && history.state?.yobei !== 'detail') {
      history.pushState({ ...(history.state ?? {}), yobei: 'detail' }, '');
    }
  }

  function startNewItem() {
    actions.select(null);
    setEditingId(null);
    setPane('detail');
    if (mobile() && history.state?.yobei !== 'detail') {
      history.pushState({ ...(history.state ?? {}), yobei: 'detail' }, '');
    }
  }

  function closeDetail() {
    setEditingId(undefined);
    actions.select(null);
    if (mobile() && history.state?.yobei === 'detail') history.back();
    else setPane('list');
  }

  function openSettings() {
    setSidebarOpen(false);
    actions.toggleSettings(true);
  }

  function openScanner() {
    setSidebarOpen(false);
    scanner.open({ onResult: addTotpFromUri });
  }

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    startX = touch.clientX;
    startY = touch.clientY;
  }

  function onTouchMove(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (sidebarOpen() && dx < 0) setSidebarOpen(false);
    else if (!sidebarOpen() && startX < 28 && dx > 0) setSidebarOpen(true);
  }

  return (
    <Show
      when={state.settingsOpen}
      fallback={
        <VaultLayout
          mobile={mobile}
          pane={pane}
          sidebarOpen={sidebarOpen}
          editingId={editingId}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onMenu={() => setSidebarOpen(true)}
          onSettings={openSettings}
          onScan={openScanner}
          onCloseSidebar={() => setSidebarOpen(false)}
          onSelect={openItem}
          onNew={startNewItem}
          onEdit={(id) => setEditingId(id)}
          onCloseDetail={closeDetail}
        />
      }
    >
      <SettingsPage onClose={() => actions.toggleSettings(false)} />
    </Show>
  );
}

interface VaultLayoutProps {
  mobile: () => boolean;
  pane: () => 'list' | 'detail';
  sidebarOpen: () => boolean;
  editingId: () => string | null | undefined;
  onTouchStart: (event: TouchEvent) => void;
  onTouchMove: (event: TouchEvent) => void;
  onMenu: () => void;
  onSettings: () => void;
  onScan: () => void;
  onCloseSidebar: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onCloseDetail: () => void;
}

function VaultLayout(props: VaultLayoutProps) {
  return (
    <div
      class={`vault-root fog-reveal${state.condensing ? ' fog-condense' : ''}`}
      onTouchStart={props.onTouchStart}
      onTouchMove={props.onTouchMove}
    >
      <Show when={props.mobile() && props.sidebarOpen()}>
        <div class="sidebar-scrim open" onPointerDown={props.onCloseSidebar} />
      </Show>

      <aside
        class={`vault-sidebar${props.mobile() ? ' drawer' : ''}${props.sidebarOpen() ? ' open' : ''}`}
        aria-hidden={props.mobile() ? !props.sidebarOpen() : undefined}
      >
        <Sidebar onSettings={props.onSettings} onClose={props.onCloseSidebar} />
      </aside>

      <Show when={!props.mobile() || props.pane() === 'list'}>
        <section class="vault-list">
          <ItemList
            onMenu={props.mobile() ? props.onMenu : undefined}
            onSelect={props.onSelect}
            onNew={props.onNew}
            onScan={props.onScan}
          />
        </section>
      </Show>

      <Show when={!props.mobile() || props.pane() === 'detail'}>
        <DetailPane
          mobile={props.mobile()}
          editingId={props.editingId()}
          onEdit={props.onEdit}
          onClose={props.onCloseDetail}
        />
      </Show>
    </div>
  );
}
