import type { IScannerControls } from '@zxing/browser';

export async function scanQrCode(
  mountCamera: () => Promise<HTMLVideoElement>,
  onResult: (value: string) => void,
): Promise<IScannerControls> {
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
  const { BrowserQRCodeReader } = await import('@zxing/browser');
  const url = URL.createObjectURL(file);

  try {
    const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
    return result.getText();
  } finally {
    URL.revokeObjectURL(url);
  }
}
