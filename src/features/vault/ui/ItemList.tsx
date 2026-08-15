import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { computeTotp } from '../../../lib/ipc';
import { copyText } from '../../../lib/clipboard';
import { relativeTime } from '../../../lib/format';
import { notifyError, notifyOk } from '../../../lib/notify';
import { errorMessage } from '../../../lib/errors';
import { IconSearch, IconPlus, IconScan, IconMenu, IconRefresh } from '../../../components/Icon';
import type { VaultItem } from '../../../lib/types';
import { t } from '../../../lib/i18n';
import { QrScanner } from '../../../components/QrScanner';
import { hideDialog, showDialog } from '../../../lib/dialog';
import SiteIcon from '../../../components/SiteIcon';
import type { VaultFeature } from '../model';

interface Props {
  feature: VaultFeature;
  onNew?: () => void;
  onMenu?: () => void;
}

export default function ItemList(props: Props) {
  const [showNewMenu, setShowNewMenu] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const [pullDistance, setPullDistance] = createSignal(0);
  const [pullDragging, setPullDragging] = createSignal(false);
  let menuRef: HTMLDivElement | undefined;
  let btnRef: HTMLButtonElement | undefined;
  let listRef: HTMLDivElement | undefined;
  let pullStartY = 0;
  let pulling = false;

  const onDocClick = (e: MouseEvent) => {
    if (menuRef && !menuRef.contains(e.target as Node) && btnRef && !btnRef.contains(e.target as Node)) {
      setShowNewMenu(false);
    }
  };

  onMount(() => {
    document.addEventListener('click', onDocClick);
    onCleanup(() => document.removeEventListener('click', onDocClick));
  });

  const filteredItems = createMemo(() => props.feature.visibleItems());

  async function doRefresh() {
    if (refreshing()) return;
    setRefreshing(true);
    setPullDistance(56);
    try {
      await Promise.all([
        props.feature.runSync(),
        new Promise<void>((resolve) => window.setTimeout(resolve, 240)),
      ]);
    } finally {
      setRefreshing(false);
      setPullDistance(0);
    }
  }

  function onListTouchStart(event: TouchEvent) {
    if (refreshing()) return;
    const touch = event.touches[0];
    if (touch && listRef && listRef.scrollTop <= 0) {
      pullStartY = touch.clientY;
      pulling = true;
      setPullDragging(true);
      setPullDistance(0);
    } else {
      pulling = false;
      setPullDragging(false);
    }
  }

  function onListTouchMove(event: TouchEvent) {
    if (!pulling || refreshing()) return;
    const touch = event.touches[0];
    if (!touch) return;
    const delta = touch.clientY - pullStartY;
    if (delta <= 0) {
      pulling = false;
      setPullDragging(false);
      setPullDistance(0);
      return;
    }
    if (event.cancelable) event.preventDefault();
    setPullDistance(Math.min(96, delta * 0.5));
  }

  function onListTouchEnd() {
    if (pulling && pullDistance() >= 72) {
      pulling = false;
      setPullDragging(false);
      void doRefresh();
      return;
    }
    pulling = false;
    setPullDragging(false);
    setPullDistance(0);
  }

  function handleScanAndAdd() {
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
      const candidates = (await Promise.all(
        props.feature.items()
          .filter((item) => item.type === 'login')
          .map(async (item) => {
            const data = await props.feature.itemContentFor(item.id);
            return props.feature.accountMatches(item, data, parsed.account, parsed.service, parsed.title) ? item : null;
          }),
      )).filter((item): item is VaultItem => item !== null);
      if (candidates.length === 0) {
        await runTotpAction(() => createTotpItem(props.feature, parsed));
        return;
      }
      if (candidates.length === 1) {
        await runTotpAction(() => updateTotpItem(props.feature, candidates[0], parsed));
        return;
      }
      showCredentialChoice(props.feature, parsed, candidates);
    } catch (error) {
      notifyError(errorMessage(error, 'operation_failed'));
    }
  }

  function handleManualAdd() {
    setShowNewMenu(false);
    props.onNew?.();
  }

  function choose(id: string) {
    props.feature.select(id);
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
            placeholder={t('list.searchPlaceholder')}
            value={props.feature.search()}
            onInput={(e) => props.feature.setSearch(e.currentTarget.value)}
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

      <div
        class="item-list"
        classList={{ 'is-pull-dragging': pullDragging() }}
        ref={listRef}
        role="listbox"
        aria-label={t('nav.vault')}
        onTouchStart={onListTouchStart}
        onTouchMove={onListTouchMove}
        onTouchEnd={onListTouchEnd}
        onTouchCancel={onListTouchEnd}
      >
        <div
          class="pull-indicator"
          classList={{ visible: pullDistance() > 0 || refreshing(), ready: pullDistance() >= 72, refreshing: refreshing() }}
          style={`--pull-distance: ${pullDistance()}px;`}
          aria-hidden="true"
        >
          <span
            class="pull-indicator-icon"
            style={`transform: rotate(${Math.min(180, pullDistance() / 72 * 180)}deg);`}
          >
            <IconRefresh size={15} />
          </span>
          <span>{refreshing() ? t('nav.syncing') : t('nav.syncNow')}</span>
        </div>
        <div class="item-list-content" style={`--pull-distance: ${pullDistance()}px;`}>
          <For each={filteredItems()} fallback={
            <div class="list-empty">
              <p>{t('list.empty')}</p>
            </div>
          }>
            {(item) => (
              <VaultRow
                item={item}
                selected={props.feature.selectedItemId() === item.id}
                onClick={() => choose(item.id)}
              />
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

type ParsedTotp = { title: string; secret: string; account?: string; service?: string };

async function runTotpAction(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    notifyError(errorMessage(error, 'operation_failed'));
  }
}

function totpCredentialPatch(parsed: ParsedTotp) {
  return {
    totp: parsed.secret,
    ...(parsed.account ? { username: parsed.account } : {}),
  };
}

async function createTotpItem(feature: VaultFeature, parsed: ParsedTotp) {
  await feature.saveItem({ type: 'login', data: { title: parsed.title, totp: parsed.secret, username: parsed.account } });
  notifyOk(t('list.totpAdded', { title: parsed.title }));
}

async function updateTotpItem(feature: VaultFeature, item: VaultItem, parsed: ParsedTotp) {
  await feature.saveAccountCredential(item, totpCredentialPatch(parsed));
  notifyOk(t('list.totpUpdated', { title: item.title }));
}

function parseOtpauthUri(uri: string): ParsedTotp | null {
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

function showCredentialChoice(feature: VaultFeature, parsed: ParsedTotp, candidates: VaultItem[]) {
  showDialog(
    t('list.chooseAccountTitle'),
    <div class="credential-choice-list">
      <p class="dialog-desc">{t('list.chooseAccountHint')}</p>
      <For each={candidates}>
        {(item) => (
          <button class="credential-choice" onClick={() => {
            hideDialog();
            void runTotpAction(() => updateTotpItem(feature, item, parsed));
          }}>
            <span class="credential-choice-title">{item.title}</span>
            <span class="credential-choice-meta">{item.username || t('list.noUsername')}{item.url ? ` · ${item.url}` : ''}</span>
          </button>
        )}
      </For>
      <button class="btn btn-primary credential-choice-new" onClick={() => {
        hideDialog();
        void runTotpAction(() => createTotpItem(feature, parsed));
      }}>
        {t('list.createAccount')}
      </button>
    </div>,
  );
}

function VaultRow(p: { item: VaultItem; selected: boolean; onClick: () => void }) {
  const [copied, setCopied] = createSignal(false);
  let resetTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (resetTimer) clearTimeout(resetTimer);
  });

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
    if (resetTimer) clearTimeout(resetTimer);
    resetTimer = setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div
      class={`vault-item${p.selected ? ' selected' : ''}`}
      onClick={p.onClick}
      role="option"
      aria-selected={p.selected}
      tabindex="0"
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        p.onClick();
      }}
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
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              void copyTotp(e);
            }}
          >
            {copied() ? t('list.totpCopied') : '··· ···'}
          </span>
        </Show>
        <span class="item-time">{relativeTime(p.item.updatedAt)}</span>
      </div>
    </div>
  );
}
