import { onCleanup, onMount } from 'solid-js';
import type { IScannerControls } from '@zxing/browser';
import { scanQrCode } from '../../../lib/qr';
import { t } from '../../../lib/i18n';
import { errorMessage } from '../../../lib/errors';
import { notifyError } from '../../../lib/notify';
import { IconBack } from '../../../components/Icon';
import type { VaultFeature } from '../model';
import { addTotpFromUri } from '../totp';

interface Props {
  feature: VaultFeature;
}

export default function ScanPage(props: Props) {
  let video: HTMLVideoElement | undefined;
  let controls: IScannerControls | undefined;
  let active = true;
  let settled = false;

  function finish(uri: string) {
    if (settled) return;
    settled = true;
    controls?.stop();
    props.feature.closeScan();
    void addTotpFromUri(uri);
  }

  function close() {
    if (settled) return;
    settled = true;
    props.feature.closeScan();
  }

  async function mountCamera(): Promise<HTMLVideoElement> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (!video) throw new Error('Camera preview unavailable');
    return video;
  }

  onMount(() => {
    void (async () => {
      try {
        controls = await scanQrCode(mountCamera, finish);
        if (!active) controls?.stop();
      } catch (error) {
        if (active) {
          notifyError(errorMessage(error, 'unsupported_platform'));
          close();
        }
      }
    })();
  });

  onCleanup(() => {
    active = false;
    controls?.stop();
  });

  return (
    <div class="scan-page">
      <video ref={video} class="scan-camera" muted playsinline aria-label={t('list.scan')} />
      <div class="scan-frame" aria-hidden="true">
        <span class="scan-corner tl" />
        <span class="scan-corner tr" />
        <span class="scan-corner bl" />
        <span class="scan-corner br" />
        <div class="scan-line" />
      </div>
      <header class="scan-topbar">
        <button class="icon-btn scan-back" onClick={close} aria-label={t('common.back')}>
          <IconBack size={20} />
        </button>
      </header>
      <p class="scan-hint">{t('qr.scanCode')}</p>
    </div>
  );
}
