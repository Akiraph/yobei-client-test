import { createSignal } from 'solid-js';
import { t } from '../core/locale';
import { copyText } from './clipboard';
import { IconCheck, IconCopy } from './icons';

export default function CopyButton(props: { value: () => string }) {
  const [copied, setCopied] = createSignal(false);

  async function copy() {
    try {
      await copyText(props.value());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard access can be denied by the browser.
    }
  }

  return (
    <button
      class="icon-btn copy-btn"
      onClick={() => void copy()}
      title={copied() ? t('detail.totpCopied') : t('common.copy')}
      aria-label={t('common.copy')}
    >
      {copied() ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
  );
}
