import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import type { IScannerControls } from '@zxing/browser';
import { scanQrCode } from '../lib/qr';
import { t } from '../lib/i18n';
import { errorMessage } from '../lib/errors';
import { notifyError } from '../lib/notify';
import { isDesktop } from '../lib/window';
import { IconBack, IconScan } from './Icon';

interface Props {
  label: string;
  onResult: (value: string) => void | Promise<void>;
  onClose: () => void;
}

export default function ScanPage(props: Props) {
  let video: HTMLVideoElement | undefined;
  let controls: IScannerControls | undefined;
  let active = true;
  let settled = false;
  const [starting, setStarting] = createSignal(false);
  const [cameraStarted, setCameraStarted] = createSignal(false);
  const [error, setError] = createSignal('');

  function stopCamera() {
    controls?.stop();
    controls = undefined;
    const stream = video?.srcObject as MediaStream | null | undefined;
    stream?.getTracks().forEach((track) => track.stop());
    if (video) video.srcObject = null;
  }

  function finish(uri: string) {
    if (settled) return;
    settled = true;
    stopCamera();
    props.onClose();
    void Promise.resolve(props.onResult(uri)).catch((caught) => {
      notifyError(errorMessage(caught));
    });
  }

  function close() {
    if (settled) return;
    settled = true;
    stopCamera();
    props.onClose();
  }

  async function mountCamera(): Promise<HTMLVideoElement> {
    if (!video) throw new Error('Camera preview unavailable');
    return video;
  }

  async function start() {
    if (starting() || cameraStarted()) return;
    setStarting(true);
    setError('');
    try {
      controls = await scanQrCode(mountCamera, finish);
      if (!active) {
        stopCamera();
        return;
      }
      setCameraStarted(true);
    } catch (caught) {
      stopCamera();
      if (active) {
        setCameraStarted(false);
        const message = errorMessage(caught, 'unsupported_platform');
        setError(message);
        notifyError(message);
      }
    } finally {
      if (active) setStarting(false);
    }
  }

  onCleanup(() => {
    active = false;
    stopCamera();
  });

  onMount(() => {
    if (!isDesktop()) void start();
  });

  return (
    <div class="scan-page" classList={{ ready: cameraStarted() }}>
      <video ref={video} class="scan-camera" muted autoplay playsinline aria-label={props.label} />
      <div class="scan-frame" aria-hidden="true">
        <span class="scan-corner tl" />
        <span class="scan-corner tr" />
        <span class="scan-corner bl" />
        <span class="scan-corner br" />
        <div class="scan-line" />
      </div>
      <header class="scan-topbar">
        <button type="button" class="icon-btn scan-back" onClick={close} aria-label={t('common.back')}>
          <IconBack size={20} />
        </button>
      </header>
      <p class="scan-hint">
        {starting() ? t('common.loading') : error() ? t('error.qrFailed') : t('qr.scanCode')}
      </p>
      <div class="scan-controls">
        <Show when={error()}>
          <div class="scan-error" role="alert">{error()}</div>
        </Show>
        <Show when={isDesktop() || error()}>
          <button type="button" class="btn btn-primary scan-start" onClick={() => void start()} disabled={starting()}>
            <IconScan size={16} />
            {starting() ? t('common.loading') : error() ? t('common.retry') : t('qr.scanCode')}
          </button>
        </Show>
      </div>
    </div>
  );
}
