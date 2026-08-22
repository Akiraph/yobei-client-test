import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { backend } from '../../core/backend';
import { showDialog, hideDialog } from '../../core/dialog';
import { errorKey } from '../../core/errors';
import { t } from '../../core/locale';
import { actions, state } from '../../core/state';
import type { VaultItem } from '../../core/types';
import CopyButton from '../../ui/copy-button';
import FogField from '../../ui/fog-field';
import { IconBack, IconNote, IconPencil, IconTrash } from '../../ui/icons';
import { notify } from '../../ui/notifications';
import SiteIcon from '../../ui/site-icon';
import Editor from './Editor';

interface DetailPaneProps {
  ref?: (element: HTMLElement) => void;
  mobile: boolean;
  editingId: string | null | undefined;
  onEdit: (id: string) => void;
  onClose: () => void;
}

export default function DetailPane(props: DetailPaneProps) {
  return (
    <aside class="vault-detail" ref={props.ref}>
      <Show when={props.editingId !== undefined} fallback={<ItemDetail {...props} />}>
        <Editor
          id={props.editingId ?? undefined}
          source={props.editingId ? state.contents[props.editingId] : null}
          initialType={props.editingId ? state.items.find((item) => item.id === props.editingId)?.type : undefined}
          onClose={props.onClose}
        />
      </Show>
    </aside>
  );
}

function ItemDetail(props: DetailPaneProps) {
  const item = createMemo(() => actions.selected());
  const content = createMemo(() => item() ? state.contents[item()!.id] : undefined);

  return (
    <Show when={item()} fallback={<div class="detail-empty"><p>{t('detail.select')}</p></div>}>
      {(current) => (
        <div class="detail-pane">
          <div class="detail-scroll">
            <div class="detail-header">
              <Show when={props.mobile}>
                <button class="icon-btn detail-back" onClick={props.onClose} aria-label={t('common.back')}>
                  <IconBack size={16} />
                </button>
              </Show>
              <div class="detail-icon-row">
                <Show when={current().type === 'note'} fallback={<SiteIcon title={current().title} url={content()?.url} class="detail-icon" />}>
                  <div class="detail-icon"><IconNote size={20} /></div>
                </Show>
                <button class="icon-btn" onClick={() => props.onEdit(current().id)} aria-label={t('common.edit')}>
                  <IconPencil size={16} />
                </button>
                <button class="icon-btn danger" onClick={() => confirmDelete(current())} aria-label={t('common.delete')}>
                  <IconTrash size={16} />
                </button>
              </div>
              <div class="detail-title font-serif">{current().title}</div>
              <Show when={content()?.url}>
                <a class="detail-url" href={linkFor(content()!.url!)} target="_blank" rel="noreferrer">{content()!.url}</a>
              </Show>
            </div>

            <Show when={current().type === 'login'}>
              <Field label={t('detail.username')} value={content()?.username} />
              <Field label={t('detail.password')} value={content()?.password} secret />
              <Field label={t('detail.totp')} value={content()?.totp} totp />
              <RecoveryCodes value={content()?.recoveryCodes} />
            </Show>

            <Show when={current().type === 'note'}>
              <div class="field-group">
                <div class="field-label">{t('editor.content')}</div>
                <FogField value={content()?.notes ?? ''} />
              </div>
            </Show>

            <Show when={content()?.notes && current().type === 'login'}>
              <div class="detail-section">
                <div class="field-label">{t('detail.notes')}</div>
                <div class="detail-notes">{content()!.notes}</div>
              </div>
            </Show>
          </div>
        </div>
      )}
    </Show>
  );
}

function Field(props: { label: string; value?: string; secret?: boolean; totp?: boolean }) {
  return (
    <Show when={props.value}>
      <div class="field-group">
        <div class="field-label">{props.label}</div>
        <Show when={props.secret} fallback={props.totp ? <TotpDisplay secret={props.value!} /> : <PlainField value={props.value!} />}>
          <FogField value={props.value!} />
        </Show>
      </div>
    </Show>
  );
}

