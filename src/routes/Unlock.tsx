import { createSignal, createEffect, onCleanup, onMount, Show } from 'solid-js';
import { unlock, recordPasswordEntry, biometricConfirmBlocked } from '../lib/store';
import { unlockVault, unlockWithBiometric, biometricAvailable, isBiometricEnabled } from '../lib/ipc';
import { IconFingerprint } from '../components/Icon';
import { PinInput } from '../components/PinInput';
import { notifyError } from '../lib/notify';
import { t } from '../lib/i18n';
import { errorMessage } from '../lib/errors';

export default function Unlock() {
  const [password, setPassword] = createSignal('');
  const [status, setStatus] = createSignal<'idle' | 'ok' | 'error'>('idle');
  const [revealed, setRevealed] = createSignal(false);
  const [errMsg, setErrMsg] = createSignal('');
  const [biometricReady, setBiometricReady] = createSignal(false);
  const [biometricBusy, setBiometricBusy] = createSignal(false);
  let autoBiometricAttempted = false;

  createEffect(() => {
    let alive = true;
    onCleanup(() => { alive = false; });
    if (biometricConfirmBlocked()) return;
    Promise.all([biometricAvailable(), isBiometricEnabled()])
      .then(([avail, enabled]) => {
        if (alive) setBiometricReady(avail && enabled);
      })
      .catch(() => {});
  });

  onMount(() => {
    if (biometricConfirmBlocked()) return;
    Promise.all([biometricAvailable(), isBiometricEnabled()])
      .then(([available, enabled]) => {
        if (available && enabled && !autoBiometricAttempted) {
          autoBiometricAttempted = true;
          void doBiometricUnlock();
        }
      })
      .catch(() => {});
  });

  async function doUnlock() {
    if (!/^\d{6}$/.test(password())) {
      setStatus('error');
      setErrMsg(t('unlock.passwordRequired'));
      return;
    }
    setStatus('idle');
    try {
      await unlockVault(password());
      recordPasswordEntry();
      setStatus('ok');
      setRevealed(true);
      setTimeout(() => void unlock(), 700);
    } catch (error) {
      setStatus('error');
      const message = errorMessage(error, 'invalid_password');
      setErrMsg(message);
      notifyError(message);
      setPassword('');
    }
  }

  async function doBiometricUnlock() {
    setStatus('idle');
    setBiometricBusy(true);
    try {
      await unlockWithBiometric(t('unlock.biometricUnlock'));
      setStatus('ok');
      setRevealed(true);
      setTimeout(() => void unlock(), 700);
    } catch (error) {
      setStatus('error');
      const message = errorMessage(error, 'biometric_unavailable');
      setErrMsg(message);
      notifyError(message);
    }
    setBiometricBusy(false);
  }

  const hint = () => {
    if (biometricConfirmBlocked()) return t('unlock.confirmHint');
    if (biometricReady()) return t('unlock.biometricHint');
    return t('unlock.hint');
  };

  return (
    <div class="unlock-stage">
      <div class={`unlock-visual${revealed() ? ' revealed' : ''}`}>
        <span class="unlock-content">{t('app.name')}</span>
      </div>

      <div class="unlock-form">
        <PinInput
          value={password()}
          onInput={(value) => { setPassword(value); setStatus('idle'); }}
          onComplete={() => void doUnlock()}
          autofocus
          ariaLabel={t('unlock.passwordPlaceholder')}
        />

        <Show when={biometricReady()}>
          <div class="unlock-actions">
            <button class="icon-btn unlock-hello" title={t('unlock.biometric')} aria-label={t('unlock.biometricUnlock')}
              onClick={doBiometricUnlock} disabled={biometricBusy()}>
              <IconFingerprint size={20} />
            </button>
          </div>
        </Show>

        <div class={`unlock-status${status() === 'ok' ? ' ok' : status() === 'error' ? ' error' : ''}`}>
          <Show when={status() === 'ok'}>{t('unlock.success')}</Show>
          <Show when={status() === 'error'}>{errMsg()}</Show>
          <Show when={status() === 'idle'}>{hint()}</Show>
        </div>
      </div>
    </div>
  );
}
