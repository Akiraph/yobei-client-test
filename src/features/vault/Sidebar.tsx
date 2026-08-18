import { createMemo, type JSX } from 'solid-js';
import { state, actions } from '../../core/state';
import { t } from '../../core/locale';
import { IconGrid, IconLock, IconNote, IconRefresh, IconSettings } from '../../ui/icons';

interface SidebarProps {
  onSettings: () => void;
  onClose: () => void;
}

export default function Sidebar(props: SidebarProps) {
  const noteCount = createMemo(() => state.items.filter((item) => item.type === 'note').length);

  function selectNav(nav: 'all' | 'notes') {
    actions.setNav(nav);
    props.onClose();
  }

  const syncLabel = () => {
    if (!state.sync.configured) return t('nav.syncDisabled');
    if (state.sync.syncing) return t('nav.syncing');
    if (state.sync.lastError) return t('nav.syncFailed');
    if (!state.sync.lastSyncAt) return t('nav.synced');
    return t('nav.syncedAt', {
      time: new Date(state.sync.lastSyncAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      }),
    });
  };

  return (
    <nav class="sidebar-nav">
      <div class="sidebar-section">
        <div class="sidebar-title">{t('nav.vault')}</div>
        <NavItem
          label={t('nav.allItems')}
          count={state.items.length}
          active={state.nav === 'all'}
          onClick={() => selectNav('all')}
          icon={<IconGrid size={15} />}
        />
        <NavItem
          label={t('nav.notes')}
          count={noteCount()}
          active={state.nav === 'notes'}
          onClick={() => selectNav('notes')}
          icon={<IconNote size={15} />}
        />
      </div>

      <div class="sidebar-footer">
        <button
          class="nav-item sync-nav-item"
          onClick={() => state.sync.configured ? void actions.sync() : props.onSettings()}
          disabled={state.sync.syncing}
          title={state.sync.serverUrl ?? t('nav.enableSync')}
        >
          <span class="nav-icon"><IconRefresh size={15} /></span>
          <span class="nav-label">{syncLabel()}</span>
          <span class={`sync-dot ${syncDotClass()}`} />
        </button>
        <button class="nav-item" onClick={props.onSettings} aria-current={state.settingsOpen ? 'page' : undefined}>
          <span class="nav-icon"><IconSettings size={15} /></span>
          <span class="nav-label">{t('nav.settings')}</span>
        </button>
        <button class="nav-item" onClick={() => void actions.lock()}>
          <span class="nav-icon"><IconLock size={15} /></span>
          <span class="nav-label">{t('nav.lock')}</span>
        </button>
      </div>
    </nav>
  );
}

function syncDotClass(): string {
  if (!state.sync.configured) return 'off';
  if (state.sync.syncing) return 'busy';
  if (state.sync.lastError) return 'error';
  return 'ok';
}

function NavItem(props: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  icon: JSX.Element;
}) {
  return (
    <button class="nav-item" aria-current={props.active ? 'page' : undefined} onClick={props.onClick}>
      <span class="nav-icon">{props.icon}</span>
      <span class="nav-label">{props.label}</span>
      <span class="nav-count">{props.count}</span>
    </button>
  );
}
