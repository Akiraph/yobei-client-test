import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { DecryptedItem, PendingPasswordCapture, PendingRecoveryCapture, SessionSnapshot } from '../background/session';
import { errorText, initializeLocale, nextLocaleDisplayName, t, toggleLocale } from '../lib/i18n';
import type { ExtensionErrorCode } from '../lib/errors';
import { send, type BridgeResponse } from './bridge';
import { mergePending, type PendingCapture } from './pending';
import './popup.css';

const POLL_INTERVAL = 1500;
const FEEDBACK_DURATION = 1800;

interface Notice {
  kind: 'success' | 'error';
  text: string;
}

function isSnapshot(response: BridgeResponse): response is BridgeResponse & SessionSnapshot {
  return Array.isArray(response.items) && typeof response.paired === 'boolean';
}

function Popup() {
  const [status, setStatus] = createSignal<SessionSnapshot | null>(null);
  const [pending, setPending] = createSignal<PendingCapture[]>([]);
  const [notice, setNotice] = createSignal<Notice | null>(null);
  const [confirmClear, setConfirmClear] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [generatorOpen, setGeneratorOpen] = createSignal(false);
  const [generatorMode, setGeneratorMode] = createSignal<'random' | 'passphrase' | 'pin'>('random');
  const [generatedPassword, setGeneratedPassword] = createSignal('');
  const [generatedCopied, setGeneratedCopied] = createSignal(false);
  let pollTimer: number | undefined;
  let noticeTimer: number | undefined;
  let copiedTimer: number | undefined;

  const loginItems = createMemo(() => (status()?.items ?? []).filter((item) => item.itemType === 'login'));
  const passwordPending = createMemo(() => pending().filter((item) => item.kind === 'password'));
  const recoveryPending = createMemo(() => pending().filter((item) => item.kind === 'recovery'));

  function showNotice(kind: Notice['kind'], text: string) {
    if (noticeTimer) window.clearTimeout(noticeTimer);
    setNotice({ kind, text });
    noticeTimer = window.setTimeout(() => setNotice(null), FEEDBACK_DURATION);
  }

  async function refresh() {
    const snapshot = await send({ type: 'session_status' });
    if (!isSnapshot(snapshot)) {
      if (snapshot.code) showNotice('error', errorText(snapshot.code));
      return;
    }

    setStatus(snapshot);
    if (!snapshot.unlocked) {
      setPending([]);
      return;
    }

    const [passwords, recoveries] = await Promise.all([
      send({ type: 'pending_password' }),
      send({ type: 'pending_recovery' }),
    ]);
    setPending(mergePending(passwords, recoveries));
  }

  async function saveCapture(pendingItem: PendingCapture, itemId?: string) {
    const { kind, capture } = pendingItem;
    setBusy(true);
    const response = await send(itemId
      ? { type: `save_pending_${kind}`, captureId: capture.id, itemId }
      : { type: `create_pending_${kind}`, captureId: capture.id, title: hostOf(capture.url) || t('popup.recoveryAccount') });
    setBusy(false);

    if (!response.ok) {
      showNotice('error', errorText(response.code));
      return;
    }

    setPending((items) => items.filter((item) => item.capture.id !== capture.id));
    showNotice('success', t(kind === 'password' ? 'popup.passwordSaved' : 'popup.recoverySaved'));
    if (!itemId) await refresh();
  }

  onMount(async () => {
    await initializeLocale();
    await refresh();
    pollTimer = window.setInterval(() => void refresh(), POLL_INTERVAL);
  });

  onCleanup(() => {
    if (pollTimer) window.clearInterval(pollTimer);
    if (noticeTimer) window.clearTimeout(noticeTimer);
    if (copiedTimer) window.clearTimeout(copiedTimer);
  });

  async function pair(event: Event) {
    event.preventDefault();
    const input = document.getElementById('pair-code');
    if (!(input instanceof HTMLInputElement)) return;
    setBusy(true);
    const response = await send({ type: 'pair', code: input.value });
    setBusy(false);
    if (isSnapshot(response)) {
      setStatus(response);
      showNotice('success', t('notify.paired'));
    } else {
      showNotice('error', errorText(response.code));
    }
  }

  async function clearPairing() {
    setBusy(true);
    const response = await send({ type: 'clear_pairing' });
    setBusy(false);
    setConfirmClear(false);
    if (response.ok) {
      setStatus(null);
      await refresh();
      showNotice('success', t('notify.pairingRemoved'));
    } else {
      showNotice('error', errorText(response.code));
    }
  }

  async function generate() {
    const mode = generatorMode();
    const opts = mode === 'random'
      ? { length: 16, useLower: true, useUpper: true, useDigits: true, useSymbols: true }
      : mode === 'passphrase'
        ? { words: 4, separator: '-' }
        : { length: 6 };
    const response = await send({ type: 'generate_password', mode, opts: JSON.stringify(opts) });
    if (!response.ok) {
      showNotice('error', t('error.generate'));
      return;
    }
    setGeneratedPassword(String(response.password ?? ''));
    setGeneratedCopied(false);
    showNotice('success', t('notify.generated'));
  }

  async function copyGenerated() {
    if (!generatedPassword()) return;
    try {
      await navigator.clipboard.writeText(generatedPassword());
      setGeneratedCopied(true);
      showNotice('success', t('notify.copied'));
      if (copiedTimer) window.clearTimeout(copiedTimer);
      copiedTimer = window.setTimeout(() => setGeneratedCopied(false), FEEDBACK_DURATION);
    } catch {
      showNotice('error', t('error.copy'));
    }
  }

  const snapshot = () => status();

  return (
    <main class="popup">
      <header class="popup-head">
        <h1 class="popup-title">{t('app.name')}</h1>
        <span class="popup-sub">Yobei</span>
        <span class="dot" classList={{ 'dot-off': !snapshot() || !snapshot()?.paired || !snapshot()?.unlocked, 'dot-on': !!snapshot()?.paired && !!snapshot()?.unlocked }} />
        <button class="lang-btn" type="button" onClick={toggleLocale} aria-label={t('app.language')}>
          <span class="lang-label">{nextLocaleDisplayName()}</span>
        </button>
      </header>

      <Show when={notice()}>{(current) => <div class={`notice ${current().kind}`}>{current().text}</div>}</Show>

      <Show when={snapshot() == null || snapshot()?.connecting} fallback={
        <Show when={!snapshot()!.paired} fallback={
          <Show
            when={!snapshot()!.unlocked}
            fallback={
              <ActiveBody
                pending={pending()}
                passwordPending={passwordPending()}
                recoveryPending={recoveryPending()}
                loginItems={loginItems()}
                busy={busy()}
                onSave={saveCapture}
                generatorOpen={generatorOpen()}
                setGeneratorOpen={setGeneratorOpen}
                generatorMode={generatorMode()}
                setGeneratorMode={setGeneratorMode}
                generatedPassword={generatedPassword()}
                generatedCopied={generatedCopied()}
                onGenerate={() => void generate()}
                onCopy={() => void copyGenerated()}
                onClear={() => setConfirmClear(true)}
              />
            }
          >
            <div class="popup-body">
              <div class="empty">
                <p class="popup-status">{t('popup.locked')}</p>
                <p class="popup-status hint">{t('popup.unlockHint')}</p>
                <button class="btn" onClick={() => void refresh()}>{t('popup.retry')}</button>
                <button class="btn ghost" onClick={() => setConfirmClear(true)}>{t('popup.clearPairing')}</button>
              </div>
            </div>
          </Show>
        }>
          <form class="popup-body pair" onSubmit={(event) => void pair(event)}>
            <p class="pair-hint">{t('popup.pairHint')}</p>
            <input id="pair-code" class="pair-input" maxLength={8} placeholder={t('popup.pairCodePlaceholder')} required />
            <button class="btn primary" type="submit" disabled={busy()}>
              {busy() ? t('popup.connecting') : t('popup.pair')}
            </button>
            <p class="pair-path">{t('popup.pairPath')}</p>
          </form>
        </Show>
      }>
        <p class="popup-status body">{t('popup.connecting')}</p>
      </Show>

      <Show when={confirmClear()}>
        <div class="dialog-backdrop">
          <section class="dialog" role="dialog" aria-modal="true">
            <h2>{t('dialog.removePairingTitle')}</h2>
            <p>{t('dialog.removePairingBody')}</p>
            <div class="dialog-actions">
              <button class="btn ghost" onClick={() => setConfirmClear(false)}>{t('action.cancel')}</button>
              <button class="btn danger" onClick={() => void clearPairing()}>{t('action.confirm')}</button>
            </div>
          </section>
        </div>
      </Show>
    </main>
  );
}

