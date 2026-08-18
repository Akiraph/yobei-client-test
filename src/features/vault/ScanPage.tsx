import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { IScannerControls } from '@zxing/browser';
import { errorKey } from '../../core/errors';
import { scanQrCode } from '../../core/qr';
import { t } from '../../core/locale';
import { IconBack, IconScan } from '../../ui/icons';
import { notify } from '../../ui/notifications';

interface ScanPageProps {
  label: string;
  onResult: (value: string) => void | Promise<void>;
  onClose: () => void;
}

export default function ScanPage(props: ScanPageProps) {
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

  function finish(value: string) {
    if (settled) return;
    settled = true;
    stopCamera();
    props.onClose();
    void Promise.resolve(props.onResult(value)).catch((caught) => {
      notify.error(t(errorKey(caught, 'invalid_qr')));
    });
  }

  function close() {
    if (settled) return;
    settled = true;
    stopCamera();
    props.onClose();
  }

  async function start() {
    if (starting() || cameraStarted()) return;
    setStarting(true);
    setError('');
    try {
      controls = await scanQrCode(
        async () => {
          if (!video) throw new Error('camera_unavailable');
          return video;
        },
        finish,
      );
      if (!active) {
        stopCamera();
        return;
      }
      setCameraStarted(true);
    } catch (caught) {
      stopCamera();
      if (active) {
        setCameraStarted(false);
        const message = t(errorKey(caught, 'unsupported_platform'));
        setError(message);
        notify.error(message);
      }
    } finally {
      if (active) setStarting(false);
    }
  }

  onMount(() => void start());
  onCleanup(() => {
    active = false;
    stopCamera();
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
        <Show when={error()}>
          <button type="button" class="btn btn-primary scan-start" onClick={() => void start()} disabled={starting()}>
            <IconScan size={16} />
            {starting() ? t('common.loading') : t('common.retry')}
          </button>
        </Show>
      </div>
    </div>
  );
}
