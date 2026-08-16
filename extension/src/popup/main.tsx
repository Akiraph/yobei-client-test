import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { DecryptedItem, PendingPasswordCapture, PendingRecoveryCapture, SessionSnapshot } from '../background/session';
import { errorText, initializeLocale, nextLocaleDisplayName, t, toggleLocale } from '../lib/i18n';
import type { ExtensionErrorCode } from '../lib/errors';
import './popup.css';

const POLL_INTERVAL_MS = 1_500;
const FEEDBACK_DURATION_MS = 1_800;

interface ResponseMessage {
  ok?: boolean;
  code?: ExtensionErrorCode;
  items?: unknown;
  [key: string]: unknown;
}

interface Notice {
  kind: 'success' | 'error';
  text: string;
}

function send(message: unknown): Promise<ResponseMessage> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, code: 'extension_unavailable' });
        return;
      }
      resolve((response as ResponseMessage | undefined) ?? { ok: false, code: 'extension_unavailable' });
    });
  });
}

function isSnapshot(response: ResponseMessage): response is ResponseMessage & SessionSnapshot {
  return Array.isArray(response.items) && typeof response.paired === 'boolean';
}

function Popup() {
  const [status, setStatus] = createSignal<SessionSnapshot | null>(null);
  const [generatorOpen, setGeneratorOpen] = createSignal(false);
  const [generatorMode, setGeneratorMode] = createSignal<'random' | 'passphrase' | 'pin'>('random');
  const [generatedPassword, setGeneratedPassword] = createSignal('');
  const [generatedCopied, setGeneratedCopied] = createSignal(false);
  const [notice, setNotice] = createSignal<Notice | null>(null);
  const [confirmClear, setConfirmClear] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [pendingPassword, setPendingPassword] = createSignal<PendingPasswordCapture[]>([]);
  const [pendingRecovery, setPendingRecovery] = createSignal<PendingRecoveryCapture[]>([]);

  let pollTimer: number | undefined;
  let feedbackTimer: number | undefined;
  let generatedCopiedTimer: number | undefined;

  const showNotice = (kind: Notice['kind'], text: string) => {
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    setNotice({ kind, text });
    feedbackTimer = window.setTimeout(() => setNotice(null), FEEDBACK_DURATION_MS);
  };

  const refresh = async () => {
    const response = await send({ type: 'session_status' });
    if (isSnapshot(response)) {
      setStatus(response);
      if (response.unlocked) {
        const [passwordPending, recoveryPending] = await Promise.all([
          send({ type: 'pending_password' }),
          send({ type: 'pending_recovery' }),
        ]);
        if (passwordPending.ok && Array.isArray(passwordPending.captures)) {
          setPendingPassword(passwordPending.captures as PendingPasswordCapture[]);
        }
        if (recoveryPending.ok && Array.isArray(recoveryPending.captures)) {
          setPendingRecovery(recoveryPending.captures as PendingRecoveryCapture[]);
        }
      } else {
        setPendingPassword([]);
        setPendingRecovery([]);
      }
      return;
    }
    if (response.code) showNotice('error', errorText(response.code));
  };

  const loginItems = createMemo(() => (status()?.items ?? []).filter((item) => item.itemType === 'login'));

  const savePassword = async (capture: PendingPasswordCapture, itemId: string) => {
    setBusy(true);
    const response = await send({ type: 'save_pending_password', captureId: capture.id, itemId });
    setBusy(false);
    if (response.ok) {
      setPendingPassword((items) => items.filter((item) => item.id !== capture.id));
      showNotice('success', t('popup.passwordSaved'));
    } else {
      showNotice('error', errorText(response.code));
    }
  };

  const createPassword = async (capture: PendingPasswordCapture) => {
    setBusy(true);
    const title = hostOf(capture.url) || t('popup.recoveryAccount');
    const response = await send({ type: 'create_pending_password', captureId: capture.id, title });
    setBusy(false);
    if (response.ok) {
      setPendingPassword((items) => items.filter((item) => item.id !== capture.id));
      showNotice('success', t('popup.passwordSaved'));
      await refresh();
    } else {
      showNotice('error', errorText(response.code));
    }
  };

  const saveRecovery = async (capture: PendingRecoveryCapture, itemId: string) => {
    setBusy(true);
    const response = await send({ type: 'save_pending_recovery', captureId: capture.id, itemId });
    setBusy(false);
    if (response.ok) {
      setPendingRecovery((items) => items.filter((item) => item.id !== capture.id));
      showNotice('success', t('popup.recoverySaved'));
    } else {
      showNotice('error', errorText(response.code));
    }
  };

  const createRecovery = async (capture: PendingRecoveryCapture) => {
    setBusy(true);
    const title = hostOf(capture.url) || t('popup.recoveryAccount');
    const response = await send({ type: 'create_pending_recovery', captureId: capture.id, title });
    setBusy(false);
    if (response.ok) {
      setPendingRecovery((items) => items.filter((item) => item.id !== capture.id));
      showNotice('success', t('popup.recoverySaved'));
      await refresh();
    } else {
      showNotice('error', errorText(response.code));
    }
  };

  onMount(async () => {
    await initializeLocale();
    await refresh();
    pollTimer = window.setInterval(refresh, POLL_INTERVAL_MS);
  });

  onCleanup(() => {
    if (pollTimer) window.clearInterval(pollTimer);
    if (feedbackTimer) window.clearTimeout(feedbackTimer);
    if (generatedCopiedTimer) window.clearTimeout(generatedCopiedTimer);
  });

  const submitPair = async (event: Event) => {
    event.preventDefault();
    const input = document.getElementById('pair-code');
    if (!(input instanceof HTMLInputElement)) return;
    setBusy(true);
    const response = await send({ type: 'pair', code: input.value });
    setBusy(false);
    if (isSnapshot(response)) {
      setStatus(response);
      showNotice('success', t('notify.paired'));
      return;
    }
    showNotice('error', errorText(response.code));
  };

  const removePairing = async () => {
    setBusy(true);
    const response = await send({ type: 'clear_pairing' });
    setBusy(false);
    setConfirmClear(false);
    if (response.ok) {
      setStatus(null);
      await refresh();
      showNotice('success', t('notify.pairingRemoved'));
      return;
    }
    showNotice('error', errorText(response.code));
  };

  const generate = async () => {
    const mode = generatorMode();
    const options = JSON.stringify(
      mode === 'random'
        ? { length: 16, useLower: true, useUpper: true, useDigits: true, useSymbols: true }
        : mode === 'passphrase'
          ? { words: 4, separator: '-' }
          : { length: 6 },
    );
    const response = await send({ type: 'generate_password', mode, opts: options });
    if (!response.ok) {
      showNotice('error', t('error.generate'));
      return;
    }
    setGeneratedPassword(String(response.password ?? ''));
    setGeneratedCopied(false);
    showNotice('success', t('notify.generated'));
  };

  const copyGenerated = async () => {
    const password = generatedPassword();
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setGeneratedCopied(true);
      showNotice('success', t('notify.copied'));
      if (generatedCopiedTimer) window.clearTimeout(generatedCopiedTimer);
      generatedCopiedTimer = window.setTimeout(() => setGeneratedCopied(false), FEEDBACK_DURATION_MS);
    } catch {
      showNotice('error', t('error.copy'));
    }
  };

  const pendingCapture = (capture: PendingPasswordCapture | PendingRecoveryCapture) => {
    const candidates = () => {
      const ids = new Set(capture.candidates.map((candidate) => candidate.id));
      return loginItems().filter((item) => ids.has(item.id));
    };
    const isPassword = 'password' in capture;
    return (
      <li class="recovery-pending">
        <div class="recovery-pending-title">{capture.url || t('popup.recoveryAccount')}</div>
        <div class="recovery-pending-meta">{capture.username || t('popup.noUsername')}</div>
        <div class="recovery-pending-actions">
          <For each={candidates()}>
            {(item: DecryptedItem) => (
              <button class="act" onClick={() => void (isPassword ? savePassword(capture as PendingPasswordCapture, item.id) : saveRecovery(capture as PendingRecoveryCapture, item.id))} disabled={busy()}>
                {item.title}
              </button>
            )}
          </For>
          <Show when={candidates().length === 0}>
            <For each={loginItems()}>
              {(item: DecryptedItem) => (
                <button class="act" onClick={() => void (isPassword ? savePassword(capture as PendingPasswordCapture, item.id) : saveRecovery(capture as PendingRecoveryCapture, item.id))} disabled={busy()}>
                  {item.title}
                </button>
              )}
            </For>
          </Show>
          <button class="act" onClick={() => void (isPassword ? createPassword(capture as PendingPasswordCapture) : createRecovery(capture as PendingRecoveryCapture))} disabled={busy()}>
            {t('popup.createAccount')}
          </button>
        </div>
      </li>
    );
  };

  const activeBody = () => (
    <div class="popup-body">
      <div class="empty">
        <p class="popup-status ok">{t('popup.active')}</p>
        <p class="popup-status hint">{t('popup.activeHint')}</p>
      </div>

      <div class="groups">
        <Show when={pendingPassword().length > 0}>
          <p class="group-label">{t('popup.passwordPending')}</p>
          <For each={pendingPassword()}>{(capture) => pendingCapture(capture)}</For>
        </Show>
        <Show when={pendingRecovery().length > 0}>
          <p class="group-label">{t('popup.recoveryPending')}</p>
          <For each={pendingRecovery()}>{(capture) => pendingCapture(capture)}</For>
        </Show>
      </div>

      <footer class="gen">
        <Show when={generatorOpen()}>
          <div class="gen-box">
            <div class="gen-modes">
              {(['random', 'passphrase', 'pin'] as const).map((mode) => (
                <button
                  class={`gen-mode${generatorMode() === mode ? ' on' : ''}`}
                  onClick={() => {
                    setGeneratorMode(mode);
                    setGeneratedPassword('');
                  }}
                >
                  {t(`popup.${mode}` as 'popup.random' | 'popup.passphrase' | 'popup.pin')}
                </button>
              ))}
            </div>
            <Show when={generatedPassword()}>
              <div class="gen-out">
                <span class="gen-text">{generatedPassword()}</span>
                <button class="act" onClick={() => void copyGenerated()}>
                  {generatedCopied() ? t('popup.copied') : t('popup.copy')}
                </button>
              </div>
            </Show>
            <button class="btn" onClick={() => void generate()}>{t('popup.generate')}</button>
          </div>
        </Show>
        <button class="gen-toggle" onClick={() => setGeneratorOpen((value) => !value)}>
          {generatorOpen() ? t('popup.closeGenerator') : t('popup.generator')}
        </button>
      </footer>

      <button class="btn ghost clear-pairing" onClick={() => setConfirmClear(true)}>{t('popup.clearPairing')}</button>
    </div>
  );

  const snapshot = createMemo(() => status());

  return (
    <main class="popup">
      <header class="popup-head">
        <h1 class="popup-title">{t('app.name')}</h1>
        <span class="popup-sub">Yobei</span>
        <span
          class="dot"
          classList={{
            'dot-off': !snapshot() || snapshot()?.connecting || !snapshot()?.paired || !snapshot()?.unlocked,
            'dot-on': !!snapshot() && snapshot()?.paired && snapshot()?.unlocked,
          }}
          title={snapshot()?.unlocked ? t('popup.unlockedStatus') : t('popup.lockedStatus')}
        />
        <button class="lang-btn" type="button" onClick={toggleLocale} aria-label={t('app.language')}>
          <svg class="lang-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          <span class="lang-label">{nextLocaleDisplayName()}</span>
        </button>
      </header>

      <Show when={notice()}>
        {(current) => <div class={`notice ${current().kind}`}>{current().text}</div>}
      </Show>

      {snapshot() == null || snapshot()?.connecting ? (
        <p class="popup-status body">{t('popup.connecting')}</p>
      ) : !snapshot()!.paired ? (
        <form class="popup-body pair" onSubmit={submitPair}>
          <p class="pair-hint">{t('popup.pairHint')}</p>
          <input
            id="pair-code"
            class="pair-input"
            placeholder={t('popup.pairCodePlaceholder')}
            maxLength={8}
            autocapitalize="characters"
            autocomplete="one-time-code"
            spellcheck={false}
            required
          />
          <button class="btn primary" type="submit" disabled={busy()}>
            {busy() ? t('popup.connecting') : t('popup.pair')}
          </button>
          <p class="pair-path">{t('popup.pairPath')}</p>
        </form>
      ) : !snapshot()!.unlocked ? (
        <div class="popup-body">
          <div class="empty">
            <p class="popup-status">{t('popup.locked')}</p>
            <p class="popup-status hint">{t('popup.unlockHint')}</p>
            <button class="btn" onClick={() => void refresh()}>{t('popup.retry')}</button>
            <button class="btn ghost" onClick={() => setConfirmClear(true)}>{t('popup.clearPairing')}</button>
          </div>
        </div>
      ) : (
        activeBody()
      )}

      <Show when={confirmClear()}>
        <div class="dialog-backdrop" role="presentation">
          <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="clear-pairing-title">
            <h2 id="clear-pairing-title">{t('dialog.removePairingTitle')}</h2>
            <p>{t('dialog.removePairingBody')}</p>
            <div class="dialog-actions">
              <button class="btn ghost" onClick={() => setConfirmClear(false)} disabled={busy()}>
                {t('action.cancel')}
              </button>
              <button class="btn danger" onClick={() => void removePairing()} disabled={busy()}>
                {t('action.confirm')}
              </button>
            </div>
          </section>
        </div>
      </Show>
    </main>
  );
}

function hostOf(url: string | undefined): string {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return '';
  }
}

render(() => <Popup />, document.getElementById('root')!);
