import { Show, Suspense, createSignal, lazy, onCleanup, onMount } from 'solid-js';
import { dialog, hideDialog } from '../core/dialog';
import { backend } from '../core/backend';
import { state, actions, applyInitialTheme } from '../core/state';
import { t } from '../core/locale';
import Dialog from '../ui/dialog';
import { NotificationStack } from '../ui/notifications';
import Titlebar from '../ui/titlebar';

const AuthPage = lazy(() => import('../features/auth/AuthPage'));
const VaultPage = lazy(() => import('../features/vault/VaultPage'));

export default function App() {
  const [startupFailed, setStartupFailed] = createSignal(false);

  onMount(() => {
    applyInitialTheme();
    const stopLocked = backend.onVaultEvent('vault-locked', () => void actions.lock());
    const stopUnlocked = backend.onVaultEvent('vault-unlocked', () => void actions.unlockReady());

    void actions.initialize().catch(() => setStartupFailed(true));
    onCleanup(() => {
      stopLocked();
      stopUnlocked();
    });
  });

  function retry() {
    setStartupFailed(false);
    void actions.initialize().catch(() => setStartupFailed(true));
  }

  return (
    <>
      <div class="sky-layer" aria-hidden="true" />
      <div class="fog-layer" aria-hidden="true">
        <div class="fog-bank" />
        <div class="fog-blob fog-blob-1" />
        <div class="fog-blob fog-blob-2" />
      </div>

      <Titlebar />

      <div class="app-body" classList={{ 'with-titlebar': __YOBEI_DESKTOP__ }}>
        <Show when={!startupFailed()} fallback={<Loading failed onRetry={retry} />}>
          <Suspense fallback={<Loading />}>
            <Show when={state.phase === 'loading'}><Loading /></Show>
            <Show when={state.phase === 'setup'}><AuthPage mode="setup" /></Show>
            <Show when={state.phase === 'locked'}><AuthPage mode="locked" /></Show>
            <Show when={state.phase === 'unlocked'}><VaultPage /></Show>
          </Suspense>
        </Show>
      </div>

      <NotificationStack />
      <Dialog open={dialog().open} title={dialog().title} onClose={hideDialog}>{dialog().body}</Dialog>
    </>
  );
}

function Loading(props: { failed?: boolean; onRetry?: () => void } = {}) {
  return (
    <div class="setup-stage">
      <div class="setup-card setup-brand">
        <div class="brand-name font-serif">{t('app.name')}</div>
        <Show when={props.failed} fallback={<div class="brand-sub">{t('common.loading')}</div>}>
          <div class="brand-sub">{t('error.setupFailed')}</div>
          <button class="btn btn-primary setup-cta" onClick={props.onRetry}>{t('common.retry')}</button>
        </Show>
      </div>
    </div>
  );
}
