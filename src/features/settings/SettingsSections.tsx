import { For, Show, createSignal, onMount } from 'solid-js';
import type { JSX } from 'solid-js';
import {
  backend,
  type AppPrefs,
  type AuthorizedDevice,
  type BrowserInfo,
  type CsvPreview,
  type PairingStatus,
} from '../../core/backend';
import { errorKey } from '../../core/errors';
import { hideDialog, showDialog } from '../../core/dialog';
import { locale, locales, setLocale, t } from '../../core/locale';
import { scanner } from '../../core/scan';
import { actions, state } from '../../core/state';
import type { Theme } from '../../core/types';
import { decodeQrImage } from '../../core/qr';
import CopyButton from '../../ui/copy-button';
import { IconMonitor, IconMoon, IconPlus, IconScan, IconSun, IconUpload } from '../../ui/icons';
import { notify } from '../../ui/notifications';
import Select from '../../ui/select';

export function GeneralSection() {
  const desktop = __YOBEI_DESKTOP__;
  const [prefs, setPrefs] = createSignal<AppPrefs>({ autostart: false, silentStart: false });
  const [loaded, setLoaded] = createSignal(!desktop);

  onMount(() => {
    if (!desktop) return;
    void backend.getAppPrefs()
      .then((value) => {
        setPrefs(value);
        setLoaded(true);
      })
      .catch((error) => {
        setLoaded(true);
        notify.error(t(errorKey(error, 'operation_failed')));
      });
  });

  async function update(patch: Partial<AppPrefs>) {
    try {
      setPrefs(await backend.setAppPrefs(patch));
    } catch (error) {
      notify.error(t(errorKey(error, 'operation_failed')));
    }
  }

  return (
    <Section title={t('settings.general')}>
      <SettingRow name={t('settings.theme')} desc={t('settings.themeDesc')}>
        <div class="segmented" role="group" aria-label={t('settings.theme')}>
          <ThemeButton value="light" label={t('settings.light')} icon={<IconSun size={17} />} />
          <ThemeButton value="dark" label={t('settings.dark')} icon={<IconMoon size={17} />} />
          <ThemeButton value="system" label={t('settings.system')} icon={<IconMonitor size={17} />} />
        </div>
      </SettingRow>
      <SelectRow
        name={t('settings.language')}
        desc={t('settings.languageDesc')}
        value={locale()}
        options={locales().map((item) => ({ value: item.value, label: item.label }))}
        onChange={setLocale}
      />
      <Show when={desktop}>
        <Show when={loaded()} fallback={<div class="setting-note">{t('common.loading')}</div>}>
          <ToggleRow
            name={t('settings.autostart')}
            desc={t('settings.autostartDesc')}
            value={prefs().autostart}
            onChange={(value) => void update({ autostart: value })}
          />
          <ToggleRow
            name={t('settings.silentStart')}
            desc={t('settings.silentStartDesc')}
            value={prefs().silentStart}
            onChange={(value) => void update({ silentStart: value })}
          />
        </Show>
      </Show>
    </Section>
  );
}

export function SecuritySection() {
  onMount(() => void actions.refreshSecurity());

  return (
    <Section title={t('settings.security')}>
      <ChangePassword />
      <SecuritySelect
        name={t('settings.autoLock')}
        desc={t('settings.autoLockDesc')}
        value={state.settings.autoLockMin}
        options={[0, 1, 5, 15, 30, 60].map((minutes) => ({
          value: minutes,
          label: minutes === 0 ? t('settings.never') : t('settings.minutes', { count: minutes }),
        }))}
        onChange={(value) => void saveSecurity({ autoLockMin: value })}
      />
      <SecuritySelect
        name={t('settings.clipboard')}
        desc={t('settings.clipboardDesc')}
        value={state.settings.clipboardSec}
        options={[0, 10, 20, 60].map((seconds) => ({
          value: seconds,
          label: seconds === 0 ? t('settings.off') : t('settings.seconds', { count: seconds }),
        }))}
        onChange={(value) => void saveSecurity({ clipboardSec: value })}
      />
      <SecuritySelect
        name={t('settings.masterConfirm')}
        desc={t('settings.masterConfirmDesc')}
        value={state.settings.confirmDays}
        options={[0, 14, 30].map((days) => ({
          value: days,
          label: days === 0 ? t('settings.off') : t('settings.days', { count: days }),
        }))}
        onChange={(value) => void saveSecurity({ confirmDays: value })}
      />
      <Biometric />
    </Section>
  );
}

