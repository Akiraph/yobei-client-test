import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { unlock, recordPasswordEntry } from '../lib/store';
import { unlockVault, unlockWithBiometric, isBiometricEnabled } from '../lib/ipc';
import { IconFingerprint } from '../components/Icon';
import { PinInput } from '../components/PinInput';
import { notifyError } from '../lib/notify';
import { t } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import { isDesktop } from '../lib/window';

export default function Unlock() {
  const [password, setPassword] = createSignal('');
  const [status, setStatus] = createSignal<'idle' | 'error'>('idle');
  const [errMsg, setErrMsg] = createSignal('');
  const [biometricEnabled, setBiometricEnabled] = createSignal(false);
  const [pinAutofocus, setPinAutofocus] = createSignal(false);
  const [biometricBusy, setBiometricBusy] = createSignal(false);
  const [unlockBusy, setUnlockBusy] = createSignal(false);
  let autoBiometricAttempted = false;

  onMount(() => {
    let alive = true;
    onCleanup(() => { alive = false; });
    async function probeBiometric() {
      const enabled = await isBiometricEnabled().catch(() => false);
      if (!alive) return;
      setBiometricEnabled(enabled);
      if (!enabled || autoBiometricAttempted) {
        if (!enabled) setPinAutofocus(true);
        return;
      }
      autoBiometricAttempted = true;
      if (!isDesktop()) {
        // Mobile: trigger the system biometric prompt and, on failure, focus the
        // PIN so the on-screen keyboard appears.
        window.setTimeout(() => {
          if (alive) void doBiometricUnlock();
        }, 0);
      } else {
        // Desktop: the silent startup unlock was already attempted before this
        // screen mounted. Focus the PIN for immediate typing; the fingerprint
        // icon triggers a manual Windows Hello prompt.
        setPinAutofocus(true);
      }
    }
    void probeBiometric();
  });

  async function doUnlock() {
    if (unlockBusy() || biometricBusy()) return;
    if (!/^\d{6}$/.test(password())) {
      setStatus('error');
      setErrMsg(t('unlock.passwordRequired'));
      return;
    }
    setStatus('idle');
    setUnlockBusy(true);
    try {
      await unlockVault(password());
      recordPasswordEntry();
      void unlock();
    } catch (error) {
      setStatus('error');
      const message = errorMessage(error, 'invalid_password');
      setErrMsg(message);
      notifyError(message);
      setPassword('');
    } finally {
      setUnlockBusy(false);
    }
  }

  async function doBiometricUnlock() {
    if (unlockBusy() || biometricBusy()) return;
    setStatus('idle');
    setBiometricBusy(true);
    try {
      await unlockWithBiometric(t('unlock.biometricUnlock'));
      void unlock();
    } catch {
      // Cancelled or unavailable — fall back to the PIN silently.
      setPinAutofocus(true);
    }
    setBiometricBusy(false);
  }

  const hint = () => {
    if (biometricEnabled()) return t('unlock.biometricHint');
    return t('unlock.hint');
  };

  return (
    <div class="unlock-stage">
      <div class="unlock-visual">
        <span class="unlock-content">{t('app.name')}</span>
      </div>

      <div class="unlock-form">
        <PinInput
          value={password()}
          onInput={(value) => { setPassword(value); setStatus('idle'); }}
          onComplete={() => void doUnlock()}
          autofocus={pinAutofocus()}
          disabled={unlockBusy() || biometricBusy()}
          ariaLabel={t('unlock.passwordPlaceholder')}
        />

        <Show when={biometricEnabled()}>
          <div class="unlock-actions">
            <button class="icon-btn unlock-hello" title={t('unlock.biometric')} aria-label={t('unlock.biometricUnlock')}
              onClick={() => void doBiometricUnlock()} disabled={unlockBusy() || biometricBusy()}>
              <IconFingerprint size={20} />
            </button>
          </div>
        </Show>

        <div class={`unlock-status${status() === 'error' ? ' error' : ''}`}>
          <Show when={status() === 'error'}>{errMsg()}</Show>
          <Show when={status() !== 'error'}>{unlockBusy() || biometricBusy() ? t('common.processing') : hint()}</Show>
        </div>
      </div>
    </div>
  );
}
