import type { IScannerControls } from '@zxing/browser';
import { captureQrFromScreen } from './ipc';
import { isDesktop } from './window';

export async function scanQrCode(
  mountCamera: () => Promise<HTMLVideoElement>,
  onResult: (value: string) => void,
): Promise<IScannerControls | undefined> {
  if (isDesktop()) {
    onResult(await captureQrFromScreen());
    return undefined;
  }

  const video = await mountCamera();
  const { BrowserQRCodeReader } = await import('@zxing/browser');
  const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 250 });
  return reader.decodeFromConstraints(
    { video: { facingMode: { ideal: 'environment' } }, audio: false },
    video,
    (result) => {
      if (result) onResult(result.getText());
    },
  );
}

export async function decodeQrImage(file: File): Promise<string> {
  const imageUrl = URL.createObjectURL(file);
  try {
    const { BrowserQRCodeReader } = await import('@zxing/browser');
    return (await new BrowserQRCodeReader().decodeFromImageUrl(imageUrl)).getText();
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

export async function saveQrCanvas(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => value ? resolve(value) : reject(new Error('QR image unavailable')), 'image/png');
  });
  const file = new File([blob], fileName, { type: 'image/png' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file] });
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
