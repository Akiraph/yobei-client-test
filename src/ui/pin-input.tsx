import { For, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';

interface PinInputProps {
  value: string;
  onInput: (value: string) => void;
  onComplete?: () => void;
  autofocus?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

export default function PinInput(props: PinInputProps) {
  const [focused, setFocused] = createSignal(false);
  let input: HTMLInputElement | undefined;

  const cells = createMemo(() => Array.from({ length: 6 }, (_, index) => ({
    filled: index < props.value.length,
    current: focused() && index === props.value.length,
  })));

  createEffect(() => {
    if (!props.autofocus || props.disabled) return;
    const frame = requestAnimationFrame(() => input?.focus({ preventScroll: true }));
    onCleanup(() => cancelAnimationFrame(frame));
  });

  function update(event: Event) {
    const value = (event.currentTarget as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
    props.onInput(value);
    if (value.length === 6) props.onComplete?.();
  }

  return (
    <div class="pin-input" classList={{ disabled: props.disabled }} onClick={() => input?.focus()}>
      <input
        ref={input}
        class="pin-input-hidden"
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={props.value}
        onInput={update}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={props.disabled}
        aria-label={props.ariaLabel}
      />
      <For each={cells()}>
        {(cell) => (
          <div class="pin-cell" classList={{ filled: cell.filled, current: cell.current }}>
            <span class="pin-dot" />
          </div>
        )}
      </For>
    </div>
  );
}
