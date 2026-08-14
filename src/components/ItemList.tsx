import { For, Show, createSignal, createEffect, onCleanup } from 'solid-js';
import { state, setSearch, selectItem, visibleItems, saveItem, accountMatches, itemContentFor, saveAccountCredential } from '../lib/store';
import { computeTotp } from '../lib/ipc';
import { copyText } from '../lib/clipboard';
import { relativeTime } from '../lib/format';
import { notifyError, notifyOk } from '../lib/notify';
import { errorMessage } from '../lib/errors';
import { IconSearch, IconPlus, IconScan } from './Icon';
import type { VaultItem } from '../lib/types';
import { t } from '../lib/i18n';
import { QrScanner } from './QrScanner';
import { hideDialog, showDialog } from '../lib/dialog';
import SiteIcon from './SiteIcon';

interface Props {
  onSelect?: () => void;
  onNew?: () => void;
}

export default function ItemList(props: Props) {
  const [showNewMenu, setShowNewMenu] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;
  let btnRef: HTMLButtonElement | undefined;

  const onDocClick = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node) && btnRef && !btnRef.contains(e.target as Node)) {
      setShowNewMenu(false);
    }
  };

  createEffect(() => {
    if (showNewMenu()) {
      document.addEventListener('click', onDocClick);
    } else {
      document.removeEventListener('click', onDocClick);
    }
  });
  onCleanup(() => document.removeEventListener('click', onDocClick));

  async function handleScanAndAdd() {
    setShowNewMenu(false);
    showDialog(
      t('list.scan'),
      <QrScanner
        label={t('list.scan')}
        onResult={(uri) => { hideDialog(); void addTotp(uri); }}
        onError={notifyError}
      />,
    );
  }

  async function addTotp(uri: string) {
    const parsed = parseOtpauthUri(uri);
    if (!parsed) {
      notifyError(t('error.invalidTotp'));
      return;
    }
    try {
      const credentialPatch = {
        totp: parsed.secret,
        ...(parsed.account ? { username: parsed.account } : {}),
      };
      const candidates: VaultItem[] = [];
      for (const item of state.items) {
        if (item.type !== 'login') continue;
        const data = await itemContentFor(item.id);
        if (accountMatches(item, data, parsed.account, parsed.service, parsed.title)) candidates.push(item);
      }
      if (candidates.length === 1) {
        await saveAccountCredential(candidates[0], credentialPatch);
        notifyOk(t('list.totpUpdated', { title: candidates[0].title }));
      } else {
        showCredentialChoice(parsed, candidates);
      }
    } catch (error) {
      notifyError(errorMessage(error, 'operation_failed'));
    }
  }

  function handleManualAdd() {
    setShowNewMenu(false);
    props.onNew?.();
  }

  function choose(id: string) {
    selectItem(id);
    props.onSelect?.();
  }

  return (
    <div class="item-list-pane">
      <div class="toolbar">
        <div class="search-box">
          <span class="search-icon"><IconSearch size={15} /></span>
          <input
            class="fog-input"
            placeholder={t('list.searchPlaceholder')}
            value={state.search}
            onInput={(e) => setSearch(e.currentTarget.value)}
            aria-label={t('list.searchVault')}
          />
        </div>
        <div class="new-btn-wrap">
          <button ref={btnRef} class="btn btn-primary" onClick={() => setShowNewMenu((o) => !o)}>
            <IconPlus size={14} />
            {t('list.new')}
          </button>
          <Show when={showNewMenu()}>
            <div ref={menuRef} class="new-btn-menu">
              <button class="new-btn-option" onClick={handleManualAdd}>
                <IconPlus size={14} />
                {t('list.manual')}
              </button>
              <button class="new-btn-option" onClick={handleScanAndAdd}>
                <IconScan size={14} />
                {t('list.scan')}
              </button>
            </div>
          </Show>
        </div>
      </div>

      <div class="item-list" role="listbox" aria-label={t('nav.vault')}>
        <For each={visibleItems()} fallback={
          <div class="list-empty">
            <p>{t('list.empty')}</p>
          </div>
        }>
          {(item) => (
            <VaultRow
              item={item}
              selected={state.selectedItemId === item.id}
              onClick={() => choose(item.id)}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function parseOtpauthUri(uri: string): { title: string; secret: string; account?: string; service?: string } | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'otpauth:' || !url.pathname.includes('/')) return null;
    const secret = url.searchParams.get('secret');
    if (!secret) return null;
    const path = decodeURIComponent(url.pathname.slice(1));
    const label = path.includes('/') ? path.split('/').slice(1).join('/') : path;
    const title = url.searchParams.get('issuer') || label.split(':')[0] || label;
    const account = label.includes(':') ? label.split(':').slice(1).join(':') : undefined;
    return { title, secret, account, service: url.searchParams.get('issuer') || title };
  } catch {
    return null;
  }
}

