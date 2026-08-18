import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { backend } from '../../core/backend';
import { decodeQrImage } from '../../core/qr';
import { errorKey } from '../../core/errors';
import { t } from '../../core/locale';
import { actions, state } from '../../core/state';
import type { VaultItem } from '../../core/types';
import { IconCamera, IconChevronDown, IconMenu, IconPlus, IconScan, IconSearch, IconUpload } from '../../ui/icons';
import { notify } from '../../ui/notifications';
import SiteIcon from '../../ui/site-icon';
import { addTotpFromUri } from './totp';

interface ItemListProps {
  onMenu?: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onScan: () => void;
}

export default function ItemList(props: ItemListProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  const items = createMemo(() => actions.visibleItems());
  let fileInput: HTMLInputElement | undefined;
  let menu: HTMLDivElement | undefined;
  let newButton: HTMLButtonElement | undefined;

  onMount(() => {
    function closeMenu(event: MouseEvent) {
      const target = event.target as Node;
      if (!menu?.contains(target) && !newButton?.contains(target)) setMenuOpen(false);
    }
    document.addEventListener('click', closeMenu);
    onCleanup(() => document.removeEventListener('click', closeMenu));
  });

  async function importQr(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      await addTotpFromUri(await decodeQrImage(file));
    } catch (error) {
      notify.error(t(errorKey(error, 'invalid_qr')));
    }
  }

  async function importScreenshot() {
    setMenuOpen(false);
    try {
      await addTotpFromUri(await backend.captureQrFromScreen());
    } catch (error) {
      notify.error(t(errorKey(error, 'operation_failed')));
    }
  }

  return (
    <div class="item-list-pane">
      <div class="toolbar">
        <Show when={props.onMenu}>
          <button class="icon-btn list-menu-btn" onClick={props.onMenu} aria-label={t('common.menu')}>
            <IconMenu size={18} />
          </button>
        </Show>
        <div class="search-box">
          <span class="search-icon"><IconSearch size={15} /></span>
          <input
            class="fog-input"
            value={state.search}
            onInput={(event) => actions.setSearch(event.currentTarget.value)}
            placeholder={t('list.searchPlaceholder')}
            aria-label={t('list.searchVault')}
          />
        </div>
        <div class="new-btn-wrap">
          <button
            ref={newButton}
            class="btn btn-primary new-btn-trigger"
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen()}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <IconPlus size={14} />
            {t('list.new')}
            <IconChevronDown class="new-btn-chevron" classList={{ open: menuOpen() }} size={14} />
          </button>
          <Show when={menuOpen()}>
            <div ref={menu} class="new-btn-menu" role="menu">
              <button
                class="new-btn-option"
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); props.onNew(); }}
              >
                <IconPlus size={14} />
                {t('list.manual')}
              </button>
              <button
                class="new-btn-option"
                type="button"
                role="menuitem"
                onClick={() => { setMenuOpen(false); fileInput?.click(); }}
              >
                <IconUpload size={14} />
                {t('qr.uploadImage')}
              </button>
              <Show when={!__YOBEI_DESKTOP__}>
                <button
                  class="new-btn-option"
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); props.onScan(); }}
                >
                  <IconScan size={14} />
                  {t('list.scan')}
                </button>
              </Show>
              <Show when={__YOBEI_DESKTOP__}>
                <button
                  class="new-btn-option"
                  type="button"
                  role="menuitem"
                  onClick={() => void importScreenshot()}
                >
                  <IconCamera size={14} />
                  {t('list.screenshot')}
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </div>

      <input ref={fileInput} class="qr-file-input" type="file" accept="image/*" onChange={(event) => void importQr(event)} />

      <div class="item-list" role="listbox" aria-label={t('nav.vault')}>
        <For each={items()} fallback={<div class="list-empty"><p>{t('list.empty')}</p></div>}>
          {(item) => (
            <VaultRow
              item={item}
              selected={item.id === state.selectedId}
              onClick={() => props.onSelect(item.id)}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function VaultRow(props: { item: VaultItem; selected: boolean; onClick: () => void }) {
  const [copied, setCopied] = createSignal(false);
  let timer: number | undefined;

  onCleanup(() => {
    if (timer) window.clearTimeout(timer);
  });

  async function copyTotp(event: Event) {
    event.stopPropagation();
    const data = await actions.contentFor(props.item.id).catch(() => undefined);
    if (!data?.totp) return;

    try {
      const result = await backend.computeTotp(data.totp);
      await navigator.clipboard.writeText(result.code);
      setCopied(true);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Invalid TOTP values are shown in the detail pane instead.
    }
  }

  return (
    <div
      class={`vault-item${props.selected ? ' selected' : ''}`}
      role="option"
      aria-selected={props.selected}
      tabindex="0"
      onClick={props.onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') props.onClick();
      }}
    >
      <SiteIcon title={props.item.title} url={props.item.url} class="item-icon" />
      <div class="item-info">
        <div class="item-title">{props.item.title || t('list.noTitle')}</div>
        <div class="item-subtitle">{props.item.type === 'note' ? t('list.note') : props.item.username || t('list.noUsername')}</div>
      </div>
      <div class="item-meta">
        <Show when={props.item.hasTotp}>
          <span class={`totp-pill${copied() ? ' copied' : ''}`} onClick={(event) => void copyTotp(event)}>
            {copied() ? t('list.totpCopied') : '••• •••'}
          </span>
        </Show>
        <span class="item-time">{relativeTime(props.item.updatedAt)}</span>
      </div>
    </div>
  );
}

function relativeTime(timestamp: number): string {
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000);
  if (minutes < 1) return t('time.justNow');
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  return new Date(timestamp).toLocaleDateString();
}