export function SyncSection() {
  const [serverUrl, setServerUrl] = createSignal('');
  const [setupCode, setSetupCode] = createSignal('');
  const [deviceName, setDeviceName] = createSignal('');
  const [devices, setDevices] = createSignal<AuthorizedDevice[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [addMenuOpen, setAddMenuOpen] = createSignal(false);

  onMount(() => {
    void initialize();
  });

  async function initialize() {
    await actions.refreshSync();
    if (state.sync.configured) await refreshDevices();
  }

  async function refreshDevices() {
    try {
      setDevices(await backend.listDevices());
    } catch (error) {
      notify.error(t(errorKey(error, 'sync_failed')));
    }
  }

  async function pair() {
    const url = serverUrl().trim().replace(/\/+$/, '');
    const code = setupCode().trim();
    if (!url) {
      notify.error(t('settings.enterServerUrl'));
      return;
    }
    if (!code) {
      notify.error(t('settings.enterSetupCode'));
      return;
    }

    setBusy(true);
    try {
      await backend.pairDevice(url, code, deviceName().trim() || t('settings.defaultDevice'));
      await actions.refreshSync();
      await refreshDevices();
      setServerUrl('');
      setSetupCode('');
      notify.ok(t('settings.pairSuccess'));
    } catch (error) {
      notify.error(t(errorKey(error, 'pair_rejected')));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    const success = await actions.sync();
    setBusy(false);
    notify[success ? 'ok' : 'error'](t(success ? 'settings.syncSuccess' : 'error.syncFailed'));
  }

  async function approveTransfer(qr: string) {
    const value = qr.trim();
    if (!value || busy()) return;

    setBusy(true);
    try {
      await backend.approveDeviceTransfer(value);
      await refreshDevices();
      notify.ok(t('settings.deviceApproved'));
    } catch (error) {
      notify.error(t(errorKey(error, 'pair_rejected')));
    } finally {
      setBusy(false);
    }
  }

  function scanTransferCode() {
    scanner.open({ onResult: (value) => approveTransfer(value) });
  }

  async function readTransferImage(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      await approveTransfer(await decodeQrImage(file));
    } catch (error) {
      notify.error(t(errorKey(error, 'invalid_qr')));
    }
  }

  function confirmRevoke(device: AuthorizedDevice) {
    showDialog(
      t('settings.revokeDevice'),
      <>
        <p class="dialog-desc">{t('settings.revokeDeviceWarning', { name: device.name })}</p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" onClick={hideDialog}>{t('common.cancel')}</button>
          <button class="btn btn-danger" onClick={() => { hideDialog(); void revoke(device.id); }}>
            {t('settings.revokeDevice')}
          </button>
        </div>
      </>,
    );
  }

  async function revoke(deviceId: string) {
    try {
      await backend.revokeDevice(deviceId);
      setDevices((current) => current.filter((device) => device.id !== deviceId));
      notify.ok(t('settings.deviceRevoked'));
    } catch (error) {
      notify.error(t(errorKey(error, 'sync_failed')));
    }
  }

  return (
    <Section title={t('settings.sync')}>
      <Show
        when={state.sync.configured}
        fallback={
          <div class="setting-row setting-row-stack">
            <SettingLabel name={t('settings.cloudSync')} desc={t('settings.syncDesc')} />
            <div class="setting-inline">
              <input
                class="fog-input"
                type="url"
                value={serverUrl()}
                onInput={(event) => setServerUrl(event.currentTarget.value)}
                placeholder={t('settings.serverUrlPlaceholder')}
                aria-label={t('settings.serverUrl')}
              />
              <input
                class="fog-input"
                value={setupCode()}
                onInput={(event) => setSetupCode(event.currentTarget.value)}
                placeholder={t('settings.setupCode')}
                aria-label={t('settings.setupCode')}
              />
            </div>
            <div class="setting-inline">
              <input
                class="fog-input"
                value={deviceName()}
                onInput={(event) => setDeviceName(event.currentTarget.value)}
                placeholder={t('settings.deviceName')}
                aria-label={t('settings.deviceName')}
              />
              <button class="btn btn-primary" onClick={() => void pair()} disabled={busy()}>
                {busy() ? t('settings.pairing') : t('settings.pair')}
              </button>
            </div>
          </div>
        }
      >
        <SettingRow name={t('settings.cloudSync')} desc={state.sync.serverUrl ?? ''}>
          <button class="btn btn-ghost" onClick={() => void sync()} disabled={busy() || state.sync.syncing}>
            {state.sync.syncing ? t('settings.syncing') : t('settings.syncNow')}
          </button>
        </SettingRow>
        <SettingRow name={t('settings.addDevice')} desc={t('settings.addDeviceDesc')}>
          <div class="add-device-menu">
            <button
              class="icon-btn add-device-trigger"
              type="button"
              aria-label={t('settings.addDevice')}
              aria-haspopup="menu"
              aria-expanded={addMenuOpen()}
              disabled={busy()}
              onClick={() => setAddMenuOpen((open) => !open)}
            >
              <IconPlus size={18} />
            </button>
            <Show when={addMenuOpen()}>
              <div class="add-device-options" role="menu">
                <label class="add-device-option" role="menuitem">
                  <IconUpload size={14} />
                  {t('qr.uploadImage')}
                  <input class="qr-file-input" type="file" accept="image/*" onChange={(event) => { setAddMenuOpen(false); void readTransferImage(event); }} />
                </label>
                <button class="add-device-option" type="button" role="menuitem" onClick={() => { setAddMenuOpen(false); scanTransferCode(); }}>
                  <IconScan size={14} />
                  {t('settings.scanToAdd')}
                </button>
              </div>
            </Show>
          </div>
        </SettingRow>
        <div class="setting-row setting-row-stack">
          <SettingLabel name={t('settings.devices')} desc={t('settings.devicesDesc')} />
          <div class="device-list">
            <For each={devices()} fallback={<div class="setting-note">{t('common.unknown')}</div>}>
              {(device) => (
                <div class="device-row">
                  <div>
                    <div class="setting-value">{device.name}</div>
                    <div class="setting-note">
                      {device.id === state.sync.deviceId
                        ? t('settings.currentDevice')
                        : new Date(device.last_seen_at ?? device.created_at).toLocaleString()}
                    </div>
                  </div>
                  <Show when={device.id !== state.sync.deviceId}>
                    <button class="btn btn-ghost" onClick={() => confirmRevoke(device)}>
                      {t('settings.revokeDevice')}
                    </button>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>
    </Section>
  );
}

export function ExtensionSection() {
  const [pairing, setPairing] = createSignal<PairingStatus | null>(null);
  const [browsers, setBrowsers] = createSignal<BrowserInfo[]>([]);
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    void refresh();
  });

  async function refresh() {
    try {
      const [nextPairing, nextBrowsers] = await Promise.all([
        backend.extensionPairingStatus(),
        backend.checkBrowsers(),
      ]);
      setPairing(nextPairing);
      setBrowsers(nextBrowsers);
    } catch (error) {
      notify.error(t(errorKey(error, 'bridge_unavailable')));
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      const code = await backend.extensionRegenerateCode();
      setPairing((current) => ({ code, paired: current?.paired ?? [] }));
      notify.ok(t('settings.regenerateSuccess'));
    } catch (error) {
      notify.error(t(errorKey(error, 'bridge_unavailable')));
    } finally {
      setBusy(false);
    }
  }

  function confirmClear() {
    showDialog(
      t('settings.clearPairingsConfirm'),
      <>
        <p class="dialog-desc">{t('settings.clearPairings')}</p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" onClick={hideDialog}>{t('common.cancel')}</button>
          <button class="btn btn-danger" onClick={() => { hideDialog(); void clearPairings(); }}>
            {t('settings.clearPairings')}
          </button>
        </div>
      </>,
    );
  }

  async function clearPairings() {
    setBusy(true);
    try {
      await backend.extensionClearPaired();
      setPairing((current) => current ? { ...current, paired: [] } : current);
      notify.ok(t('settings.clearPairingsSuccess'));
    } catch (error) {
      notify.error(t(errorKey(error, 'bridge_unavailable')));
    } finally {
      setBusy(false);
    }
  }

  async function install(browser: string) {
    setBusy(true);
    try {
      await backend.installExtension(browser);
      notify.ok(t('settings.extensionInstallStarted'));
      await refresh();
    } catch (error) {
      notify.error(t(errorKey(error, 'extension_unavailable')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('settings.extension')}>
      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.extensionPairing')} desc={t('settings.extensionPairingDesc')} />
        <Show when={pairing()} fallback={<div class="setting-note">{t('settings.extensionPairingStatus')}</div>}>
          <div class="pair-code-row">
            <code class="pair-code">{pairing()!.code}</code>
            <CopyButton value={() => pairing()!.code} />
          </div>
          <div class="setting-inline">
            <button class="btn btn-ghost" onClick={() => void regenerate()} disabled={busy()}>
              {t('settings.regenerate')}
            </button>
            <button class="btn btn-ghost" onClick={confirmClear} disabled={busy()}>
              {t('settings.clearPairings')}
            </button>
          </div>
          <ul class="pair-devices">
            <For each={pairing()!.paired}>
              {(device) => <li class="pair-device">{device}</li>}
            </For>
          </ul>
        </Show>
      </div>
      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.installExtension')} desc={t('settings.extensionManual')} />
        <div class="browser-list">
          <For each={browsers()} fallback={<div class="browser-not-found">{t('settings.browserUnavailable')}</div>}>
            {(browser) => (
              <div class="browser-row">
                <div class="browser-name">{browser.name}</div>
                <div class="browser-status">
                  {browser.extension_installed
                    ? t('settings.extensionInstalled')
                    : browser.browser_installed
                      ? t('settings.browserDetected')
                      : t('settings.browserNotInstalled')}
                </div>
                <Show when={browser.browser_installed && !browser.extension_installed} fallback={<span class="browser-action-spacer" />}>
                  <button class="btn btn-ghost" onClick={() => void install(browser.name)} disabled={busy()}>
                    {t('settings.extensionInstallButton')}
                  </button>
                </Show>
              </div>
            )}
          </For>
        </div>
      </div>
    </Section>
  );
}

export function DataSection() {
  const [csv, setCsv] = createSignal<CsvPreview | null>(null);
  const [csvContent, setCsvContent] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  async function chooseCsv() {
    try {
      const content = await backend.openTextFile();
      if (content === null) return;
      setCsvContent(content);
      setCsv(await backend.previewCsv(content));
    } catch (error) {
      notify.error(t(errorKey(error, 'file_failed')));
    }
  }

  async function importCsv() {
    if (!csvContent() || busy()) return;
    setBusy(true);
    try {
      const result = await backend.importCsv(csvContent());
      notify.ok(t('settings.importSuccess', {
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors,
      }));
      setCsv(null);
      setCsvContent('');
      await actions.reloadItems();
    } catch (error) {
      notify.error(t(errorKey(error, 'file_failed')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={t('settings.data')}>
      <div class="setting-row setting-row-stack">
        <SettingLabel name={t('settings.importCsv')} desc={t('settings.importDescription')} />
        <div class="setting-control">
          <button class="btn btn-ghost" onClick={() => void chooseCsv()} disabled={busy()}>
            {t('settings.chooseFile')}
          </button>
        </div>
        <Show when={csv()}>
          <div class="setting-panel">
            <div class="setting-note">
              {t('settings.importPreview', {
                format: csv()!.format,
                rows: csv()!.rows,
                sample: csv()!.sample.length,
              })}
            </div>
            <div class="csv-table-scroll">
              <table class="csv-preview">
                <thead>
                  <tr>
                    <th>{t('editor.title')}</th>
                    <th>{t('editor.username')}</th>
                    <th>{t('editor.url')}</th>
                    <th>{t('editor.password')}</th>
                    <th>{t('editor.totp')}</th>
                    <th>{t('editor.recoveryCodes')}</th>
                    <th>{t('editor.passkeys')}</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={csv()!.sample}>
                    {(row) => (
                      <tr>
                        <td>{row.title || '-'}</td>
                        <td>{row.username || '-'}</td>
                        <td>{row.url || '-'}</td>
                        <td>{row.hasPassword ? 'yes' : '-'}</td>
                        <td>{row.hasTotp ? 'yes' : '-'}</td>
                        <td>{row.hasRecoveryCodes ? 'yes' : '-'}</td>
                        <td>{row.hasPasskeys ? 'yes' : '-'}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <div class="setting-inline">
              <button class="btn btn-primary" onClick={() => void importCsv()} disabled={busy()}>
                {busy() ? t('settings.importing') : t('settings.confirmImport')}
              </button>
              <button class="btn btn-ghost" onClick={() => setCsv(null)} disabled={busy()}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </Show>
      </div>
      <SettingRow name={t('settings.exportTitle')} desc={t('settings.exportDescription')}>
        <button class="btn btn-ghost" onClick={() => void saveExport('yobei-vault.yobei', () => backend.exportVault(), setBusy)} disabled={busy()}>
          {t('common.export')}
        </button>
      </SettingRow>
    </Section>
  );
}

// Rare and irreversible operations live one level deeper, away from daily settings.
export function AdvancedSection(props: { onRestore: () => void }) {
  const [busy, setBusy] = createSignal(false);

  function confirmPlaintextExport() {
    showDialog(
      t('settings.exportPlainTitle'),
      <>
        <p class="dialog-desc">{t('settings.plaintextWarning')}</p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" onClick={hideDialog}>{t('common.cancel')}</button>
          <button
            class="btn btn-danger"
            onClick={() => { hideDialog(); void saveExport('yobei-export.csv', () => backend.exportCsv(), setBusy); }}
          >
            {t('settings.continueExport')}
          </button>
        </div>
      </>,
    );
  }

  return (
    <Section title={t('settings.advanced')}>
      <div class="setting-note setting-warning">{t('settings.advancedWarning')}</div>
      <SettingRow name={t('settings.restoreTitle')} desc={t('settings.restoreDescription')}>
        <button class="btn btn-ghost" onClick={props.onRestore} disabled={busy()}>
          {t('settings.restoreChoose')}
        </button>
      </SettingRow>
      <SettingRow name={t('settings.exportPlainTitle')} desc={t('settings.exportPlainDescription')}>
        <button class="btn btn-danger" onClick={confirmPlaintextExport} disabled={busy()}>
          {t('common.export')}
        </button>
      </SettingRow>
    </Section>
  );
}

async function saveExport(fileName: string, load: () => Promise<string>, setBusy: (value: boolean) => void) {
  setBusy(true);
  try {
    const path = await backend.saveTextFile(fileName, await load());
    if (path !== null) notify.ok(t('common.done'));
  } catch (error) {
    notify.error(t(errorKey(error, 'file_failed')));
  } finally {
    setBusy(false);
  }
}

export function AboutSection(props: { version: string }) {
  return (
    <Section title={t('settings.about')}>
      <SettingRow name="Yobei" desc={t('settings.aboutDesc')}>
        <span class="setting-value">{props.version ? `v${props.version}` : t('common.loading')}</span>
      </SettingRow>
    </Section>
  );
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="settings-section">
      <div class="settings-title">{props.title}</div>
      {props.children}
    </section>
  );
}

function SettingRow(props: { name: string; desc: string; children: JSX.Element }) {
  return (
    <div class="setting-row">
      <SettingLabel name={props.name} desc={props.desc} />
      {props.children}
    </div>
  );
}

function SettingLabel(props: { name: string; desc: string }) {
  return (
    <div class="setting-label">
      <div class="setting-name">{props.name}</div>
      <div class="setting-desc">{props.desc}</div>
    </div>
  );
}

function ThemeButton(props: { value: Theme; label: string; icon: JSX.Element }) {
  return (
    <button
      class={`seg-btn seg-btn-icon${state.theme === props.value ? ' active' : ''}`}
      onClick={() => actions.setTheme(props.value)}
      aria-label={props.label}
      aria-pressed={state.theme === props.value}
      title={props.label}
    >
      {props.icon}
    </button>
  );
}

function SelectRow(props: {
  name: string;
  desc: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <SettingRow name={props.name} desc={props.desc}>
      <Select
        class="setting-select"
        value={() => props.value}
        options={props.options}
        onChange={props.onChange}
        ariaLabel={props.name}
      />
    </SettingRow>
  );
}

function ToggleRow(props: { name: string; desc: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <SettingRow name={props.name} desc={props.desc}>
      <div class="segmented">
        <button class={`seg-btn${props.value ? ' active' : ''}`} onClick={() => props.onChange(true)}>
          {t('settings.on')}
        </button>
        <button class={`seg-btn${!props.value ? ' active' : ''}`} onClick={() => props.onChange(false)}>
          {t('settings.off')}
        </button>
      </div>
    </SettingRow>
  );
}

function SecuritySelect(props: {
  name: string;
  desc: string;
  value: number;
  options: Array<{ value: number; label: string }>;
  onChange: (value: number) => void;
}) {
  return (
    <SelectRow
      name={props.name}
      desc={props.desc}
      value={String(props.value)}
      options={props.options.map((option) => ({ ...option, value: String(option.value) }))}
      onChange={(value) => props.onChange(Number(value))}
    />
  );
}

async function saveSecurity(patch: Parameters<typeof actions.saveSecurity>[0]) {
  try {
    await actions.saveSecurity(patch);
  } catch (error) {
    notify.error(t(errorKey(error, 'operation_failed')));
  }
}

function ChangePassword() {
  const [open, setOpen] = createSignal(false);
  const [oldPassword, setOldPassword] = createSignal('');
  const [newPassword, setNewPassword] = createSignal('');
  const [confirmation, setConfirmation] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  function pinInput(setter: (value: string) => void) {
    return (event: InputEvent & { currentTarget: HTMLInputElement }) => {
      setter(event.currentTarget.value.replace(/\D/g, '').slice(0, 6));
    };
  }

  async function submit() {
    if (!/^\d{6}$/.test(oldPassword())) {
      notify.error(t('settings.oldPasswordRequired'));
      return;
    }
    if (!/^\d{6}$/.test(newPassword())) {
      notify.error(t('settings.newPasswordMin'));
      return;
    }
    if (newPassword() !== confirmation()) {
      notify.error(t('settings.passwordMismatch'));
      return;
    }

    setBusy(true);
    try {
      await backend.changeMasterPassword(oldPassword(), newPassword());
      setOpen(false);
      setOldPassword('');
      setNewPassword('');
      setConfirmation('');
      notify.ok(t('settings.passwordChanged'));
    } catch (error) {
      notify.error(t(errorKey(error, 'invalid_password')));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="setting-row setting-row-stack">
      <SettingLabel name={t('settings.changePassword')} desc={t('settings.changePasswordDesc')} />
      <div class="setting-control">
        <button class="btn btn-ghost" onClick={() => setOpen((value) => !value)}>
          {open() ? t('common.cancel') : t('settings.change')}
        </button>
      </div>
      <Show when={open()}>
        <div class="setting-inline">
          <input
            class="fog-input"
            type="password"
            inputMode="numeric"
            maxLength={6}
            autocomplete="off"
            placeholder={t('settings.oldPassword')}
            value={oldPassword()}
            onInput={pinInput(setOldPassword)}
          />
          <input
            class="fog-input"
            type="password"
            inputMode="numeric"
            maxLength={6}
            autocomplete="off"
            placeholder={t('settings.newPassword')}
            value={newPassword()}
            onInput={pinInput(setNewPassword)}
          />
          <input
            class="fog-input"
            type="password"
            inputMode="numeric"
            maxLength={6}
            autocomplete="off"
            placeholder={t('settings.confirmPassword')}
            value={confirmation()}
            onInput={pinInput(setConfirmation)}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit(); }}
          />
          <button class="btn btn-primary" onClick={() => void submit()} disabled={busy()}>
            {busy() ? t('common.updating') : t('settings.confirmChange')}
          </button>
        </div>
      </Show>
    </div>
  );
}

function Biometric() {
  const [supported, setSupported] = createSignal(false);
  const [probed, setProbed] = createSignal(false);
  const [enabled, setEnabled] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [password, setPassword] = createSignal('');
  const [busy, setBusy] = createSignal(false);

  onMount(() => {
    void Promise.all([backend.biometricAvailable(), backend.isBiometricEnabled()])
      .then(([available, active]) => {
        setSupported(available);
        setEnabled(active);
        setProbed(true);
      })
      .catch(() => setProbed(true));
  });

  async function enable() {
    if (!/^\d{6}$/.test(password())) {
      notify.error(t('settings.passwordRequired'));
      return;
    }

    setBusy(true);
    try {
      await backend.setupBiometric(password());
      setEnabled(true);
      setOpen(false);
      setPassword('');
      notify.ok(t('settings.biometricEnabled'));
    } catch (error) {
      notify.error(t(errorKey(error, 'biometric_unavailable')));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      await backend.disableBiometric();
      setEnabled(false);
      notify.ok(t('settings.biometricDisabled'));
    } catch (error) {
      notify.error(t(errorKey(error, 'biometric_unavailable')));
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
          <button class="btn btn-ghost" onClick={() => enabled() ? void disable() : setOpen((value) => !value)} disabled={busy()}>
            {enabled() ? t('settings.disable') : open() ? t('common.cancel') : t('settings.enable')}
          </button>
        </Show>
      </div>
      <Show when={open() && supported() && !enabled()}>
        <div class="setting-inline">
          <input
            class="fog-input setting-restore-pw"
            type="password"
            inputMode="numeric"
            maxLength={6}
            autocomplete="off"
            placeholder={t('settings.passwordRequired')}
            value={password()}
            onInput={(event) => setPassword(event.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(event) => { if (event.key === 'Enter') void enable(); }}
          />
          <button class="btn btn-primary" onClick={() => void enable()} disabled={busy()}>
            {busy() ? t('common.processing') : t('settings.confirmEnable')}
          </button>
        </div>
        <div class="setting-note">{t('settings.biometricNote')}</div>
      </Show>
    </div>
  );
}
