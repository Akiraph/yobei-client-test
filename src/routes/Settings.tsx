import { createEffect, createSignal, For, lazy, onCleanup, onMount, Show, Suspense } from 'solid-js';
import { state, pairServer, refreshSyncStatus, runSync, setTheme, updateSettings } from '../lib/store';
import type { Theme } from '../lib/types';
import {
  biometricAvailable,
  approveDeviceTransfer,
  changeMasterPassword,
  disableBiometric,
  exportCsv,
  exportVault,
  getAppPrefs,
  importCsv,
  importVault,
  inTauri,
  isBiometricEnabled,
  listDevices,
  openTextFile,
  previewCsv,
  saveTextFile,
  revokeDevice,
  setAppPrefs,
  setupBiometric,
} from '../lib/ipc';
import type { AppPrefs, AuthorizedDevice, CsvPreview, RestoreSummary } from '../lib/ipc';
import { locale, locales, setLocale, t } from '../lib/i18n';
import { notifyError, notifyOk } from '../lib/notify';
import { showDialog, hideDialog } from '../lib/dialog';
import { IconBack } from '../components/Icon';
import { SettingLabel } from '../components/SettingLabel';
import { CustomSelect } from '../components/CustomSelect';
import ScanPage from '../components/ScanPage';
import { errorMessage } from '../lib/errors';
import { isDesktop } from '../lib/window';
import { getVersion } from '@tauri-apps/api/app';

const DesktopExtensionSection = __YOBEI_DESKTOP__
  ? lazy(() => import('./ExtensionSection'))
  : () => null;

interface Props {
  onClose?: () => void;
}

