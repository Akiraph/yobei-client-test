import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { IconChevronDown } from './Icon';

interface Opt { v: number | string; label: string }

interface Props {
  value: () => number | string;
  options: Opt[];
  onChange: (v: number | string) => void;
  class?: string;
  ariaLabel?: string;
}

export function CustomSelect(p: Props) {
  const [open, setOpen] = createSignal(false);
  let btnRef: HTMLButtonElement | undefined;
  let panelRef: HTMLDivElement | undefined;

  const close = () => setOpen(false);
  const toggle = () => setOpen((o) => !o);

  const select = (v: number | string) => {
    p.onChange(v);
    close();
  };

  const label = () => p.options.find((o) => o.v === p.value())?.label ?? '';

  const onDocClick = (e: MouseEvent) => {
    if (open() && !btnRef?.contains(e.target as Node) && !panelRef?.contains(e.target as Node)) {
      close();
    }
  };
  onMount(() => {
    document.addEventListener('click', onDocClick);
    onCleanup(() => document.removeEventListener('click', onDocClick));
  });

  const selectedIdx = () => p.options.findIndex((o) => o.v === p.value());

  return (
    <div class={`custom-select${p.class ? ` ${p.class}` : ''}`}>
      <button
        ref={btnRef}
        type="button"
        class="custom-select-trigger"
        onClick={toggle}
        onKeyDown={(event) => event.key === 'Escape' && close()}
        aria-label={p.ariaLabel}
        aria-expanded={open()}
      >
        <span class="custom-select-label">{label()}</span>
        <IconChevronDown class="custom-select-chevron" classList={{ open: open() }} size={14} />
      </button>
      <Show when={open()}>
        <div ref={panelRef} class="custom-select-panel">
          <For each={p.options}>
            {(o, i) => (
              <button
                type="button"
                class="custom-select-option"
                classList={{ selected: i() === selectedIdx() }}
                onKeyDown={(event) => event.key === 'Escape' && close()}
                onClick={() => select(o.v)}
              >
                {o.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
