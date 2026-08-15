import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import {
  checkBrowsers,
  extensionClearPaired,
  extensionPairingStatus,
  extensionRegenerateCode,
  installExtension,
} from '../lib/ipc';
import type { BrowserInfo, PairingStatus } from '../lib/ipc';
import { copyText } from '../lib/clipboard';
import { t } from '../lib/i18n';
import { notifyError, notifyOk } from '../lib/notify';
import { showDialog, hideDialog } from '../lib/dialog';
import { IconBrowser } from '../components/Icon';
import { SettingLabel } from '../components/SettingLabel';
import { errorMessage } from '../lib/errors';

export default function ExtensionSection() {
  const [browserState, setBrowserState] = createSignal<BrowserInfo[]>([]);
  const [opening, setOpening] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<PairingStatus | null>(null);
  const [busy, setBusy] = createSignal(false);
  let browserRefreshTimer: number | undefined;
  let active = true;

  async function refreshBrowsers(attempt = 0) {
    try {
      const browsers = await checkBrowsers();
      if (active) setBrowserState(browsers);
    } catch {
      if (active) setBrowserState([]);
    }
    if (active && attempt < 5) {
      browserRefreshTimer = window.setTimeout(() => void refreshBrowsers(attempt + 1), 250);
    }
  }

  onMount(() => {
    void refreshBrowsers();
    extensionPairingStatus()
      .then((value) => { if (active) setStatus(value); })
      .catch(() => { if (active) setStatus(null); });
  });

  onCleanup(() => {
    active = false;
    if (browserRefreshTimer) window.clearTimeout(browserRefreshTimer);
  });

  async function openSetup(browser: string) {
    setOpening(browser);
    try {
      const extensionPath = await installExtension(browser);
      try {
        await copyText(extensionPath);
      } catch {
        // The browser page is still useful when clipboard access is unavailable.
      }
      notifyOk(t('settings.extensionInstallStarted'));
    } catch (error) {
      notifyError(errorMessage(error, 'extension_unavailable'));
    } finally {
      setOpening(null);
    }
  }

  async function regenerate() {
    setBusy(true);
    try {
      await extensionRegenerateCode();
      setStatus(await extensionPairingStatus());
      notifyOk(t('settings.regenerateSuccess'));
    } catch (error) {
      notifyError(errorMessage(error, 'bridge_unavailable'));
    } finally {
      setBusy(false);
    }
  }

  async function copyPairingCode() {
    const value = status()?.code;
    if (!value) return;
    try {
      await copyText(value);
      notifyOk(t('settings.copySuccess'));
    } catch (error) {
      notifyError(errorMessage(error, 'operation_failed'));
    }
  }

  function confirmClear() {
    showDialog(
      t('settings.clearPairings'),
      <>
        <p class="dialog-desc">{t('settings.confirmClear')}</p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" onClick={hideDialog}>{t('common.cancel')}</button>
          <button class="btn btn-danger" onClick={() => { hideDialog(); void clearPairings(); }}>{t('settings.clearPairingsConfirm')}</button>
        </div>
      </>,
    );
  }

  async function clearPairings() {
    setBusy(true);
    try {
      await extensionClearPaired();
      setStatus(await extensionPairingStatus());
      notifyOk(t('settings.clearPairingsSuccess'));
    } catch (error) {
      notifyError(errorMessage(error, 'bridge_unavailable'));
    } finally {
      setBusy(false);
    }
  }

  const browserOptions = [
    { key: 'chrome', label: 'Chrome', icon: <IconBrowser size={14} /> },
    { key: 'edge', label: 'Edge', icon: <IconBrowser size={14} /> },
  ];
  const hasInstallableBrowser = () => browserState().some((info) => info.browser_installed && !info.extension_installed);

  return (
    <div class="setting-row setting-row-stack">
      <SettingLabel name={t('settings.installExtension')} desc={t('settings.extensionDesc')} />
      <div class="browser-list">
        <For each={browserOptions}>
          {(browser) => {
            const info = () => browserState().find((item) => item.name === browser.key);
            return (
              <div class="browser-row">
                <span class="browser-name">{browser.icon} {browser.label}</span>
                <span class="browser-status">
                  <Show when={info() === undefined}>
                    {t('settings.extensionLoading')}
                  </Show>
                  <Show when={info() && !info()!.browser_installed}>
                    {t('settings.browserNotInstalled')}
                  </Show>
                  <Show when={info()?.browser_installed && info()?.extension_installed}>
                    {t('settings.extensionInstalled')}
                  </Show>
                </span>
                <Show when={info()?.browser_installed && !info()?.extension_installed}>
                  <button class="btn btn-ghost" onClick={() => openSetup(browser.key)} disabled={opening() === browser.key}>
                    {opening() === browser.key ? t('common.loading') : t('settings.extensionInstallButton')}
                  </button>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
      <Show when={hasInstallableBrowser()}>
        <div class="setting-note">{t('settings.extensionManual')}</div>
      </Show>

      <div class="setting-label setting-label-spaced">
        <div class="setting-name">{t('settings.extensionPairing')}</div>
        <div class="setting-desc">{t('settings.extensionPairingDesc')}</div>
      </div>

      <Show when={status()} fallback={<div class="setting-note">{t('settings.extensionPairingStatus')}</div>}>
        <div class="setting-panel">
          <div class="setting-note">{t('settings.pairingCodeNote')}</div>
          <div class="pair-code-row">
            <code class="pair-code">{status()!.code}</code>
            <button class="btn btn-ghost" onClick={copyPairingCode}>{t('common.copy')}</button>
            <button class="btn btn-ghost" onClick={regenerate} disabled={busy()}>{busy() ? t('common.processing') : t('settings.regenerate')}</button>
          </div>
          <Show when={status()!.paired.length > 0}>
            <div class="setting-note">{t('settings.pairedDevices', { count: status()!.paired.length })}</div>
            <ul class="pair-devices">
              <For each={status()!.paired}>{(id) => <li class="pair-device" title={id}>{id.slice(0, 8)}…</li>}</For>
            </ul>
            <button class="btn btn-ghost" onClick={confirmClear} disabled={busy()}>{t('settings.clearPairings')}</button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
