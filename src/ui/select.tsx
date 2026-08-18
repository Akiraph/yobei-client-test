import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { IconChevronDown } from './icons';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: () => string;
  options: SelectOption[];
  onChange: (value: string) => void;
  class?: string;
  ariaLabel?: string;
}

export default function Select(props: SelectProps) {
  const [open, setOpen] = createSignal(false);
  let trigger: HTMLButtonElement | undefined;
  let panel: HTMLDivElement | undefined;

  const selected = () => props.options.find((option) => option.value === props.value());

  function close() {
    setOpen(false);
  }

  function onDocumentClick(event: MouseEvent) {
    const target = event.target as Node;
    if (!trigger?.contains(target) && !panel?.contains(target)) close();
  }

  onMount(() => {
    document.addEventListener('click', onDocumentClick);
    onCleanup(() => document.removeEventListener('click', onDocumentClick));
  });

  function choose(value: string) {
    props.onChange(value);
    close();
  }

  return (
    <div class={`custom-select${props.class ? ` ${props.class}` : ''}`}>
      <button
        ref={trigger}
        class="custom-select-trigger"
        type="button"
        aria-label={props.ariaLabel}
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') close();
        }}
      >
        <span class="custom-select-label">{selected()?.label ?? ''}</span>
        <IconChevronDown class="custom-select-chevron" classList={{ open: open() }} size={14} />
      </button>
      <Show when={open()}>
        <div ref={panel} class="custom-select-panel" role="listbox">
          <For each={props.options}>
            {(option) => (
              <button
                class="custom-select-option"
                classList={{ selected: option.value === props.value() }}
                type="button"
                role="option"
                aria-selected={option.value === props.value()}
                onClick={() => choose(option.value)}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
