import { createSignal, Show } from 'solid-js';
import { t } from '../core/locale';
import CopyButton from './copy-button';

export default function FogField(props: { value: string }) {
  const [revealed, setRevealed] = createSignal(false);

  function toggle() {
    setRevealed((value) => !value);
  }

  return (
    <div class="fog-field">
      <span
        class="fog-text font-mono"
        role="button"
        tabindex="0"
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') toggle();
        }}
      >
        {revealed() ? props.value : '••••••••'}
      </span>
      <CopyButton value={() => props.value} />
      <Show when={!revealed()}>
        <span class="fog-field-hint">{t('fog.show')}</span>
      </Show>
    </div>
  );
}
