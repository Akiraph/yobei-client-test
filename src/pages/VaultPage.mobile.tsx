import { lazy, Show, Suspense } from 'solid-js';
import Sidebar from '../features/vault/ui/Sidebar';
import ItemList from '../features/vault/ui/ItemList';
import VaultDetailPane from '../features/vault/ui/VaultDetailPane';
import Backdrop from '../shared/ui/Backdrop';
import type { VaultFeature } from '../features/vault/model';

const Settings = lazy(() => import('../routes/Settings'));

interface Props {
  feature: VaultFeature;
}

export default function VaultPageMobile(props: Props) {
  let touchStartX = 0;
  let touchStartY = 0;

  function onTouchStart(event: TouchEvent) {
    const touch = event.touches[0];
    if (touch) {
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    }
  }

  function onTouchMove(event: TouchEvent) {
    const touch = event.touches[0];
    if (!touch || props.feature.sidebarOpen()) return;
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    if (touchStartX < 28 && dx > 64 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      props.feature.openSidebar();
    }
  }

  return (
    <div
      class={`vault-root fog-reveal${props.feature.condensing() ? ' fog-condense' : ''}`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
    >
      <Show when={props.feature.settingsOpen()}>
        <Suspense fallback={null}>
          <Settings onClose={props.feature.closeSettings} />
        </Suspense>
      </Show>

      <Show when={!props.feature.settingsOpen()}>
        <Show when={props.feature.sidebarOpen()}>
          <Backdrop class="sidebar-scrim" onPointerDown={props.feature.closeSidebar} />
          <aside class="vault-sidebar drawer">
            <Sidebar feature={props.feature} onNavigate={props.feature.closeSidebar} />
          </aside>
        </Show>

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
