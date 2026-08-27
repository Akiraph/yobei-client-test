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

// Settings entries. Desktop shows one at a time next to the nav; mobile puts
// the common ones on a single scrollable page and keeps Advanced as a subpage,
// because its actions are rare and irreversible.
type NavId = 'general' | 'security' | 'sync' | 'extension' | 'data' | 'about' | 'advanced';

export default function SettingsPage(props: { onClose: () => void }) {
  const desktop = __YOBEI_DESKTOP__;
  const mobile = useMediaQuery('(max-width: 859px)');
  const [version, setVersion] = createSignal('');
  const [nav, setNav] = createSignal<NavId>('general');
  const [restoreContent, setRestoreContent] = createSignal<string | null>(null);
  const [restorePin, setRestorePin] = createSignal('');
  const [restoreBusy, setRestoreBusy] = createSignal(false);
  // Desktop scroll container; switching sections has to start at the top again.
  let scrollEl: HTMLDivElement | undefined;

  onMount(() => {
    void backend.version().then(setVersion).catch(() => {});
  });

  const commonIds = createMemo<NavId[]>(() => [
    'general',
    'security',
    'sync',
    ...(desktop ? (['extension'] as NavId[]) : []),
    'data',
    'about',
  ]);

  const navItems = createMemo<Array<{ id: NavId; label: string; danger?: boolean }>>(() => [
    ...commonIds().map((id) => ({ id, label: label(id) })),
    { id: 'advanced', label: t('settings.advanced'), danger: true },
  ]);

  function label(id: NavId): string {
    return t(`settings.${id}`);
  }

  // Called on demand, so a desktop section only mounts (and only hits the
  // backend) once it is actually shown.
  function body(id: NavId): JSX.Element {
    switch (id) {
      case 'general': return <GeneralSection />;
      case 'security': return <SecuritySection />;
      case 'sync': return <SyncSection />;
      case 'extension': return <ExtensionSection />;
      case 'data': return <DataSection />;
      case 'about': return <AboutSection version={version()} />;
      case 'advanced': return <AdvancedSection onRestore={chooseRestore} />;
    }
  }

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
              <For each={navItems()}>
                {(item) => (
                  <button
                    class={`settings-nav-item${nav() === item.id ? ' active' : ''}${item.danger ? ' danger' : ''}`}
                    aria-current={nav() === item.id ? 'page' : undefined}
                    onClick={() => {
                      setNav(item.id);
                      scrollEl?.scrollTo({ top: 0 });
                    }}
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

          <div class="settings-scroll" ref={scrollEl}>
            <div class="settings-body">
              {/* Desktop: one section at a time, driven by the nav. `keyed` so the
                  panel remounts and replays its slide-in on every switch. */}
              <Show
                when={mobile()}
                fallback={
                  <Show when={nav()} keyed>
                    {(id) => <div class="settings-panel">{body(id)}</div>}
                  </Show>
                }
              >
                <Show
                  when={state.settingsSubpage === 'advanced'}
                  fallback={
                    <>
                      <For each={commonIds()}>{(id) => body(id)}</For>
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
                    <AdvancedSection onRestore={chooseRestore} />
                  </div>
                </Show>
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
