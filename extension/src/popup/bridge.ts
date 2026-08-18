import type { ExtensionErrorCode } from '../lib/errors';

export interface BridgeResponse {
  ok?: boolean;
  code?: ExtensionErrorCode;
  [key: string]: unknown;
}

export function send(message: unknown): Promise<BridgeResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, code: 'extension_unavailable' });
        return;
      }
      resolve((response as BridgeResponse | undefined) ?? { ok: false, code: 'extension_unavailable' });
    });
  });
}