function PlainField(props: { value: string }) {
  return <div class="field-value"><span class="field-text">{props.value}</span><CopyButton value={() => props.value} /></div>;
}

function RecoveryCodes(props: { value?: string }) {
  return (
    <Show when={props.value}>
      <div class="field-group">
        <div class="field-label">{t('detail.recoveryCodes')}</div>
        <For each={props.value!.split(/\r?\n/).filter(Boolean)}>
          {(value) => <PlainField value={value} />}
        </For>
      </div>
    </Show>
  );
}

function TotpDisplay(props: { secret: string }) {
  // r = 15.9155 → circumference ≈ 100, so dash values are plain percentages.
  const RING_RADIUS = 15.9155;
  const [code, setCode] = createSignal('');
  const [period, setPeriod] = createSignal(30);
  const [remaining, setRemaining] = createSignal(30);
  const [copied, setCopied] = createSignal(false);
  let copiedTimer: number | undefined;

  async function refresh(secret: string) {
    try {
      const result = await backend.computeTotp(secret);
      setCode(result.code);
      setPeriod(result.period || 30);
    } catch {
      setCode('');
    }
  }

  createEffect(() => {
    const secret = props.secret;
    let windowIndex = Math.floor(Date.now() / 1000 / period());
    void refresh(secret);
    const timer = window.setInterval(() => {
      const seconds = Math.floor(Date.now() / 1000);
      const current = period();
      setRemaining(current - (seconds % current));
      const next = Math.floor(seconds / current);
      if (next !== windowIndex) {
        windowIndex = next;
        void refresh(secret);
      }
    }, 250);
    onCleanup(() => window.clearInterval(timer));
  });

  onCleanup(() => {
    if (copiedTimer) window.clearTimeout(copiedTimer);
  });

  async function copy() {
    const value = code();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (copiedTimer) window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access may be denied; the code stays visible for manual copy.
    }
  }

  const fraction = () => Math.max(0, Math.min(1, remaining() / period()));
  const low = () => remaining() <= 5;

  return (
    <div
      class="totp-display"
      classList={{ copied: copied() }}
      role="button"
      tabindex="0"
      onClick={() => void copy()}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void copy();
        }
      }}
      aria-label={t('detail.totpCopy')}
    >
      <span class="totp-code">{code() ? formatCode(code()) : '------'}</span>
      <span class="totp-ring" classList={{ low: low() }} role="timer">
        <svg viewBox="0 0 36 36" aria-hidden="true">
          <circle class="totp-ring-track" cx="18" cy="18" r={RING_RADIUS} />
          <circle
            class="totp-ring-progress"
            cx="18"
            cy="18"
            r={RING_RADIUS}
            stroke-dasharray="100"
            stroke-dashoffset={100 - fraction() * 100}
          />
        </svg>
        <span class="totp-ring-count">{remaining()}</span>
      </span>
    </div>
  );
}

function formatCode(code: string): string {
  const middle = Math.ceil(code.length / 2);
  return `${code.slice(0, middle)} ${code.slice(middle)}`;
}

function confirmDelete(item: VaultItem): void {
  showDialog(
    t('dialog.deleteItem.title'),
    <>
      <p class="dialog-desc">{t('dialog.deleteItem.body', { name: item.title })}</p>
      <div class="dialog-actions">
        <button class="btn btn-ghost" onClick={hideDialog}>{t('common.cancel')}</button>
        <button class="btn btn-danger" onClick={() => {
          hideDialog();
          void actions.remove(item.id).catch((error) => notify.error(t(errorKey(error))));
        }}>{t('common.delete')}</button>
      </div>
    </>,
  );
}

function linkFor(value: string): string {
  return value.includes('://') ? value : `https://${value}`;
}
