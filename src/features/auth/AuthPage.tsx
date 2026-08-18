import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { backend } from '../../core/backend';
import { errorKey, type ErrorCode } from '../../core/errors';
import { t } from '../../core/locale';
import { actions } from '../../core/state';
import { isDesktop } from '../../core/window';
import { IconFingerprint, IconShield } from '../../ui/icons';
import { notify } from '../../ui/notifications';
import PinInput from '../../ui/pin-input';
import QrCode from '../../ui/qr-code';

type SetupStep = 'welcome' | 'create' | 'confirm' | 'join' | 'waiting' | 'done';

export default function AuthPage(props: { mode: 'setup' | 'locked' }) {
  return props.mode === 'setup' ? <Setup /> : <Unlock />;
}

function Setup() {
  const [step, setStep] = createSignal<SetupStep>('welcome');
  const [password, setPassword] = createSignal('');
  const [confirmation, setConfirmation] = createSignal('');
  const [serverUrl, setServerUrl] = createSignal('');
  const [deviceName, setDeviceName] = createSignal('');
  const [qr, setQr] = createSignal('');
  const [expiresAt, setExpiresAt] = createSignal(0);
  const [approved, setApproved] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  onMount(() => {
    let active = true;
    void backend.pendingDeviceTransfer()
      .then((transfer) => {
        if (!active || !transfer) return;
        setQr(transfer.qr);
        setExpiresAt(transfer.expires_at);
        setApproved(transfer.approved);
        setStep('waiting');
      })
      .catch(() => {});
    onCleanup(() => { active = false; });
  });

  const validPassword = () => /^\d{6}$/.test(password()) && password() === confirmation();

  function fail(cause: unknown, fallback: ErrorCode): void {
    const message = t(errorKey(cause, fallback));
    setError(message);
    notify.error(message);
  }

  async function createVault() {
    if (!validPassword()) return;
    setBusy(true);
    setError('');
    try {
      await actions.setup(password());
      setStep('done');
    } catch (cause) {
      fail(cause, 'not_initialized');
    } finally {
      setBusy(false);
    }
  }

  async function startTransfer() {
    const url = serverUrl().trim().replace(/\/+$/, '');
    const name = deviceName().trim();
    if (!url || !name) return;
    setBusy(true);
    setError('');
    try {
      const transfer = await backend.startDeviceTransfer(url, name);
      setQr(transfer.qr);
      setExpiresAt(transfer.expires_at);
      setApproved(transfer.approved);
      setStep('waiting');
    } catch (cause) {
      fail(cause, 'network_failed');
    } finally {
      setBusy(false);
    }
  }

  async function finishTransfer() {
    if (!password()) return;
    setBusy(true);
    setError('');
    try {
      await backend.completeDeviceTransfer(password());
      await backend.unlockVault(password());
      await actions.unlockReady();
    } catch (cause) {
      fail(cause, 'transfer_pending');
    } finally {
      setBusy(false);
    }
  }

  async function cancelTransfer() {
    setBusy(true);
    try {
      await backend.cancelDeviceTransfer();
      setPassword('');
      setQr('');
      setStep('welcome');
    } catch (cause) {
      fail(cause, 'operation_failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="setup-stage">
      <div class="setup-card">
        <Show when={step() === 'welcome'}>
          <div class="setup-brand">
            <div class="brand-name font-serif">{t('app.name')}</div>
            <div class="brand-sub">{t('app.tagline')}</div>
          </div>
          <div class="setup-actions">
            <button class="btn btn-primary setup-cta" onClick={() => setStep('create')}>{t('setup.createVault')}</button>
            <button class="btn btn-ghost setup-cta" onClick={() => setStep('join')}>{t('setup.joinVault')}</button>
          </div>
        </Show>

        <Show when={step() === 'create'}>
          <Heading title={t('setup.passwordTitle')} hint={t('setup.passwordHint')} />
          <div class="setup-form">
            <PinInput value={password()} onInput={setPassword} autofocus ariaLabel={t('setup.passwordPlaceholder')} onComplete={() => setStep('confirm')} />
            <button class="btn btn-primary setup-cta" disabled={!/^\d{6}$/.test(password())} onClick={() => setStep('confirm')}>{t('setup.continue')}</button>
          </div>
        </Show>

        <Show when={step() === 'confirm'}>
          <Heading title={t('setup.confirmTitle')} hint={t('setup.confirmHint')} />
          <div class="setup-form">
            <PinInput value={confirmation()} onInput={setConfirmation} autofocus ariaLabel={t('setup.passwordConfirmPlaceholder')} onComplete={() => void createVault()} />
            <Show when={confirmation() && password() !== confirmation()}><div class="setup-hint error">{t('setup.passwordMismatch')}</div></Show>
            <button class="btn btn-primary setup-cta" disabled={!validPassword() || busy()} onClick={() => void createVault()}>{busy() ? t('common.processing') : t('setup.createVault')}</button>
            <button class="btn btn-ghost setup-cta" onClick={() => { setConfirmation(''); setStep('create'); }}>{t('common.back')}</button>
          </div>
        </Show>

        <Show when={step() === 'join'}>
          <Heading title={t('setup.joinTitle')} hint={t('setup.joinHint')} />
          <div class="setup-form">
            <input class="fog-input" type="url" value={serverUrl()} onInput={(event) => setServerUrl(event.currentTarget.value)} placeholder={t('settings.serverUrlPlaceholder')} />
            <input class="fog-input" value={deviceName()} onInput={(event) => setDeviceName(event.currentTarget.value)} placeholder={t('settings.deviceName')} />
            <button class="btn btn-primary setup-cta" disabled={!serverUrl().trim() || !deviceName().trim() || busy()} onClick={() => void startTransfer()}>{busy() ? t('common.processing') : t('setup.createTransfer')}</button>
          </div>
        </Show>

        <Show when={step() === 'waiting'}>
          <Heading title={t('setup.scanTitle')} hint={t('setup.scanHint')} />
          <QrCode value={qr()} label={t('setup.scanTitle')} />
          <div class="setup-hint">{approved() ? t('setup.transferReady') : t('setup.expiresAt', { time: new Date(expiresAt()).toLocaleTimeString() })}</div>
          <div class="setup-form">
            <PinInput value={password()} onInput={setPassword} autofocus ariaLabel={t('unlock.passwordPlaceholder')} />
            <button class="btn btn-primary setup-cta" disabled={!password() || busy()} onClick={() => void finishTransfer()}>{busy() ? t('common.processing') : t('setup.completeTransfer')}</button>
            <button class="btn btn-ghost setup-cta" disabled={busy()} onClick={() => void cancelTransfer()}>{t('common.cancel')}</button>
          </div>
        </Show>

        <Show when={step() === 'done'}>
          <div class="setup-brand">
            <div class="setup-done-icon"><IconShield size={36} /></div>
            <div class="brand-name font-serif setup-title">{t('setup.readyTitle')}</div>
            <div class="brand-sub">{t('setup.readyHint')}</div>
          </div>
          <button class="btn btn-primary setup-cta" onClick={() => void actions.unlockReady()}>{t('setup.enterVault')}</button>
        </Show>

        <Show when={error()}><div class="setup-hint error">{error()}</div></Show>
      </div>
    </div>
  );
}

function Heading(props: { title: string; hint: string }) {
  return <div class="setup-brand"><div class="brand-name font-serif setup-title">{props.title}</div><div class="brand-sub">{props.hint}</div></div>;
}

function Unlock() {
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [biometric, setBiometric] = createSignal(false);
  const [focusPin, setFocusPin] = createSignal(false);

  onMount(() => {
    void backend.isBiometricEnabled()
      .then((enabled) => { setBiometric(enabled); setFocusPin(!enabled || !isDesktop()); })
      .catch(() => setFocusPin(true));
  });

  async function unlock() {
    if (!/^\d{6}$/.test(password()) || busy()) {
      setError(t('unlock.passwordRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await actions.unlock(password());
    } catch (cause) {
      const message = t(errorKey(cause, 'invalid_password'));
      setError(message);
      notify.error(message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  async function unlockWithBiometric() {
    setBusy(true);
    setError('');
    try {
      await actions.unlockBiometric(t('unlock.biometricUnlock'));
    } catch {
      setFocusPin(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="unlock-stage">
      <div class="unlock-visual"><span class="unlock-content">{t('app.name')}</span></div>
      <div class="unlock-form">
        <PinInput value={password()} onInput={(value) => { setPassword(value); setError(''); }} onComplete={() => void unlock()} autofocus={focusPin()} disabled={busy()} ariaLabel={t('unlock.passwordPlaceholder')} />
        <Show when={biometric()}>
          <div class="unlock-actions"><button class="icon-btn unlock-hello" onClick={() => void unlockWithBiometric()} disabled={busy()} aria-label={t('unlock.biometricUnlock')}><IconFingerprint size={20} /></button></div>
        </Show>
        <div class={`unlock-status${error() ? ' error' : ''}`}>{error() || (busy() ? t('common.processing') : biometric() ? t('unlock.biometricHint') : t('unlock.hint'))}</div>
      </div>
    </div>
  );
}
