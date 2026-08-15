import { For, createMemo, createSignal } from 'solid-js';

interface PinInputProps {
  value: string;
  length?: number;
  onInput: (value: string) => void;
  onComplete?: () => void;
  autofocus?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}

/** Phone-OTP style digit input: six boxes with a dot per entered digit. */
export function PinInput(props: PinInputProps) {
  const length = props.length ?? 6;
  const [focused, setFocused] = createSignal(false);
  let inputRef: HTMLInputElement | undefined;

  const cells = createMemo(() =>
    Array.from({ length }, (_, index) => ({
      filled: index < props.value.length,
      current: focused() && index === props.value.length,
    })),
  );

  const handleInput = (event: Event) => {
    const target = event.currentTarget as HTMLInputElement;
    const digits = target.value.replace(/\D/g, '').slice(0, length);
    props.onInput(digits);
    if (digits.length === length) props.onComplete?.();
  };

  return (
    <div class="pin-input" classList={{ disabled: props.disabled }} onClick={() => !props.disabled && inputRef?.focus()}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        maxLength={length}
        autocomplete="off"
        enterkeyhint="done"
        class="pin-input-hidden"
        value={props.value}
        onInput={handleInput}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autofocus={props.autofocus}
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
