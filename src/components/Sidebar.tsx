import { Show } from 'solid-js';
import type { JSX } from 'solid-js';
import { state, setActiveNav, lock, toggleSettings, runSync } from '../lib/store';
import { t } from '../lib/i18n';
import { IconGrid, IconNote, IconLock, IconSettings, IconRefresh } from './Icon';

interface Props {
  onNavigate?: () => void;
}

export default function Sidebar(props: Props) {
  function nav(id: string) {
    toggleSettings(false);
    setActiveNav(id);
    props.onNavigate?.();
  }

  function openSettings() {
    toggleSettings(true);
    props.onNavigate?.();
  }

  return (
    <nav class="sidebar-nav">
      <div class="sidebar-section">
        <div class="sidebar-title">{t('nav.vault')}</div>
        <NavItem id="all" icon={<IconGrid size={15} />} label={t('nav.allItems')} count={state.items.length} active={!state.showSettings && state.activeNav === 'all'} onClick={nav} />
        <NavItem id="notes" icon={<IconNote size={15} />} label={t('nav.notes')} count={state.items.filter((item) => item.type === 'note').length} active={!state.showSettings && state.activeNav === 'notes'} onClick={nav} />
      </div>

      <div class="sidebar-footer">
        <SyncButton onOpenSettings={openSettings} />
        <button class="nav-item" classList={{ active: state.showSettings }} onClick={openSettings}>
          <span class="nav-icon"><IconSettings size={15} /></span>
          <span class="nav-label">{t('nav.settings')}</span>
        </button>
        <button class="nav-item sidebar-lock" onClick={lock}>
          <span class="nav-icon"><IconLock size={15} /></span>
          <span class="nav-label">{t('nav.lock')}</span>
        </button>
      </div>
    </nav>
  );
}

function SyncButton(props: { onOpenSettings: () => void }) {
  const sync = () => state.sync;
  const configured = () => sync().configured;

  const label = () => {
    const current = sync();
    if (!current.configured) return t('nav.syncDisabled');
    if (current.syncing) return t('nav.syncing');
    if (current.lastError) return t('nav.syncFailed');
    if (current.pending > 0) return t('nav.pending', { count: current.pending });
    if (!current.lastSyncAt) return t('nav.synced');
    const date = new Date(current.lastSyncAt);
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    return t('nav.syncedAt', { time });
  };

  const dotClass = () => !configured() ? 'off'
    : sync().syncing ? 'busy'
    : sync().lastError ? 'error'
    : 'ok';

  const actionLabel = () => configured() ? t('nav.syncNow') : t('nav.enableSync');

  return (
    <button
      class="nav-item sync-nav-item"
      classList={{ syncing: sync().syncing, error: !!sync().lastError }}
      onClick={() => configured() ? runSync() : props.onOpenSettings()}
      disabled={sync().syncing}
      aria-busy={sync().syncing}
      aria-label={actionLabel()}
      title={sync().lastError ? t('nav.syncFailed') : sync().serverUrl || actionLabel()}
    >
      <span class="nav-icon"><IconRefresh size={15} /></span>
      <span class="nav-label">{label()}</span>
      <span class={`sync-dot ${dotClass()}`} />
    </button>
  );
}

interface NavItemProps {
  id: string;
  icon: JSX.Element;
  label: string;
  count?: number;
  active: boolean;
  onClick: (id: string) => void;
}

function NavItem(props: NavItemProps) {
  return (
    <button class={`nav-item${props.active ? ' active' : ''}`} onClick={() => props.onClick(props.id)}>
      <span class="nav-icon">{props.icon}</span>
      <span class="nav-label">{props.label}</span>
      <Show when={props.count !== undefined}>
        <span class="nav-count">{props.count}</span>
      </Show>
    </button>
  );
}
