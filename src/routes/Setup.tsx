import { Show, createSignal, onMount } from 'solid-js';
import { IconShield } from '../components/Icon';
import { PinInput } from '../components/PinInput';
import { QrCode } from '../components/QrCode';
import { errorMessage, type ClientErrorCode } from '../lib/errors';
import { cancelDeviceTransfer, completeDeviceTransfer, inTauri, pendingDeviceTransfer, setupMasterPassword, startDeviceTransfer, unlockVault } from '../lib/ipc';
import { t } from '../lib/i18n';
import { notifyError } from '../lib/notify';
import { completeSetup } from '../lib/store';

type Step = 'welcome' | 'create' | 'join' | 'waiting' | 'done';

export default function Setup() {
  const [step, setStep] = createSignal<Step>('welcome');
  const [password, setPassword] = createSignal('');
  const [confirmation, setConfirmation] = createSignal('');
  const [serverUrl, setServerUrl] = createSignal('');
  const [deviceName, setDeviceName] = createSignal('');
  const [qr, setQr] = createSignal('');
  const [expiresAt, setExpiresAt] = createSignal(0);
  const [approved, setApproved] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');

  onMount(async () => {
    if (!inTauri) return;
    try {
      const transfer = await pendingDeviceTransfer();
      if (!transfer) return;
      setQr(transfer.qr);
      setExpiresAt(transfer.expires_at);
      setApproved(transfer.approved);
      setStep('waiting');
    } catch (cause) {
      fail(cause, 'operation_failed');
    }
  });

  const passwordStrength = () => password().length;

  const validPassword = () => /^\d{6}$/.test(password()) && password() === confirmation();

  async function createVault() {
    setBusy(true);
    setError('');
    try {
      await setupMasterPassword(password());
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
      const transfer = await startDeviceTransfer(url, name);
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
      await completeDeviceTransfer(password());
      await unlockVault(password());
      await completeSetup();
    } catch (cause) {
      fail(cause, 'transfer_pending');
    } finally {
      setBusy(false);
    }
  }

  async function cancelTransfer() {
    setBusy(true);
    try {
      await cancelDeviceTransfer();
      setPassword('');
      setQr('');
      setExpiresAt(0);
      setApproved(false);
      setStep('welcome');
    } catch (cause) {
      fail(cause, 'operation_failed');
    } finally {
      setBusy(false);
    }
  }

  function fail(cause: unknown, fallback: ClientErrorCode) {
    const message = errorMessage(cause, fallback);
    setError(message);
    notifyError(message);
  }

  return (
    <div class="setup-stage">
      <div class="setup-card">
        <Show when={step() === 'welcome'}>
          <div class="setup-brand"><div class="brand-name font-serif">{t('app.name')}</div><div class="brand-sub">{t('app.tagline')}</div></div>
          <div class="setup-actions">
            <button class="btn btn-primary setup-cta" onClick={() => setStep('create')}>{t('setup.createVault')}</button>
            <button class="btn btn-ghost setup-cta" onClick={() => setStep('join')}>{t('setup.joinVault')}</button>
          </div>
        </Show>

        <Show when={step() === 'create'}>
          <Heading title={t('setup.passwordTitle')} hint={t('setup.passwordHint')} />
          <div class="setup-form">
            <PinInput value={password()} ariaLabel={t('setup.passwordPlaceholder')} onInput={setPassword} autofocus />
            <PinInput value={confirmation()} ariaLabel={t('setup.passwordConfirmPlaceholder')} onInput={setConfirmation} />
            <div class="strength-bar">{[1, 2, 3, 4, 5, 6].map((level) => <div class={`strength-seg${passwordStrength() >= level ? ' filled' : ''}`} />)}</div>
            <Show when={confirmation() && password() !== confirmation()}><div class="setup-hint error">{t('setup.passwordMismatch')}</div></Show>
            <button class="btn btn-primary setup-cta" disabled={!validPassword() || busy()} onClick={createVault}>{busy() ? t('common.processing') : t('setup.continue')}</button>
          </div>
        </Show>

        <Show when={step() === 'join'}>
          <Heading title={t('setup.joinTitle')} hint={t('setup.joinHint')} />
          <div class="setup-form">
            <input class="fog-input" type="url" placeholder={t('settings.serverUrlPlaceholder')} value={serverUrl()} onInput={(event) => setServerUrl(event.currentTarget.value)} autofocus />
            <input class="fog-input" placeholder={t('settings.deviceName')} value={deviceName()} onInput={(event) => setDeviceName(event.currentTarget.value)} />
            <button class="btn btn-primary setup-cta" disabled={!serverUrl().trim() || !deviceName().trim() || busy()} onClick={startTransfer}>{busy() ? t('common.processing') : t('setup.createTransfer')}</button>
          </div>
        </Show>

        <Show when={step() === 'waiting'}>
          <Heading title={t('setup.scanTitle')} hint={t('setup.scanHint')} />
          <QrCode value={qr()} label={t('setup.scanTitle')} />
          <div class="setup-hint">
            {approved() ? t('setup.transferReady') : t('setup.expiresAt', { time: new Date(expiresAt()).toLocaleTimeString() })}
          </div>
          <div class="setup-form">
            <PinInput value={password()} ariaLabel={t('unlock.passwordPlaceholder')} onInput={setPassword} autofocus />
            <button class="btn btn-primary setup-cta" disabled={!password() || busy()} onClick={finishTransfer}>{busy() ? t('common.processing') : t('setup.completeTransfer')}</button>
            <button class="btn btn-ghost setup-cta" disabled={busy()} onClick={cancelTransfer}>{t('common.cancel')}</button>
          </div>
        </Show>

        <Show when={step() === 'done'}>
          <div class="setup-brand">
            <div class="setup-done-icon"><IconShield size={36} /></div>
            <div class="brand-name font-serif setup-title">{t('setup.readyTitle')}</div>
            <div class="brand-sub">{t('setup.readyHint')}</div>
          </div>
          <button class="btn btn-primary setup-cta" onClick={() => void completeSetup()}>{t('setup.enterVault')}</button>
        </Show>

        <Show when={error()}><div class="setup-hint error">{error()}</div></Show>
      </div>
    </div>
  );
}

function Heading(props: { title: string; hint: string }) {
  return <div class="setup-brand"><div class="brand-name font-serif setup-title">{props.title}</div><div class="brand-sub">{props.hint}</div></div>;
}
