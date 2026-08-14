import { createSignal, Show } from 'solid-js';
import CopyButton from './CopyButton';
import { t } from '../lib/i18n';

interface Props {
  value: string;
}

export default function FogField(props: Props) {
  const [revealed, setRevealed] = createSignal(false);

  return (
    <div class="fog-field">
      <span
        class={`fog-text font-mono${revealed() ? ' revealed' : ''}`}
        onClick={() => setRevealed(!revealed())}
        title={revealed() ? t('fog.hide') : t('fog.show')}
        role="button"
        tabindex="0"
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setRevealed(!revealed())}
      >
        {props.value}
      </span>
      <CopyButton value={() => props.value} />
      <Show when={!revealed()}>
        <span class="fog-field-hint">{t('fog.show')}</span>
      </Show>
    </div>
  );
}
