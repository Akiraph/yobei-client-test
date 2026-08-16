import { lazy, Show, Suspense } from 'solid-js';
import Sidebar from '../features/vault/ui/Sidebar';
import ItemList from '../features/vault/ui/ItemList';
import VaultDetailPane from '../features/vault/ui/VaultDetailPane';
import ScanPage from '../features/vault/ui/ScanPage';
import Backdrop from '../shared/ui/Backdrop';
import type { VaultFeature } from '../features/vault/model';

const Settings = lazy(() => import('../routes/Settings'));

interface Props {
  feature: VaultFeature;
}

export default function VaultPageMobile(props: Props) {
  let touchStartX = 0;
  let touchStartY = 0;
  let gestureHandled = false;

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    if (touch) {
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      gestureHandled = false;
    }
  }

  function onTouchMove(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch || gestureHandled) return;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    if (Math.abs(dx) <= 64 || Math.abs(dx) <= Math.abs(dy) * 1.5) return;

    if (props.feature.sidebarOpen() && dx < 0) {
      gestureHandled = true;
      props.feature.closeSidebar();
      return;
    }

    if (!props.feature.sidebarOpen() && touchStartX < 28 && dx > 0) {
      gestureHandled = true;
      props.feature.openSidebar();
      return;
    }
  }

  function onTouchEnd() {
    gestureHandled = false;
  }

  return (
    <div
      class={`vault-root fog-reveal${props.feature.condensing() ? ' fog-condense' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <Show when={props.feature.scanning()}>
        <ScanPage feature={props.feature} />
      </Show>

      <Show when={!props.feature.scanning() && props.feature.settingsOpen()}>
        <Suspense fallback={null}>
          <Settings onClose={props.feature.closeSettings} />
        </Suspense>
      </Show>

      <Show when={!props.feature.scanning() && !props.feature.settingsOpen()}>
        <Backdrop class={`sidebar-scrim${props.feature.sidebarOpen() ? ' open' : ''}`} onPointerDown={props.feature.closeSidebar} />
        <aside class={`vault-sidebar drawer${props.feature.sidebarOpen() ? ' open' : ''}`} aria-hidden={!props.feature.sidebarOpen()}>
          <Sidebar feature={props.feature} onNavigate={props.feature.closeSidebar} />
        </aside>

        <Show when={props.feature.pane() === 'list'}>
          <section class="vault-list">
            <ItemList feature={props.feature} onNew={props.feature.createNew} onMenu={props.feature.openSidebar} />
          </section>
        </Show>

        <Show when={props.feature.pane() === 'detail'}>
          <VaultDetailPane feature={props.feature} mobile />
        </Show>
      </Show>
    </div>
  );
}
