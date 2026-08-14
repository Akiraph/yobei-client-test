import { createSignal, Show } from 'solid-js';
import { IconCopy, IconCheck } from './Icon';
import { copyText } from '../lib/clipboard';
import { t } from '../lib/i18n';
import { notifyError } from '../lib/notify';
import { errorMessage } from '../lib/errors';

interface Props {
  value: () => string;
  size?: number;
}

export default function CopyButton(props: Props) {
  const [copied, setCopied] = createSignal(false);

  async function handleCopy(e: MouseEvent) {
    e.stopPropagation();
    try {
      await copyText(props.value());
    } catch (error) {
      notifyError(errorMessage(error));
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      class={`icon-btn reveal-on-hover${copied() ? ' copied' : ''}`}
      onClick={handleCopy}
      title={copied() ? t('copy.copied') : t('copy.copy')}
      aria-label={copied() ? t('copy.copied') : t('copy.copy')}
    >
      <Show when={copied()} fallback={<IconCopy size={props.size ?? 14} />}>
        <IconCheck size={props.size ?? 14} />
      </Show>
    </button>
  );
}
