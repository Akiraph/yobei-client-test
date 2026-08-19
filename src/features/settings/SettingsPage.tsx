import { For, Show, createSignal, onMount } from 'solid-js';
import { backend } from '../../core/backend';
import { errorKey } from '../../core/errors';
import { t } from '../../core/locale';
import { actions } from '../../core/state';
import Dialog from '../../ui/dialog';
import { IconBack } from '../../ui/icons';
import { useMediaQuery } from '../vault/useMediaQuery';
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
  const mobile = useMediaQuery('(max-width: 859px)');
  const [section, setSection] = createSignal<SectionId>('general');
  const sectionElements = new Map<SectionId, HTMLElement>();
  const navElements = new Map<SectionId, HTMLButtonElement>();
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

  const navItems: Array<{ id: SectionId; label: string }> = [
    { id: 'general', label: t('settings.general') },
    { id: 'security', label: t('settings.security') },
    { id: 'sync', label: t('settings.sync') },
    ...(desktop ? [{ id: 'extension' as const, label: t('settings.extension') }] : []),
    { id: 'data', label: t('settings.data') },
    { id: 'about', label: t('settings.about') },
  ];

  function selectSection(id: SectionId) {
    setSection(id);
    if (mobile()) {
      navElements.get(id)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      sectionElements.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function sectionContent(id: SectionId) {
    switch (id) {
      case 'general': return <GeneralSection />;
      case 'security': return <SecuritySection />;
      case 'sync': return <SyncSection />;
      case 'extension': return desktop ? <ExtensionSection /> : null;
      case 'data': return <DataSection onRestore={chooseRestore} />;
      case 'about': return <AboutSection version={version()} />;
    }
  }

  return (
    <div class="settings-root fog-reveal">
      <div class="settings-layout">
        <aside class="settings-nav">
          <SettingsHeader onClose={props.onClose} />
          <nav class="settings-nav-list" aria-label={t('settings.title')}>
            <For each={navItems}>
              {(item) => <NavItem {...item} ref={(element) => navElements.set(item.id, element)} active={section() === item.id} onClick={selectSection} />}
            </For>
          </nav>
        </aside>

        <main class="settings-content">
          <div class="settings-scroll">
            <div class={`settings-body${mobile() ? ' settings-body-mobile' : ''}`}>
              <Show
                when={mobile()}
                fallback={<Show when={section()} keyed>{(id) => <div class="settings-panel">{sectionContent(id)}</div>}</Show>}
              >
                <For each={navItems}>
                  {(item) => (
                    <div ref={(element) => sectionElements.set(item.id, element)} class="settings-mobile-section">
                      {sectionContent(item.id)}
                    </div>
                  )}
                </For>
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

function NavItem(props: { id: SectionId; label: string; active: boolean; onClick: (id: SectionId) => void; ref?: (element: HTMLButtonElement) => void }) {
  return (
    <button
      ref={props.ref}
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
