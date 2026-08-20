import { For, Show, createMemo, createSignal, onMount } from 'solid-js';
import type { JSX } from 'solid-js';
import { backend } from '../../core/backend';
import { errorKey } from '../../core/errors';
import { t } from '../../core/locale';
import { actions, state } from '../../core/state';
import type { SettingsSection } from '../../core/types';
import Dialog from '../../ui/dialog';
import {
  IconBack,
  IconChevronRight,
  IconDatabase,
  IconInfo,
  IconPalette,
  IconPuzzle,
  IconRefresh,
  IconShield,
  IconWarning,
} from '../../ui/icons';
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

interface SectionMeta {
  id: SettingsSection;
  label: string;
  desc: string;
  icon: JSX.Element;
  danger?: boolean;
}

export default function SettingsPage(props: { onClose: () => void }) {
  const desktop = __YOBEI_DESKTOP__;
  const mobile = useMediaQuery('(max-width: 859px)');
  const [version, setVersion] = createSignal('');
  const [restoreContent, setRestoreContent] = createSignal<string | null>(null);
  const [restorePin, setRestorePin] = createSignal('');
  const [restoreBusy, setRestoreBusy] = createSignal(false);

  // Desktop shows a section next to the nav; mobile starts at the root list.
  const section = createMemo(() => state.settingsSection ?? (mobile() ? null : 'general'));

  onMount(() => {
    void backend.version().then(setVersion).catch(() => {});
  });

  const sections = createMemo<SectionMeta[]>(() => [
    { id: 'general', label: t('settings.general'), desc: t('settings.generalDesc'), icon: <IconPalette size={19} /> },
    { id: 'security', label: t('settings.security'), desc: t('settings.securityDesc'), icon: <IconShield size={19} /> },
    { id: 'sync', label: t('settings.sync'), desc: t('settings.syncEntryDesc'), icon: <IconRefresh size={19} /> },
    ...(desktop
      ? [{ id: 'extension' as const, label: t('settings.extension'), desc: t('settings.extensionEntryDesc'), icon: <IconPuzzle size={19} /> }]
      : []),
    { id: 'data', label: t('settings.data'), desc: t('settings.dataDesc'), icon: <IconDatabase size={19} /> },
    { id: 'advanced', label: t('settings.advanced'), desc: t('settings.advancedDesc'), icon: <IconWarning size={19} />, danger: true },
    { id: 'about', label: t('settings.about'), desc: t('settings.aboutEntryDesc'), icon: <IconInfo size={19} /> },
  ]);

  // Mobile subpages take a history entry so the system back gesture unwinds them.
  function openSection(id: SettingsSection) {
    actions.openSettingsSection(id);
    if (mobile() && history.state?.yobei !== 'settings-section') {
      history.pushState({ ...(history.state ?? {}), yobei: 'settings-section' }, '');
    }
  }

  function back() {
    if (!mobile() || !state.settingsSection) return props.onClose();
    if (history.state?.yobei === 'settings-section') history.back();
    else actions.openSettingsSection(null);
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

  function sectionContent(id: SettingsSection) {
    switch (id) {
      case 'general': return <GeneralSection />;
      case 'security': return <SecuritySection />;
      case 'sync': return <SyncSection />;
      case 'extension': return desktop ? <ExtensionSection /> : null;
      case 'data': return <DataSection />;
      case 'advanced': return <AdvancedSection onRestore={chooseRestore} />;
      case 'about': return <AboutSection version={version()} />;
    }
  }

  const title = () => sections().find((item) => item.id === section())?.label ?? t('settings.title');

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
              <For each={sections()}>
                {(item) => (
                  <button
                    class={`settings-nav-item${section() === item.id ? ' active' : ''}${item.danger ? ' danger' : ''}`}
                    onClick={() => actions.openSettingsSection(item.id)}
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
              <button class="icon-btn settings-back" onClick={back} aria-label={t(section() ? 'common.back' : 'settings.backToVault')}>
                <IconBack size={18} />
              </button>
              <h1 class="font-serif">{title()}</h1>
            </header>
          </Show>

          <div class="settings-scroll">
            <div class="settings-body">
              <Show when={section()} keyed fallback={<SectionList sections={sections()} onOpen={openSection} />}>
                {(id) => <div class="settings-panel">{sectionContent(id)}</div>}
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

function SectionList(props: { sections: SectionMeta[]; onOpen: (id: SettingsSection) => void }) {
  return (
    <nav class="settings-entries" aria-label={t('settings.title')}>
      <For each={props.sections}>
        {(item) => (
          <button class={`settings-entry${item.danger ? ' danger' : ''}`} onClick={() => props.onOpen(item.id)}>
            <span class="settings-entry-icon">{item.icon}</span>
            <span class="settings-entry-text">
              <span class="settings-entry-name">{item.label}</span>
              <span class="settings-entry-desc">{item.desc}</span>
            </span>
            <IconChevronRight size={17} class="settings-entry-chevron" />
          </button>
        )}
      </For>
    </nav>
  );
}
