import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { unlock, recordPasswordEntry, biometricConfirmBlocked, syncSecuritySettings } from '../lib/store';
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
  const [biometricSupported, setBiometricSupported] = createSignal(false);
  const [biometricEnabled, setBiometricEnabled] = createSignal(false);
  const [biometricBusy, setBiometricBusy] = createSignal(false);
  const [unlockBusy, setUnlockBusy] = createSignal(false);
  let autoBiometricAttempted = false;
  let transitionTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    let alive = true;
    onCleanup(() => { alive = false; });
    async function probeBiometric() {
      try {
        // Read the authoritative confirmation clock before deciding whether to
        // show the automatic prompt. localStorage can be stale after a lock.
        await syncSecuritySettings();
        const [available, enabled] = await Promise.all([biometricAvailable(), isBiometricEnabled()]);
        if (!alive) return;
        setBiometricSupported(available);
        setBiometricEnabled(enabled);
        if (available && enabled && !biometricConfirmBlocked() && !autoBiometricAttempted) {
          autoBiometricAttempted = true;
          void doBiometricUnlock();
        }
      } catch {
      }
    }
    void probeBiometric();
  });

  onCleanup(() => {
    if (transitionTimer) clearTimeout(transitionTimer);
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
      setStatus('ok');
      setRevealed(true);
      transitionTimer = setTimeout(() => void unlock(), 700);
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
      setStatus('ok');
      setRevealed(true);
      transitionTimer = setTimeout(() => void unlock(), 700);
    } catch (error) {
      setStatus('error');
      const message = errorMessage(error, 'biometric_unavailable');
      setErrMsg(message);
      notifyError(message);
    }
    setBiometricBusy(false);
  }

  const hint = () => {
    if (biometricEnabled() && biometricConfirmBlocked()) return t('unlock.confirmHint');
    if (biometricEnabled()) return t('unlock.biometricHint');
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
          disabled={unlockBusy() || biometricBusy()}
          ariaLabel={t('unlock.passwordPlaceholder')}
        />

        <Show when={biometricSupported() && biometricEnabled()}>
          <div class="unlock-actions">
            <button class="icon-btn unlock-hello" title={t('unlock.biometric')} aria-label={t('unlock.biometricUnlock')}
              onClick={() => void doBiometricUnlock()} disabled={unlockBusy() || biometricBusy()}>
              <IconFingerprint size={20} />
            </button>
          </div>
        </Show>

        <div class={`unlock-status${status() === 'ok' ? ' ok' : status() === 'error' ? ' error' : ''}`}>
          <Show when={status() === 'ok'}>{t('unlock.success')}</Show>
          <Show when={status() === 'error'}>{errMsg()}</Show>
          <Show when={status() === 'idle'}>{unlockBusy() || biometricBusy() ? t('common.processing') : hint()}</Show>
        </div>
      </div>
    </div>
  );
}