export default function Settings(props: Props) {
  const [section, setSection] = createSignal('appearance');
  const [version, setVersion] = createSignal('');
  const desktop = __YOBEI_DESKTOP__ && isDesktop();
  onMount(() => {
    if (inTauri) void getVersion().then(setVersion).catch(() => {});
  });
  const sections = () => [
    { id: 'appearance', label: t('settings.appearance') },
    { id: 'security', label: t('settings.security') },
    { id: 'sync', label: t('settings.sync') },
    ...(desktop ? [{ id: 'extension', label: t('settings.extension') }] : []),
    { id: 'data', label: t('settings.data') },
    { id: 'general', label: t('settings.general') },
    { id: 'about', label: t('settings.about') },
  ];

  return (
    <div class="settings-root fog-reveal">
      <div class="settings-layout">
        <aside class="settings-nav">
          <header class="settings-head">
            <Show when={props.onClose}>
              <button class="icon-btn settings-back" onClick={props.onClose} aria-label={t('settings.backToVault')}>
                <IconBack size={16} />
              </button>
            </Show>
            <h1 class="font-serif">{t('settings.title')}</h1>
          </header>
          <nav class="settings-nav-list">
            <For each={sections()}>
              {(item) => (
                <button
                  class={`settings-nav-item${section() === item.id ? ' active' : ''}`}
                  onClick={() => setSection(item.id)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </nav>
          <div class="settings-mobile-picker">
            <CustomSelect
              value={section}
              options={sections().map((item) => ({ v: item.id, label: item.label }))}
              onChange={(value) => setSection(String(value))}
              ariaLabel={t('settings.title')}
              class="settings-section-select"
            />
          </div>
        </aside>

        <main class="settings-content">
          <div class="settings-scroll">
            <Show when={section() === 'appearance'}>
              <section class="settings-section">
                <div class="settings-title">{t('settings.appearance')}</div>
                <div class="setting-row">
                  <SettingLabel name={t('settings.theme')} desc={t('settings.themeDesc')} />
                  <div class="segmented">
                    <ThemeButton value="light" label={t('settings.light')} />
                    <ThemeButton value="dark" label={t('settings.dark')} />
                    <ThemeButton value="system" label={t('settings.system')} />
                  </div>
                </div>
              </section>
            </Show>

            <Show when={section() === 'security'}>
              <section class="settings-section">
                <div class="settings-title">{t('settings.security')}</div>
                <ChangePassword />
                <SettingSelect
                  name={t('settings.autoLock')}
                  desc={t('settings.autoLockDesc')}
                  value={() => state.settings.autoLockMin}
                  options={[0, 1, 5, 15, 30, 60].map((minutes) => ({
                    v: minutes,
                    label: minutes === 0 ? t('settings.never') : t('settings.minutes', { count: minutes }),
                  }))}
                  onChange={(value) => updateSettings({ autoLockMin: Number(value) })}
                />
                <SettingSelect
                  name={t('settings.clipboard')}
                  desc={t('settings.clipboardDesc')}
                  value={() => state.settings.clipboardSec}
                  options={[0, 10, 20, 60].map((seconds) => ({
                    v: seconds,
                    label: seconds === 0 ? t('settings.off') : t('settings.seconds', { count: seconds }),
                  }))}
                  onChange={(value) => updateSettings({ clipboardSec: Number(value) })}
                />
                <SettingSelect
                  name={t('settings.masterConfirm')}
                  desc={t('settings.masterConfirmDesc')}
                  value={() => state.settings.confirmDays}
                  options={[0, 14, 30].map((days) => ({
                    v: days,
                    label: days === 0 ? t('settings.off') : t('settings.days', { count: days }),
                  }))}
                  onChange={(value) => updateSettings({ confirmDays: Number(value) })}
                />
                <BiometricSection />
              </section>
            </Show>

            <Show when={section() === 'sync'}>
              <section class="settings-section">
                <div class="settings-title">{t('settings.sync')}</div>
                <SyncSection />
              </section>
            </Show>

            <Show when={desktop && section() === 'extension'}>
              <section class="settings-section">
                <div class="settings-title">{t('settings.extension')}</div>
                <Suspense fallback={<div class="setting-note">{t('common.loading')}</div>}>
                  <DesktopExtensionSection />
                </Suspense>
              </section>
            </Show>

            <Show when={section() === 'data'}>
              <section class="settings-section">
                <div class="settings-title">{t('settings.data')}</div>
                <ImportSection />
                <ExportSection />
              </section>
            </Show>

            <Show when={section() === 'general'}>
              <section class="settings-section">
                <div class="settings-title">{t('settings.general')}</div>
                <SettingSelect
                  name={t('settings.language')}
                  desc={t('settings.languageDesc')}
                  value={() => locale()}
                  options={locales().map((item) => ({ v: item.value, label: item.label }))}
                  onChange={(value) => setLocale(String(value))}
                />
                <SettingSelect
                  name={t('settings.passwordLength')}
                  desc={t('settings.passwordLengthDesc')}
                  value={() => state.settings.defaultLen}
                  options={[12, 16, 20, 24, 32].map((length) => ({ v: length, label: String(length) }))}
                  onChange={(value) => updateSettings({ defaultLen: Number(value) })}
                />
                <Show when={desktop}>
                  <StartupSection />
                </Show>
              </section>
            </Show>

            <Show when={section() === 'about'}>
              <section class="settings-section">
                <div class="settings-title">{t('settings.about')}</div>
                <SettingRow name="Yobei" desc={t('settings.aboutDesc')} value={version() ? `v${version()}` : ''} />
              </section>
            </Show>
          </div>
        </main>
      </div>
    </div>
  );
}

function ThemeButton(props: { value: Theme; label: string }) {
  return (
    <button class={`seg-btn${state.theme === props.value ? ' active' : ''}`} onClick={() => setTheme(props.value)}>
      {props.label}
    </button>
  );
}

function SettingRow(props: { name: string; desc: string; value: string }) {
  return (
    <div class="setting-row">
      <SettingLabel name={props.name} desc={props.desc} />
      <div class="setting-value">{props.value}</div>
    </div>
  );
}

function SettingSelect(props: {
  name: string;
  desc: string;
  value: () => number | string;
  options: Array<{ v: number | string; label: string }>;
  onChange: (value: number | string) => void;
}) {
  return (
    <div class="setting-row">
      <SettingLabel name={props.name} desc={props.desc} />
      <CustomSelect value={props.value} options={props.options} onChange={props.onChange} class="setting-select" ariaLabel={props.name} />
    </div>
  );
}

function StartupSection() {
  const [prefs, setPrefs] = createSignal<AppPrefs | null>(null);

  onMount(() => {
    let active = true;
    onCleanup(() => { active = false; });
    getAppPrefs().then((value) => { if (active) setPrefs(value); }).catch(() => {});
  });

  async function update(patch: Partial<AppPrefs>) {
    try {
      setPrefs(await setAppPrefs(patch));
    } catch (error) {
      notifyError(errorMessage(error));
    }
  }

  const onOff = () => [
    { v: 'on', label: t('settings.on') },
    { v: 'off', label: t('settings.off') },
  ];

  return (
    <>
      <SettingSelect
        name={t('settings.autostart')}
        desc={t('settings.autostartDesc')}
        value={() => (prefs()?.autostart ? 'on' : 'off')}
        options={onOff()}
        onChange={(value) => void update({ autostart: value === 'on' })}
      />
      <SettingSelect
        name={t('settings.silentStart')}
        desc={t('settings.silentStartDesc')}
        value={() => (prefs()?.silentStart ? 'on' : 'off')}
        options={onOff()}
        onChange={(value) => void update({ silentStart: value === 'on' })}
      />
    </>
  );
}

function ChangePassword() {
  const [open, setOpen] = createSignal(false);
  const [oldPassword, setOldPassword] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [confirmation, setConfirmation] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  async function submit() {
    if (!oldPassword()) { notifyError(t('settings.oldPasswordRequired')); return; }
    if (!/^\d{6}$/.test(newPassword())) { notifyError(t('settings.newPasswordMin')); return; }
    if (newPassword() !== confirmation()) { notifyError(t('settings.passwordMismatch')); return; }
    setBusy(true);
    try {
      await changeMasterPassword(oldPassword(), newPassword());
      setOpen(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmation('');
      notifyOk(t('settings.passwordChanged'));
    } catch (error) {
      notifyError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="setting-row setting-row-stack">
      <SettingLabel name={t('settings.changePassword')} desc={t('settings.changePasswordDesc')} />
      <div class="setting-control">
        <button class="btn btn-ghost" onClick={() => setOpen(!open())}>
          {open() ? t('common.cancel') : t('settings.change')}
        </button>
      </div>
      <Show when={open()}>
        <div class="setting-inline">
          <input class="fog-input" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autocomplete="off" placeholder={t('settings.oldPassword')} value={oldPassword()} onInput={(event) => setOldPassword(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))} />
          <input class="fog-input" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autocomplete="off" placeholder={t('settings.newPassword')} value={newPassword()} onInput={(event) => setNewPassword(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))} />
          <input class="fog-input" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autocomplete="off" placeholder={t('settings.confirmPassword')} value={confirmation()} onInput={(event) => setConfirmation(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(event) => event.key === 'Enter' && submit()} />
          <button class="btn btn-primary" onClick={submit} disabled={busy()}>
            {busy() ? t('common.updating') : t('settings.confirmChange')}
          </button>
        </div>
      </Show>
    </div>
  );
}

function BiometricSection() {
  const [supported, setSupported] = createSignal(false);
  const [probed, setProbed] = createSignal(false);
  const [enabled, setEnabled] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [password, setPassword] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    let active = true;
    onCleanup(() => { active = false; });
    biometricAvailable()
      .then((value) => { if (active) { setSupported(value); setProbed(true); } })
      .catch(() => { if (active) setProbed(true); });
    isBiometricEnabled().then((value) => { if (active) setEnabled(value); }).catch(() => {});
  });

  async function enable() {
    if (!password()) { notifyError(t('settings.passwordRequired')); return; }
    setBusy(true);
    try {
      await setupBiometric(password());
      setEnabled(true);
      setOpen(false);
      setPassword('');
      notifyOk(t('settings.biometricEnabled'));
    } catch (error) {
      notifyError(errorMessage(error, 'biometric_unavailable'));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await disableBiometric();
      setEnabled(false);
      notifyOk(t('settings.biometricDisabled'));
    } catch (error) {
      notifyError(errorMessage(error, 'biometric_unavailable'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="setting-row setting-row-stack">
      <SettingLabel name={t('settings.biometric')} desc={t('settings.biometricDesc')} />
      <div class="setting-control">
        <Show when={!probed()}>
          <span class="setting-value">{t('settings.detecting')}</span>
        </Show>
        <Show when={probed() && !supported()}>
          <span class="setting-value">{t('settings.unsupported')}</span>
        </Show>
        <Show when={probed() && supported()}>
          <Show when={!enabled()} fallback={
            <button class="btn btn-ghost" onClick={disable} disabled={busy()}>{t('settings.disable')}</button>
          }>
            <button class="btn btn-ghost" onClick={() => setOpen(!open())}>
              {open() ? t('common.cancel') : t('settings.enable')}
            </button>
          </Show>
        </Show>
      </div>
      <Show when={open() && supported() && !enabled()}>
        <div class="setting-inline">
          <input class="fog-input setting-restore-pw" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={6} autocomplete="off" placeholder={t('settings.passwordRequired')} value={password()} onInput={(event) => setPassword(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))} onKeyDown={(event) => event.key === 'Enter' && enable()} />
          <button class="btn btn-primary" onClick={enable} disabled={busy()}>{busy() ? t('common.processing') : t('settings.confirmEnable')}</button>
        </div>
        <div class="setting-note">{t('settings.biometricNote')}</div>
      </Show>
    </div>
  );
}

function SyncSection() {
  const [url, setUrl] = createSignal('');
  const [code, setCode] = createSignal('');
  const [name, setName] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [scanning, setScanning] = createSignal(false);
  const [devices, setDevices] = createSignal<AuthorizedDevice[]>([]);
  let active = true;

  onCleanup(() => { active = false; });

  onMount(() => {
    void refreshSyncStatus();
  });

  createEffect(() => {
    if (state.sync.configured) void refreshDevices();
  });

  async function refreshDevices() {
    try {
      const nextDevices = await listDevices();
      if (active) setDevices(nextDevices);
    } catch (error) {
      notifyError(errorMessage(error, 'sync_failed'));
    }
  }

  async function approveTransfer(qr: string) {
    setScanning(false);
    setBusy(true);
    try {
      await approveDeviceTransfer(qr);
      await refreshDevices();
      notifyOk(t('settings.deviceApproved'));
    } catch (error) {
      notifyError(errorMessage(error, 'pair_rejected'));
    } finally {
      setBusy(false);
    }
  }

  function confirmRevoke(device: AuthorizedDevice) {
    showDialog(t('settings.revokeDevice'), <>
      <p class="dialog-desc">{t('settings.revokeDeviceWarning', { name: device.name })}</p>
      <div class="dialog-actions">
        <button class="btn btn-ghost" onClick={hideDialog}>{t('common.cancel')}</button>
        <button class="btn btn-danger" onClick={() => { hideDialog(); void removeDevice(device.id); }}>{t('settings.revokeDevice')}</button>
      </div>
    </>);
  }

  async function removeDevice(deviceId: string) {
    try {
      await revokeDevice(deviceId);
      setDevices((current) => current.filter((device) => device.id !== deviceId));
      notifyOk(t('settings.deviceRevoked'));
    } catch (error) {
      notifyError(errorMessage(error, 'sync_failed'));
    }
  }

  async function pair() {
    const serverUrl = url().trim().replace(/\/+$/, '');
    if (!serverUrl) { notifyError(t('settings.enterServerUrl')); return; }
    if (!code().trim()) { notifyError(t('settings.enterSetupCode')); return; }
    setBusy(true);
    try {
      await pairServer(serverUrl, code().trim(), name().trim() || t('settings.defaultDevice'));
      setUrl('');
      setCode('');
      notifyOk(t('settings.pairSuccess'));
    } catch (error) {
      notifyError(errorMessage(error, 'pair_rejected'));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    try {
      const ok = await runSync();
      notify(ok, ok ? t('settings.syncSuccess') : t('error.syncFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Show when={state.sync.configured} fallback={
      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.cloudSync')} desc={t('settings.syncDesc')} />
        <div class="setting-inline">
          <input class="fog-input" type="url" placeholder={t('settings.serverUrlPlaceholder')} value={url()} onInput={(event) => setUrl(event.currentTarget.value)} aria-label={t('settings.serverUrl')} />
          <input class="fog-input" type="text" placeholder={t('settings.setupCode')} value={code()} onInput={(event) => setCode(event.currentTarget.value)} aria-label={t('settings.setupCode')} />
        </div>
        <div class="setting-inline">
          <input class="fog-input" placeholder={t('settings.deviceName')} value={name()} onInput={(event) => setName(event.currentTarget.value)} aria-label={t('settings.deviceName')} onKeyDown={(event) => event.key === 'Enter' && pair()} />
          <button class="btn btn-primary" onClick={pair} disabled={busy()}>{busy() ? t('settings.pairing') : t('settings.pair')}</button>
        </div>
      </div>
    }>
      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.cloudSync')} desc={state.sync.serverUrl ?? ''} />
        <div class="setting-control">
          <button class="btn btn-ghost" onClick={sync} disabled={busy() || state.sync.syncing}>{state.sync.syncing ? t('settings.syncing') : t('settings.syncNow')}</button>
        </div>
      </div>
      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.addDevice')} desc={t('settings.addDeviceDesc')} />
        <div class="setting-control">
          <button class="btn btn-ghost" onClick={() => setScanning(!scanning())} disabled={busy()}>
            {scanning() ? t('common.cancel') : t('settings.scanDevice')}
          </button>
        </div>
        <Show when={scanning()}>
          <ScanPage
            label={t('settings.scanDevice')}
            onClose={() => setScanning(false)}
            onResult={approveTransfer}
          />
        </Show>
      </div>
      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.devices')} desc={t('settings.devicesDesc')} />
        <div class="device-list">
          <For each={devices()}>{(device) => (
            <div class="device-row">
              <div>
                <div class="setting-value">{device.name}</div>
                <div class="setting-note">{device.id === state.sync.deviceId ? t('settings.currentDevice') : new Date(device.last_seen_at ?? device.created_at).toLocaleString()}</div>
              </div>
              <Show when={device.id !== state.sync.deviceId}>
                <button class="btn btn-ghost" onClick={() => confirmRevoke(device)}>{t('settings.revokeDevice')}</button>
              </Show>
            </div>
          )}</For>
        </div>
      </div>
    </Show>
  );
}

function ImportSection() {
  const [csv, setCsv] = createSignal<CsvPreview | null>(null);
  const [csvContent, setCsvContent] = createSignal('');
  const [csvBusy, setCsvBusy] = createSignal(false);
  const [restorePassword, setRestorePassword] = createSignal('');
  const [restoreResult, setRestoreResult] = createSignal<RestoreSummary | null>(null);
  const [restoreBusy, setRestoreBusy] = createSignal(false);

  async function chooseCsv() {
    setCsv(null);
    try {
      const content = await openTextFile();
      if (content == null) return;
      setCsvContent(content);
      setCsv(await previewCsv(content));
    } catch (error) {
      notifyError(errorMessage(error, 'file_failed'));
    }
  }

  async function importPreviewedCsv() {
    if (!csvContent()) return;
    setCsvBusy(true);
    try {
      const result = await importCsv(csvContent());
      notifyOk(t('settings.importSuccess', { imported: result.imported, skipped: result.skipped, errors: result.errors }));
      setCsv(null);
      setCsvContent('');
    } catch (error) {
      notifyError(errorMessage(error, 'file_failed'));
    } finally {
      setCsvBusy(false);
    }
  }

  async function chooseVault() {
    if (!restorePassword()) { notifyError(t('settings.passwordRequired')); return; }
    setRestoreBusy(true);
    try {
      const content = await openTextFile();
      if (content == null) return;
      const result = await importVault(content, restorePassword());
      setRestoreResult(result);
      notifyOk(t('settings.restoreSuccess', { items: result.items }));
    } catch (error) {
      notifyError(errorMessage(error, 'file_failed'));
    } finally {
      setRestoreBusy(false);
    }
  }

  return (
    <>
      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.importCsv')} desc={t('settings.importDescription')} />
        <div class="setting-control"><button class="btn btn-ghost" onClick={chooseCsv}>{t('settings.chooseFile')}</button></div>
        <Show when={csv()}>
          <div class="setting-panel">
            <div class="setting-note">{t('settings.importPreview', { format: csv()!.format, rows: csv()!.rows, sample: csv()!.sample.length })}</div>
            <table class="csv-preview">
              <thead><tr><th>{t('editor.title')}</th><th>{t('editor.username')}</th><th>{t('editor.url')}</th><th>{t('editor.password')}</th><th>{t('editor.totp')}</th><th>{t('editor.recoveryCodes')}</th><th>{t('editor.passkeys')}</th></tr></thead>
              <tbody>
                <For each={csv()!.sample}>
                  {(row) => <tr><td>{row.title || '—'}</td><td>{row.username || '—'}</td><td>{row.url || '—'}</td><td>{row.hasPassword ? '✓' : '—'}</td><td>{row.hasTotp ? '✓' : '—'}</td><td>{row.hasRecoveryCodes ? '✓' : '—'}</td><td>{row.hasPasskeys ? '✓' : '—'}</td></tr>}
                </For>
              </tbody>
            </table>
            <div class="setting-inline">
              <button class="btn btn-primary" onClick={importPreviewedCsv} disabled={csvBusy()}>{csvBusy() ? t('settings.importing') : t('settings.confirmImport')}</button>
              <button class="btn btn-ghost" onClick={() => setCsv(null)}>{t('common.cancel')}</button>
            </div>
          </div>
        </Show>
      </div>

      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.restoreTitle')} desc={t('settings.restoreDescription')} />
        <div class="setting-control">
          <input class="fog-input setting-restore-pw" type="password" placeholder={t('settings.restorePassword')} value={restorePassword()} onInput={(event) => setRestorePassword(event.currentTarget.value)} />
          <button class="btn btn-ghost" onClick={chooseVault} disabled={restoreBusy()}>{restoreBusy() ? t('settings.restoring') : t('settings.restoreChoose')}</button>
        </div>
        <Show when={restoreResult()}><div class="setting-note">{t('settings.restoreSuccess', { items: restoreResult()!.items })}</div></Show>
      </div>
    </>
  );
}

function ExportSection() {
  const [busy, setBusy] = createSignal(false);

  function exportEncrypted() {
    return saveExport(exportVault, 'yobei-vault.yobei');
  }

  function confirmPlaintextExport() {
    showDialog(
      t('settings.exportPlainTitle'),
      <>
        <p class="dialog-desc">{t('settings.plaintextWarning')}</p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" onClick={hideDialog}>{t('common.cancel')}</button>
          <button class="btn btn-danger" onClick={() => { hideDialog(); void exportPlaintext(); }}>{t('settings.continueExport')}</button>
        </div>
      </>,
    );
  }

  function exportPlaintext() {
    return saveExport(exportCsv, 'yobei-export.csv', true);
  }

  async function saveExport(load: () => Promise<string>, fileName: string, trackBusy = false) {
    if (trackBusy) setBusy(true);
    try {
      const path = await saveTextFile(fileName, await load());
      if (path != null) notifyOk(t('common.done'));
    } catch (error) {
      notifyError(errorMessage(error, 'file_failed'));
    } finally {
      if (trackBusy) setBusy(false);
    }
  }

  return (
    <>
      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.exportTitle')} desc={t('settings.exportDescription')} />
        <div class="setting-control"><button class="btn btn-ghost" onClick={exportEncrypted}>{t('common.export')}</button></div>
      </div>
      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.exportPlainTitle')} desc={t('settings.exportPlainDescription')} />
        <div class="setting-control"><button class="btn btn-ghost" onClick={confirmPlaintextExport} disabled={busy()}>{t('common.export')}</button></div>
      </div>
    </>
  );
}

function notify(success: boolean, message: string) {
  if (success) notifyOk(message);
  else notifyError(message);
}
