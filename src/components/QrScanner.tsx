import { createSignal, onCleanup, Show } from 'solid-js';
import type { IScannerControls } from '@zxing/browser';
import { errorMessage } from '../lib/errors';
import { decodeQrImage, scanQrCode } from '../lib/qr';
import { t } from '../lib/i18n';
import { IconScan, IconUpload } from './Icon';

interface Props {
  onResult: (value: string) => void;
  onError: (message: string) => void;
  label: string;
}

export function QrScanner(props: Props) {
  let video: HTMLVideoElement | undefined;
  let picker: HTMLInputElement | undefined;
  let controls: IScannerControls | undefined;
  let active = true;
  const [cameraOpen, setCameraOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  function finish(value: string) {
    controls?.stop();
    props.onResult(value);
  }

  async function mountCamera(): Promise<HTMLVideoElement> {
    setCameraOpen(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!video) throw new Error('Camera preview unavailable');
    return video;
  }

  async function scan() {
    setBusy(true);
    try {
      controls = await scanQrCode(mountCamera, finish);
      if (!active) controls?.stop();
    } catch (error) {
      if (active) props.onError(errorMessage(error, 'unsupported_platform'));
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setBusy(true);
    try {
      finish(await decodeQrImage(file));
    } catch {
      props.onError(t('error.qrImageFailed'));
    } finally {
      setBusy(false);
    }
  }

  onCleanup(() => {
    active = false;
    controls?.stop();
  });

  return (
    <div class="qr-scanner">
      <div class="qr-actions">
        <button class="btn btn-ghost" onClick={scan} disabled={cameraOpen() || busy()}>
          <IconScan size={15} /> {t('qr.scanCode')}
        </button>
        <button class="btn btn-ghost" onClick={() => picker?.click()} disabled={busy()}>
          <IconUpload size={15} /> {t('qr.uploadImage')}
        </button>
        <input ref={picker} class="qr-file-input" type="file" accept="image/*" onChange={upload} />
      </div>
      <Show when={cameraOpen()}>
        <video ref={video} class="transfer-camera" muted playsinline aria-label={props.label} />
      </Show>
    </div>
  );
}
