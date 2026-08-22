import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import type { JSX } from 'solid-js';
import { backend } from '../../core/backend';
import { errorKey } from '../../core/errors';
import { t } from '../../core/locale';
import { actions, state } from '../../core/state';
import Dialog from '../../ui/dialog';
import { IconBack, IconChevronRight, IconWarning } from '../../ui/icons';
import { useMediaQuery } from '../vault/useMediaQuery';
import { notify } from '../../ui/notifications';
import PinInput from '../../ui/pin-input';
import {
  AboutSection,
  AdvancedSection,
  DataSection,
  ExtensionSection,
  GeneralSection,
  SecuritySection,
  SyncSection,
} from './SettingsSections';

export default function SettingsPage(props: { onClose: () => void }) {
  const desktop = __YOBEI_DESKTOP__;
  const mobile = useMediaQuery('(max-width: 859px)');
  const [version, setVersion] = createSignal('');
  const [restoreContent, setRestoreContent] = createSignal<string | null>(null);
  const [restorePin, setRestorePin] = createSignal('');
  const [restoreBusy, setRestoreBusy] = createSignal(false);
  const anchors = new Map<string, HTMLElement>();

  onMount(() => {
    void backend.version().then(setVersion).catch(() => {});
  });

  // Everything common is laid out on one page; only Advanced is a subpage
  // because its actions are rare and irreversible.
  const flat = createMemo<Array<{ id: string; label: string; body: JSX.Element }>>(() => [
    { id: 'general', label: t('settings.general'), body: <GeneralSection /> },
    { id: 'security', label: t('settings.security'), body: <SecuritySection /> },
    { id: 'sync', label: t('settings.sync'), body: <SyncSection /> },
    ...(desktop ? [{ id: 'extension', label: t('settings.extension'), body: <ExtensionSection /> }] : []),
    { id: 'data', label: t('settings.data'), body: <DataSection /> },
    { id: 'about', label: t('settings.about'), body: <AboutSection version={version()} /> },
  ]);

  function openAdvanced() {
    actions.openSettingsSubpage('advanced');
    if (mobile() && history.state?.yobei !== 'settings-advanced') {
      history.pushState({ ...(history.state ?? {}), yobei: 'settings-advanced' }, '');
    }
  }

  function back() {
    if (!state.settingsSubpage) return props.onClose();
    if (mobile() && history.state?.yobei === 'settings-advanced') history.back();
    else actions.openSettingsSubpage(null);
  }

  async function chooseRestore() {
    try {
      const content = await backend.openTextFile();
      if (content === null) return;
      setRestoreContent(content);
      setRestorePin('');
    } catch (error) {
      notify.error(t(errorKey(error, 'file_failed')));
    }
  }

  async function confirmRestore() {
    if (!restoreContent() || !/^\d{6}$/.test(restorePin()) || restoreBusy()) return;
    setRestoreBusy(true);
    try {
      const result = await backend.importVault(restoreContent()!, restorePin());
      notify.ok(t('settings.restoreSuccess', { items: result.items }));
      setRestoreContent(null);
      await actions.reloadItems();
    } catch (error) {
      notify.error(t(errorKey(error, 'file_failed')));
    } finally {
      setRestoreBusy(false);
    }
  }

  return (
    <div class="settings-root fog-reveal">
      <div class="settings-layout">
        <Show when={!mobile()}>
          <aside class="settings-nav">
            <header class="settings-head">
              <button class="icon-btn settings-back" onClick={props.onClose} aria-label={t('settings.backToVault')}>
                <IconBack size={16} />
              </button>
              <h1 class="font-serif">{t('settings.title')}</h1>
            </header>
            <nav class="settings-nav-list" aria-label={t('settings.title')}>
              <For each={flat()}>
                {(item) => (
                  <button
                    class="settings-nav-item"
                    onClick={() => anchors.get(item.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  >
                    {item.label}
                  </button>
                )}
              </For>
            </nav>
          </aside>
        </Show>

        <main class="settings-content">
          <Show when={mobile()}>
            <header class="settings-head settings-head-mobile">
              <button
                class="icon-btn settings-back"
                onClick={back}
                aria-label={t(state.settingsSubpage ? 'common.back' : 'settings.backToVault')}
              >
                <IconBack size={18} />
              </button>
              <h1 class="font-serif">{t(state.settingsSubpage ? 'settings.advanced' : 'settings.title')}</h1>
            </header>
          </Show>

          <div class="settings-scroll">
            <div class="settings-body">
              <Show
                when={state.settingsSubpage === 'advanced'}
                fallback={
                  <>
                    <For each={flat()}>
                      {(item) => (
                        <div ref={(element) => anchors.set(item.id, element)} class="settings-anchor">
                          {item.body}
                        </div>
                      )}
                    </For>
                    <button class="settings-entry danger" onClick={openAdvanced}>
                      <span class="settings-entry-icon"><IconWarning size={19} /></span>
                      <span class="settings-entry-text">
                        <span class="settings-entry-name">{t('settings.advanced')}</span>
                        <span class="settings-entry-desc">{t('settings.advancedDesc')}</span>
                      </span>
                      <IconChevronRight size={17} class="settings-entry-chevron" />
                    </button>
                  </>
                }
              >
                <div class="settings-panel">
                  <Show when={!mobile()}>
                    <button class="btn btn-ghost settings-subpage-back" onClick={back}>
                      <IconBack size={14} />
                      {t('common.back')}
                    </button>
                  </Show>
                  <AdvancedSection onRestore={chooseRestore} />
                </div>
              </Show>
            </div>
          </div>
        </main>
      </div>

      <Dialog
        open={restoreContent() !== null}
        title={t('settings.restoreTitle')}
        onClose={() => !restoreBusy() && setRestoreContent(null)}
      >
        <div class="setting-row setting-row-stack">
          <div class="setting-label">
            <div class="setting-name">{t('settings.restorePassword')}</div>
            <div class="setting-desc">{t('setup.passwordHint')}</div>
          </div>
          <PinInput value={restorePin()} onInput={setRestorePin} autofocus ariaLabel={t('settings.restorePassword')} />
          <div class="setting-control">
            <button
              class="btn btn-primary"
              onClick={() => void confirmRestore()}
              disabled={!/^\d{6}$/.test(restorePin()) || restoreBusy()}
            >
              {restoreBusy() ? t('common.processing') : t('common.confirm')}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