interface ActiveBodyProps {
  pending: PendingCapture[];
  passwordPending: PendingCapture[];
  recoveryPending: PendingCapture[];
  loginItems: DecryptedItem[];
  busy: boolean;
  onSave: (capture: PendingCapture, itemId?: string) => void;
  generatorOpen: boolean;
  setGeneratorOpen: (open: boolean) => void;
  generatorMode: 'random' | 'passphrase' | 'pin';
  setGeneratorMode: (mode: 'random' | 'passphrase' | 'pin') => void;
  generatedPassword: string;
  generatedCopied: boolean;
  onGenerate: () => void;
  onCopy: () => void;
  onClear: () => void;
}

function ActiveBody(props: ActiveBodyProps) {
  return (
    <div class="popup-body">
      <div class="empty"><p class="popup-status ok">{t('popup.active')}</p><p class="popup-status hint">{t('popup.activeHint')}</p></div>
      <div class="groups">
        <Show when={props.passwordPending.length > 0}>
          <p class="group-label">{t('popup.passwordPending')}</p>
          <For each={props.passwordPending}>
            {(item) => <PendingRow pending={item} items={props.loginItems} busy={props.busy} onSave={props.onSave} />}
          </For>
        </Show>
        <Show when={props.recoveryPending.length > 0}>
          <p class="group-label">{t('popup.recoveryPending')}</p>
          <For each={props.recoveryPending}>
            {(item) => <PendingRow pending={item} items={props.loginItems} busy={props.busy} onSave={props.onSave} />}
          </For>
        </Show>
      </div>
      <Generator {...props} />
      <button class="btn ghost clear-pairing" onClick={props.onClear}>{t('popup.clearPairing')}</button>
    </div>
  );
}