function showCredentialChoice(parsed: { title: string; secret: string; account?: string; service?: string }, candidates: VaultItem[]) {
  const choices = candidates.length > 0 ? candidates : state.items.filter((item) => item.type === 'login');
  showDialog(
    t('list.chooseAccountTitle'),
    <div class="credential-choice-list">
      <p class="dialog-desc">{t(candidates.length ? 'list.chooseAccountHint' : 'list.noAccountMatch')}</p>
      <For each={choices}>
        {(item) => (
          <button class="credential-choice" onClick={async () => {
            hideDialog();
            try {
              await saveAccountCredential(item, {
                totp: parsed.secret,
                ...(parsed.account ? { username: parsed.account } : {}),
              });
              notifyOk(t('list.totpUpdated', { title: item.title }));
            } catch (error) {
              notifyError(errorMessage(error, 'operation_failed'));
            }
          }}>
            <span class="credential-choice-title">{item.title}</span>
            <span class="credential-choice-meta">{item.username || t('list.noUsername')}{item.url ? ` · ${item.url}` : ''}</span>
          </button>
        )}
      </For>
      <button class="btn btn-primary credential-choice-new" onClick={async () => {
        hideDialog();
        try {
          await saveItem({ type: 'login', data: { title: parsed.title, totp: parsed.secret, username: parsed.account } });
          notifyOk(t('list.totpAdded', { title: parsed.title }));
        } catch (error) {
          notifyError(errorMessage(error, 'operation_failed'));
        }
      }}>
        {t('list.createAccount')}
      </button>
    </div>,
  );
}

function VaultRow(p: { item: VaultItem; selected: boolean; onClick: () => void }) {
  const [copied, setCopied] = createSignal(false);

  async function copyTotp(e: Event) {
    e.stopPropagation();
    if (!p.item.totp) return;
    try {
      const r = await computeTotp(p.item.totp);
      await copyText(r.code);
    } catch {
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div
      class={`vault-item${p.selected ? ' selected' : ''}`}
      onClick={p.onClick}
      role="option"
      aria-selected={p.selected}
      tabindex="0"
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && p.onClick()}
    >
      <SiteIcon title={p.item.title} url={p.item.url} class="item-icon" />
      <div class="item-info">
        <div class="item-title">{p.item.title}</div>
        <div class="item-subtitle">
          {p.item.type === 'note' ? t('list.note') : p.item.username || t('list.noUsername')}
        </div>
      </div>
      <div class="item-meta">
        <Show when={p.item.totp}>
          <span
            class={`totp-pill${copied() ? ' copied' : ''}`}
            onClick={copyTotp}
            title={copied() ? t('list.totpCopied') : t('list.copyTotp')}
            role="button"
            tabindex="0"
            onKeyDown={(e) => e.key === 'Enter' && copyTotp(e)}
          >
            {copied() ? t('list.totpCopied') : '··· ···'}
          </span>
        </Show>
        <span class="item-time">{relativeTime(p.item.updatedAt)}</span>
      </div>
    </div>
  );
}
