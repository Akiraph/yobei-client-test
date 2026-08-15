import { createSignal, onCleanup, onMount, Show, For } from 'solid-js';
import { IconRefresh, IconX } from './Icon';
import CopyButton from './CopyButton';
import { generatePassword } from '../lib/ipc';
import type { PassgenOptions } from '../lib/ipc';
import { CustomSelect } from './CustomSelect';
import { t } from '../lib/i18n';
import { errorMessage } from '../lib/errors';

type Mode = 'random' | 'passphrase' | 'pin';
type Charset = { lower: boolean; upper: boolean; digits: boolean; symbols: boolean };

interface Props {
  onClose: () => void;
}

export default function Generator(props: Props) {
  const [mode, setMode] = createSignal<Mode>('random');
  const [len, setLen] = createSignal(20);
  const [charset, setCharset] = createSignal<Charset>({ lower: true, upper: true, digits: true, symbols: true });
  const [words, setWords] = createSignal(6);
  const [separator, setSeparator] = createSignal('-');
  const [capitalize, setCapitalize] = createSignal(false);
  const [output, setOutput] = createSignal('');
  const [history, setHistory] = createSignal<string[]>([]);
  const [error, setError] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  let reqId = 0;

  onCleanup(() => { reqId++; });

  function buildOpts(): PassgenOptions {
    if (mode() === 'passphrase') {
      return { words: words(), separator: separator(), capitalize: capitalize() };
    }
    if (mode() === 'pin') {
      return { length: len() };
    }
    const c = charset();
    return { length: len(), useLower: c.lower, useUpper: c.upper, useDigits: c.digits, useSymbols: c.symbols };
  }

  async function regenerate() {
    const my = ++reqId;
    setBusy(true);
    setError('');
    try {
      const value = await generatePassword(mode(), buildOpts());
      if (my !== reqId) return;
      if (!value) {
        setError(t('generator.errorCharset'));
        return;
      }
      setOutput(value);
      setHistory((h) => [value, ...h.filter((x) => x !== value)].slice(0, 10));
    } catch (error) {
      if (my !== reqId) return;
      setError(errorMessage(error, 'operation_failed'));
    } finally {
      if (my === reqId) setBusy(false);
    }
  }

  function switchMode(m: Mode) {
    setMode(m);
    setLen(m === 'pin' ? 6 : 20);
    setWords(6);
    regenerate();
  }

  function toggleChar(k: keyof Charset) {
    setCharset((c) => ({ ...c, [k]: !c[k] }));
    regenerate();
  }

  onMount(regenerate);

  return (
    <div class="generator-panel fog-reveal">
      <div class="generator-head">
        <div class="generator-title">{t('generator.title')}</div>
        <button class="icon-btn" onClick={props.onClose} aria-label={t('generator.close')}>
          <IconX size={16} />
        </button>
      </div>

      <div class="generator-output">
        <span class="gen-text font-mono">{output() || (busy() ? '…' : '')}</span>
        <div class="generator-actions">
          <button class="icon-btn" onClick={regenerate} disabled={busy()} title={t('generator.regenerate')} aria-label={t('generator.regenerate')}>
            <IconRefresh size={15} />
          </button>
          <CopyButton value={output} size={15} />
        </div>
      </div>

      <div class="generator-modes">
        <ModeBtn label={t('generator.modeRandom')} active={mode() === 'random'} onClick={() => switchMode('random')} />
        <ModeBtn label={t('generator.modePassphrase')} active={mode() === 'passphrase'} onClick={() => switchMode('passphrase')} />
        <ModeBtn label={t('generator.modePin')} active={mode() === 'pin'} onClick={() => switchMode('pin')} />
      </div>

      <Show when={mode() === 'random'}>
        <div class="gen-char-row">
          <span class="gen-label">{t('generator.charset')}</span>
          <ModeBtn label={t('generator.lower')} active={charset().lower} onClick={() => toggleChar('lower')} />
          <ModeBtn label={t('generator.upper')} active={charset().upper} onClick={() => toggleChar('upper')} />
          <ModeBtn label={t('generator.digits')} active={charset().digits} onClick={() => toggleChar('digits')} />
          <ModeBtn label={t('generator.symbols')} active={charset().symbols} onClick={() => toggleChar('symbols')} />
        </div>
      </Show>

      <Show when={mode() === 'passphrase'}>
        <div class="generator-slider-row">
          <span class="slider-label">{t('generator.words')}</span>
          <input
            type="range"
            class="gen-slider"
            min={3}
            max={12}
            value={words()}
            onInput={(e) => { setWords(+e.currentTarget.value); regenerate(); }}
            aria-label={t('generator.words')}
          />
          <span class="slider-value font-mono">{words()}</span>
        </div>
        <div class="gen-char-row">
          <span class="gen-label">{t('generator.separator')}</span>
          <CustomSelect
            value={separator}
            options={[
              { v: '-', label: t('generator.hyphen') },
              { v: '_', label: t('generator.underscore') },
              { v: ' ', label: t('generator.space') },
              { v: '', label: t('generator.none') },
            ]}
            onChange={(v) => { setSeparator(String(v)); regenerate(); }}
            ariaLabel={t('generator.separator')}
          />
          <ModeBtn label={t('generator.capitalize')} active={capitalize()} onClick={() => { setCapitalize(!capitalize()); regenerate(); }} />
        </div>
      </Show>

      <Show when={mode() !== 'passphrase'}>
        <div class="generator-slider-row">
          <span class="slider-label">{t('generator.length')}</span>
          <input
            type="range"
            class="gen-slider"
            min={mode() === 'pin' ? 4 : 8}
            max={mode() === 'pin' ? 12 : 64}
            value={len()}
            onInput={(e) => { setLen(+e.currentTarget.value); regenerate(); }}
            aria-label={t('generator.length')}
          />
          <span class="slider-value font-mono">{len()}</span>
        </div>
      </Show>

      <Show when={error()}>
        <div class="gen-error">{error()}</div>
      </Show>

      <Show when={history().length > 0}>
        <div class="gen-history">
          <div class="gen-label">{t('generator.history')}</div>
          <For each={history()}>
            {(item) => (
              <div class="gen-history-item">
                <span class="gen-history-text font-mono">{item}</span>
                <CopyButton value={() => item} size={13} />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function ModeBtn(p: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button class={`mode-btn${p.active ? ' active' : ''}`} onClick={p.onClick} aria-pressed={p.active}>
      {p.label}
    </button>
  );
}
