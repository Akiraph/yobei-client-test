import { Show, For, createSignal, createEffect, onCleanup } from 'solid-js';
import { selectedItem, selectedItemContent } from '../lib/store';
import { computeTotp } from '../lib/ipc';
import { copyText } from '../lib/clipboard';
import { showDialog, hideDialog } from '../lib/dialog';
import { errorMessage } from '../lib/errors';
import FogField from './FogField';
import CopyButton from './CopyButton';
import { IconBack, IconNote, IconPencil, IconTrash } from './Icon';
import SiteIcon from './SiteIcon';
import { t } from '../lib/i18n';

interface Props {
  onBack?: () => void;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
}

export default function ItemDetail(props: Props) {
  const item = selectedItem;
  const content = selectedItemContent;

  function confirmDelete() {
    const it = item();
    if (!it) return;
    showDialog(
      t('dialog.deleteItem.title'),
      <>
        <p class="dialog-desc">{t('dialog.deleteItem.body', { name: it.title })}</p>
        <div class="dialog-actions">
          <button class="btn btn-ghost" onClick={hideDialog}>{t('common.cancel')}</button>
          <button class="btn btn-danger" onClick={async () => {
            hideDialog();
            props.onDelete?.(it.id);
          }}>
            {t('common.delete')}
          </button>
        </div>
      </>
    );
  }

  return (
    <Show when={item()} fallback={
      <div class="detail-empty">
        <p>{t('detail.select')}</p>
      </div>
    }>
      {(it) => {
        const c = content;
        return (
          <div class="detail-pane">
            <div class="detail-scroll">
              <div class="detail-header">
                <Show when={props.onBack}>
                  <button class="icon-btn detail-back" onClick={props.onBack} aria-label={t('common.back')}>
                    <IconBack size={16} />
                  </button>
                </Show>
                <div class="detail-icon-row">
                  <Show when={it().type === 'note'} fallback={<SiteIcon title={it().title} url={c()?.url} class="detail-icon" />}>
                    <div class="detail-icon"><IconNote size={20} /></div>
                  </Show>
                  <Show when={props.onEdit}>
                    <button class="icon-btn" onClick={() => props.onEdit!(it().id)} title={t('common.edit')} aria-label={t('common.edit')}>
                      <IconPencil size={16} />
                    </button>
                  </Show>
                  <Show when={props.onDelete}>
                    <button class="icon-btn danger" onClick={confirmDelete} title={t('common.delete')} aria-label={t('common.delete')}>
                      <IconTrash size={16} />
                    </button>
                  </Show>
                </div>
                <div class="detail-title font-serif">{it().title}</div>
                <Show when={c()?.url}>
                  <a class="detail-url" href={c()!.url!.includes('://') ? c()!.url : `https://${c()!.url}`} target="_blank" rel="noreferrer">
                    {c()!.url}
                  </a>
                </Show>
              </div>

              <Show when={it().type === 'login'}>
                <div class="detail-section">
                  <Show when={c()?.username}>
                    <div class="field-group">
                      <div class="field-label">{t('detail.username')}</div>
                      <div class="field-value">
                        <span class="field-text">{c()!.username}</span>
                        <CopyButton value={() => c()!.username!} />
                      </div>
                    </div>
                  </Show>

                  <Show when={c()?.password}>
                    <div class="field-group">
                      <div class="field-label">{t('detail.password')}</div>
                      <FogField value={c()!.password!} />
                      <StrengthBar password={c()!.password!} />
                    </div>
                  </Show>

                  <Show when={c()?.totp}>
                    <div class="field-group">
                      <div class="field-label">{t('detail.totp')}</div>
                      <TotpDisplay secret={c()!.totp!} />
                    </div>
                  </Show>

                  <Show when={c()?.recoveryCodes}>
                    <div class="field-group">
                      <div class="field-label">{t('detail.recoveryCodes')}</div>
                      <FogField value={c()!.recoveryCodes!} />
                    </div>
                  </Show>

                  <Show when={(c()?.passkeys?.length ?? 0) > 0}>
                    <div class="field-group">
                      <div class="field-label">{t('detail.passkeys')}</div>
                      <FogField value={c()!.passkeys!.join('\n')} />
                    </div>
                  </Show>
                </div>
              </Show>

              <Show when={it().type === 'note'}>
                <div class="detail-section">
                  <div class="field-label">{t('editor.content')}</div>
                  <div class="note-body">
                    <FogField value={c()?.notes ?? ''} />
                  </div>
                </div>
              </Show>

              <Show when={c()?.notes && it().type === 'login'}>
                <div class="detail-section">
                  <div class="field-label">{t('detail.notes')}</div>
                  <div class="detail-notes">{c()!.notes}</div>
                </div>
              </Show>

              <Show when={it().id === '1' || it().id === '3'}>
                <div class="detail-section">
                  <div class="security-note attention">
                    {t('detail.securityWarning')}
                  </div>
                </div>
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

function StrengthBar(props: { password: string }) {
  const score = () => {
    const p = props.password;
    let s = 0;
    if (p.length >= 12) s++;
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
    if (/\d/.test(p)) s++;
    if (/[^a-zA-Z0-9]/.test(p)) s++;
    return Math.max(1, s);
  };
  const level = () => (score() >= 4 ? 'filled' : score() >= 3 ? 'filled medium' : 'filled weak');

  return (
    <div class="strength-bar" aria-label={t('detail.passwordStrength', { score: score() })}>
      <For each={[1, 2, 3, 4]}>
        {(i) => <div class={`strength-seg${i <= score() ? ' ' + level() : ''}`} />}
      </For>
    </div>
  );
}

function TotpDisplay(props: { secret: string }) {
  const [code, setCode] = createSignal('');
  const [copied, setCopied] = createSignal(false);
  const [offset, setOffset] = createSignal(0);
  const [error, setError] = createSignal('');

  const R = 10;
  const CIRC = 2 * Math.PI * R;

  const displayCode = () => {
    const c = code();
    return c.length === 6 ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
  };

  createEffect(() => {
    props.secret;
    let period = 30;
    let cancelled = false;

    async function refresh() {
      try {
        const r = await computeTotp(props.secret);
        if (cancelled) return;
        setCode(r.code);
        setError('');
        period = r.period || 30;
      } catch (error) {
        if (cancelled) return;
        setError(errorMessage(error, 'invalid_totp'));
      }
    }

    refresh();
    const tick = () => {
      const s = new Date().getSeconds() % period;
      setOffset(CIRC * (1 - s / period));
      if (s === 0) refresh();
    };
    tick();
    const t = setInterval(tick, 1000);
    onCleanup(() => {
      cancelled = true;
      clearInterval(t);
    });
  });

  function copy() {
    copyText(code()).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div
      class={`totp-display${copied() ? ' copied' : ''}`}
      onClick={copy}
      role="button"
      tabindex="0"
      onKeyDown={(e) => e.key === 'Enter' && copy()}
      title={copied() ? t('detail.totpCopied') : t('detail.clickToCopy')}
      aria-label={`${t('detail.totp')} ${displayCode()}`}
    >
      <Show when={error()} fallback={<span class="totp-code">{copied() ? t('detail.totpCopied') : displayCode()}</span>}>
        <span class="totp-code totp-error">{error()}</span>
      </Show>
      <div class="totp-timer">
        <svg width="24" height="24" viewBox="0 0 24 24">
          <circle class="timer-bg" cx="12" cy="12" r={R} />
          <circle class="timer-fill" cx="12" cy="12" r={R}
            stroke-dasharray={String(CIRC)}
            stroke-dashoffset={offset()} />
        </svg>
      </div>
    </div>
  );
}
