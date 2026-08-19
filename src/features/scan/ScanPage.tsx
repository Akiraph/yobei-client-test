import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { IScannerControls } from '@zxing/browser';
import { errorKey } from '../../core/errors';
import { scanQrCode } from '../../core/qr';
import { t } from '../../core/locale';
import { IconBack, IconScan } from '../../ui/icons';
import { notify } from '../../ui/notifications';

interface ScanPageProps {
  onResult: (value: string) => void | Promise<void>;
  onClose: () => void;
}

export default function ScanPage(props: ScanPageProps) {
  let video: HTMLVideoElement | undefined;
  let controls: IScannerControls | undefined;
  let tracks: MediaStreamTrack[] = [];
  let active = true;
  let settled = false;
  const [starting, setStarting] = createSignal(false);
  const [cameraStarted, setCameraStarted] = createSignal(false);
  const [error, setError] = createSignal('');

  function stopCamera() {
    controls?.stop();
    controls = undefined;
    for (const track of tracks) {
      track.removeEventListener('ended', onTrackEnded);
      track.stop();
    }
    tracks = [];
    if (video) video.srcObject = null;
    setCameraStarted(false);
  }

  function onTrackEnded() {
    // While hidden the camera is released by us and restarted on return, so
    // an ended track there is expected rather than an error.
    if (!active || settled || document.hidden) return;
    // The camera was taken away while the page stayed visible (another app,
    // or the system reclaiming the device). Surface it instead of freezing.
    stopCamera();
    const message = t('error.qrFailed');
    setError(message);
    notify.error(message);
  }

  function watchStream() {
    const stream = video?.srcObject as MediaStream | null | undefined;
    if (!stream) return;
    tracks = stream.getTracks();
    for (const track of tracks) track.addEventListener('ended', onTrackEnded);
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
    if (!active || settled || starting() || cameraStarted()) return;
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
      if (!active || settled || document.hidden) {
        // The page went away while the camera was starting; release it again.
        stopCamera();
        return;
      }
      watchStream();
      setCameraStarted(true);
    } catch (caught) {
      stopCamera();
      if (active && !settled) {
        const message = t(errorKey(caught, 'unsupported_platform'));
        setError(message);
        notify.error(message);
      }
    } finally {
      if (active) setStarting(false);
    }
  }

  function onVisibilityChange() {
    if (!active || settled) return;
    if (document.hidden) {
      // The OS reclaims the camera once the app is backgrounded, which leaves
      // a dead stream (and a frozen last frame) behind. Release it eagerly and
      // restart from scratch when the app comes back to the foreground.
      stopCamera();
    } else {
      void start();
    }
  }

  onMount(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    void start();
  });

  onCleanup(() => {
    active = false;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    stopCamera();
  });

  return (
    <div class="scan-page" classList={{ ready: cameraStarted() }}>
      <video ref={video} class="scan-camera" muted autoplay playsinline aria-label={t('qr.scanCode')} />
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
