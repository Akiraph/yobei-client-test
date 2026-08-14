import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { isDesktop } from '../lib/window';
import { saveQrCanvas } from '../lib/qr';
import { notifyError, notifyOk } from '../lib/notify';
import { t } from '../lib/i18n';
import { IconDownload } from './Icon';

interface Props {
  value: string;
  label: string;
}

export function QrCode(props: Props) {
  let canvas: HTMLCanvasElement | undefined;
  const [saving, setSaving] = createSignal(false);

  createEffect(() => {
    if (!canvas || !props.value) return;
    const target = canvas;
    void import('qrcode').then(({ default: QRCode }) => QRCode.toCanvas(target, props.value, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 240,
        color: { dark: '#111111', light: '#ffffff' },
      }));
  });

  onCleanup(() => {
    if (canvas) canvas.width = 0;
  });

  async function save() {
    if (!canvas) return;
    setSaving(true);
    try {
      await saveQrCanvas(canvas, 'yobei-device-transfer.png');
      notifyOk(t('qr.imageSaved'));
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') notifyError(t('error.fileFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="transfer-qr-wrap">
      <canvas ref={canvas} class="transfer-qr" role="img" aria-label={props.label} />
      <Show when={!isDesktop()}>
        <button class="btn btn-ghost" onClick={save} disabled={saving()}>
          <IconDownload size={15} /> {t('qr.saveImage')}
        </button>
      </Show>
    </div>
  );
}
