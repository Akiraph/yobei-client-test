import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { consumeScannerBack, scanner } from '../../core/scan';
import { state, actions } from '../../core/state';
import SettingsPage from '../settings/SettingsPage';
import DetailPane from './DetailPane';
import ItemList from './ItemList';
import Sidebar from './Sidebar';
import { flight, rowRect } from './flight';
import { addTotpFromUri } from './totp';
import { useMediaQuery } from './useMediaQuery';

export default function VaultPage() {
  const mobile = useMediaQuery('(max-width: 859px)');
  const [pane, setPane] = createSignal<'list' | 'detail'>('list');
  const [sidebarOpen, setSidebarOpen] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null | undefined>(undefined);
  // True while the pane shrinks back, so the list is already visible behind it.
  const [collapsing, setCollapsing] = createSignal(false);
  // Set once the pane exists; the flight animation transforms this element.
  let detailEl: HTMLElement | undefined;
  let startX = 0;
  let startY = 0;

  onMount(() => {
    // Each mobile overlay gets a history entry. This makes Android's system
    // back gesture unwind the current UI layer before it can leave the vault.
    if (mobile() && !history.state?.yobei) {
      history.replaceState({ ...(history.state ?? {}), yobei: 'vault' }, '');
    }

    function onPopState() {
      if (!mobile()) return;
      if (consumeScannerBack()) return;
      if (scanner.isOpen()) {
        scanner.close();
        return;
      }
      if (state.settingsOpen) {
        if (state.settingsSubpage) actions.openSettingsSubpage(null);
        else actions.toggleSettings(false);
        return;
      }
      if (sidebarOpen()) {
        setSidebarOpen(false);
        return;
      }
      void collapseDetail();
    }

    window.addEventListener('popstate', onPopState);
    onCleanup(() => window.removeEventListener('popstate', onPopState));
  });

  function openItem(id: string) {
    const rect = rowRect(id);
    actions.select(id);
    setEditingId(undefined);
    setPane('detail');
    // A microtask runs after Solid has flushed the render, whether or not the
    // event handler batched it, so the pane exists and can be measured.
    if (rect) queueMicrotask(() => {
      if (!detailEl) return;
      const animation = flight(detailEl, rect);
      // Drop the fill afterwards, so the pane holds no leftover transform.
      void animation?.finished.then(() => animation.cancel(), () => {});
    });
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

  // Shrink the pane back onto its row. The list never unmounts, so the row is
  // still at the same scroll offset the user left it at. Desktop keeps the pane
  // on screen permanently, so there is nothing to fly back there.
  async function collapseDetail() {
    const rect = mobile() ? rowRect(state.selectedId) : null;
    const animation = rect && detailEl ? flight(detailEl, rect, true) : null;
    if (animation) {
      setCollapsing(true);
      await animation.finished.catch(() => {});
    }
    setPane('list');
    setEditingId(undefined);
    actions.select(null);
    setCollapsing(false);
    animation?.cancel();
  }

  function closeDetail() {
    if (mobile() && history.state?.yobei === 'detail') history.back();
    else void collapseDetail();
  }

  function openSettings() {
    setSidebarOpen(false);
    actions.toggleSettings(true);
    if (mobile() && history.state?.yobei !== 'settings') {
      history.pushState({ ...(history.state ?? {}), yobei: 'settings' }, '');
    }
  }

  function closeSettings() {
    if (mobile() && history.state?.yobei === 'settings') history.back();
    else actions.toggleSettings(false);
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
          collapsing={collapsing}
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
          detailRef={(element) => { detailEl = element; }}
        />
      }
    >
      <SettingsPage onClose={closeSettings} />
    </Show>
  );
}

interface VaultLayoutProps {
  mobile: () => boolean;
  pane: () => 'list' | 'detail';
  collapsing: () => boolean;
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
  detailRef: (element: HTMLElement) => void;
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

      {/* The list stays mounted on mobile so its scroll offset and row rects
          survive while the detail pane is open. */}
      <section
        class="vault-list"
        classList={{ 'pane-hidden': props.mobile() && props.pane() === 'detail' && !props.collapsing() }}
        aria-hidden={props.mobile() && props.pane() === 'detail' && !props.collapsing()}
      >
        <ItemList
          onMenu={props.mobile() ? props.onMenu : undefined}
          onSelect={props.onSelect}
          onNew={props.onNew}
          onScan={props.onScan}
        />
      </section>

      <Show when={!props.mobile() || props.pane() === 'detail'}>
        <DetailPane
          ref={props.detailRef}
          mobile={props.mobile()}
          editingId={props.editingId()}
          onEdit={props.onEdit}
          onClose={props.onCloseDetail}
        />
      </Show>
    </div>
  );
}