function PendingRow(props: { pending: PendingCapture; items: DecryptedItem[]; busy: boolean; onSave: (capture: PendingCapture, itemId?: string) => void }) {
  const candidates = () => {
    const ids = new Set(props.pending.capture.candidates.map((candidate) => candidate.id));
    const matching = props.items.filter((item) => ids.has(item.id));
    return matching.length ? matching : props.items;
  };
  return (
    <li class="recovery-pending">
      <div class="recovery-pending-title">{props.pending.capture.url || t('popup.recoveryAccount')}</div>
      <div class="recovery-pending-meta">{props.pending.capture.username || t('popup.noUsername')}</div>
      <div class="recovery-pending-actions">
        <For each={candidates()}>
          {(item) => (
            <button class="act" onClick={() => props.onSave(props.pending, item.id)} disabled={props.busy}>
              {item.title}
            </button>
          )}
        </For>
        <button class="act" onClick={() => props.onSave(props.pending)} disabled={props.busy}>
          {t('popup.createAccount')}
        </button>
      </div>
    </li>
  );
}

function Generator(props: ActiveBodyProps) {
  return (
    <footer class="gen">
      <Show when={props.generatorOpen}>
        <div class="gen-box">
          <div class="gen-modes">
            <For each={['random', 'passphrase', 'pin'] as const}>
              {(mode) => (
                <button
                  class={`gen-mode${props.generatorMode === mode ? ' on' : ''}`}
                  onClick={() => props.setGeneratorMode(mode)}
                >
                  {t(`popup.${mode}` as 'popup.random' | 'popup.passphrase' | 'popup.pin')}
                </button>
              )}
            </For>
          </div>
          <Show when={props.generatedPassword}>
            <div class="gen-out">
              <span class="gen-text">{props.generatedPassword}</span>
              <button class="act" onClick={props.onCopy}>
                {props.generatedCopied ? t('popup.copied') : t('popup.copy')}
              </button>
            </div>
          </Show>
          <button class="btn" onClick={props.onGenerate}>{t('popup.generate')}</button>
        </div>
      </Show>
      <button class="gen-toggle" onClick={() => props.setGeneratorOpen(!props.generatorOpen)}>
        {props.generatorOpen ? t('popup.closeGenerator') : t('popup.generator')}
      </button>
    </footer>
  );
}

function hostOf(url: string | undefined): string {
  try { return new URL(url ?? '').hostname; } catch { return ''; }
}

render(() => <Popup />, document.getElementById('root')!);
