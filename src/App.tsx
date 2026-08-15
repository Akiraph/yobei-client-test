import { createSignal, lazy, onCleanup, onMount, Show, Suspense } from 'solid-js';
import { state, applyTheme, setPhase, initVaultLockListener, startSyncPolling } from './lib/store';
import { isDesktop } from './lib/window';
import { isInitialized, inTauri } from './lib/ipc';
import { t } from './lib/i18n';
import { NotificationStack } from './lib/notify';
import { syncTrayLocale } from './lib/tray';
import { dialogState, hideDialog } from './lib/dialog';
import Dialog from './components/Dialog';
import Titlebar from './components/Titlebar';
const Setup = lazy(() => import('./routes/Setup'));
const Unlock = lazy(() => import('./routes/Unlock'));
const Vault = lazy(() => import('./pages/VaultPage'));

export default function App() {
  const [startupFailed, setStartupFailed] = createSignal(false);

  async function initialize() {
    setStartupFailed(false);
    if (!inTauri) {
      setPhase('unlocked');
      return;
    }
    try {
      setPhase(await isInitialized() ? 'locked' : 'setup');
    } catch {
      setStartupFailed(true);
    }
  }

  onMount(() => {
    applyTheme(state.theme);
    const stopLockListener = initVaultLockListener();
    const stopSyncPolling = startSyncPolling();
    onCleanup(() => {
      stopLockListener();
      stopSyncPolling();
    });
    void syncTrayLocale();
    void initialize();
  });

  return (
    <>
      <div class="sky-layer" aria-hidden="true" />
      <div class="fog-layer" aria-hidden="true">
        <div class="fog-bank" />
        <div class="fog-blob fog-blob-1" />
        <div class="fog-blob fog-blob-2" />
      </div>

      <Show when={isDesktop()}>
        <Titlebar />
      </Show>

      <div class="app-body" classList={{ 'with-titlebar': isDesktop() }}>
        <Show when={state.phase === 'loading'}>
          <LoadingStage failed={startupFailed()} onRetry={() => void initialize()} />
        </Show>
        <Suspense fallback={<LoadingStage />}>
          <Show when={state.phase === 'setup'}>
            <Setup />
          </Show>
          <Show when={state.phase === 'locked'}>
            <Unlock />
          </Show>
          <Show when={state.phase === 'unlocked'}>
            <Vault />
          </Show>
        </Suspense>
      </div>

      <NotificationStack />

      <Dialog open={dialogState().open} title={dialogState().title} onClose={hideDialog}>
        {dialogState().children}
      </Dialog>
    </>
  );
}

function LoadingStage(props: { failed?: boolean; onRetry?: () => void }) {
  return (
    <div class="setup-stage">
      <div class="setup-card setup-brand">
        <div class="brand-name font-serif">{t('app.name')}</div>
        <Show when={props.failed} fallback={<div class="brand-sub">{t('common.loading')}</div>}>
          <div class="brand-sub">{t('error.setupFailed')}</div>
          <button class="btn btn-primary setup-cta" onClick={() => props.onRetry?.()}>{t('common.retry')}</button>
        </Show>
      </div>
    </div>
  );
}
