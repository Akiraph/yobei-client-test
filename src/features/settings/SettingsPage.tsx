import { Show, createSignal, onMount } from 'solid-js';
import { backend } from '../../core/backend';
import { errorKey } from '../../core/errors';
import { t } from '../../core/locale';
import { actions } from '../../core/state';
import Dialog from '../../ui/dialog';
import { IconBack } from '../../ui/icons';
import { notify } from '../../ui/notifications';
import PinInput from '../../ui/pin-input';
import {
  AboutSection,
  DataSection,
  ExtensionSection,
  GeneralSection,
  SecuritySection,
  SyncSection,
} from './SettingsSections';

type SectionId = 'general' | 'security' | 'sync' | 'extension' | 'data' | 'about';

export default function SettingsPage(props: { onClose: () => void }) {
  const desktop = __YOBEI_DESKTOP__;
  const [section, setSection] = createSignal<SectionId>('general');
  const [version, setVersion] = createSignal('');
  const [restoreContent, setRestoreContent] = createSignal<string | null>(null);
  const [restorePin, setRestorePin] = createSignal('');
  const [restoreBusy, setRestoreBusy] = createSignal(false);

  onMount(() => {
    void backend.version().then(setVersion).catch(() => {});
  });

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
        <aside class="settings-nav">
          <SettingsHeader onClose={props.onClose} />
          <nav class="settings-nav-list">
            <NavItem id="general" label={t('settings.general')} active={section() === 'general'} onClick={setSection} />
            <NavItem id="security" label={t('settings.security')} active={section() === 'security'} onClick={setSection} />
            <NavItem id="sync" label={t('settings.sync')} active={section() === 'sync'} onClick={setSection} />
            <Show when={desktop}>
              <NavItem
                id="extension"
                label={t('settings.extension')}
                active={section() === 'extension'}
                onClick={setSection}
              />
            </Show>
            <NavItem id="data" label={t('settings.data')} active={section() === 'data'} onClick={setSection} />
            <NavItem id="about" label={t('settings.about')} active={section() === 'about'} onClick={setSection} />
          </nav>
        </aside>

        <main class="settings-content">
          <div class="settings-scroll">
            <div class="settings-body">
              <Show when={section() === 'general'}><GeneralSection /></Show>
              <Show when={section() === 'security'}><SecuritySection /></Show>
              <Show when={section() === 'sync'}><SyncSection /></Show>
              <Show when={section() === 'extension' && desktop}><ExtensionSection /></Show>
              <Show when={section() === 'data'}><DataSection onRestore={chooseRestore} /></Show>
              <Show when={section() === 'about'}><AboutSection version={version()} /></Show>
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
          <SettingLabel name={t('settings.restorePassword')} desc={t('setup.passwordHint')} />
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

function SettingsHeader(props: { onClose: () => void }) {
  return (
    <header class="settings-head">
      <button class="icon-btn settings-back" onClick={props.onClose} aria-label={t('settings.backToVault')}>
        <IconBack size={16} />
      </button>
      <h1 class="font-serif">{t('settings.title')}</h1>
    </header>
  );
}

function NavItem(props: { id: SectionId; label: string; active: boolean; onClick: (id: SectionId) => void }) {
  return (
    <button
      class={`settings-nav-item${props.active ? ' active' : ''}`}
      onClick={() => props.onClick(props.id)}
    >
      {props.label}
    </button>
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
