import { t } from './i18n';

export type ClientErrorCode =
  | 'desktop_only'
  | 'invalid_input'
  | 'cancelled'
  | 'invalid_password'
  | 'not_initialized'
  | 'vault_locked'
  | 'item_not_found'
  | 'invalid_qr'
  | 'crypto_failed'
  | 'storage_failed'
  | 'data_corrupt'
  | 'network_failed'
  | 'sync_conflict'
  | 'sync_failed'
  | 'pair_rejected'
  | 'transfer_pending'
  | 'transfer_expired'
  | 'rate_limited'
  | 'device_not_found'
  | 'bridge_unavailable'
  | 'biometric_unavailable'
  | 'unsupported_platform'
  | 'unsupported_browser'
  | 'extension_unavailable'
  | 'invalid_totp'
  | 'file_failed'
  | 'operation_failed';

export class ClientError extends Error {
  constructor(public readonly code: ClientErrorCode) {
    super(code);
    this.name = 'ClientError';
  }
}

const codeKeys: Record<ClientErrorCode, string> = {
  desktop_only: 'error.desktopOnly',
  invalid_input: 'error.invalidInput',
  cancelled: 'error.cancelled',
  invalid_password: 'error.unlockFailed',
  not_initialized: 'error.setupFailed',
  vault_locked: 'error.unlockFailed',
  item_not_found: 'error.itemNotFound',
  invalid_qr: 'error.qrFailed',
  crypto_failed: 'error.operationFailed',
  storage_failed: 'error.operationFailed',
  data_corrupt: 'error.dataCorrupt',
  network_failed: 'error.networkFailed',
  sync_conflict: 'error.syncConflict',
  sync_failed: 'error.syncFailed',
  pair_rejected: 'error.pairRejected',
  transfer_pending: 'error.transferPending',
  transfer_expired: 'error.transferExpired',
  rate_limited: 'error.rateLimited',
  device_not_found: 'error.deviceNotFound',
  bridge_unavailable: 'error.bridgeUnavailable',
  biometric_unavailable: 'error.biometricUnavailable',
  unsupported_platform: 'error.unsupportedPlatform',
  unsupported_browser: 'error.unsupportedBrowser',
  extension_unavailable: 'error.extensionUnavailable',
  invalid_totp: 'error.invalidTotp',
  file_failed: 'error.fileFailed',
  operation_failed: 'error.operationFailed',
};

function errorCode(error: unknown): ClientErrorCode | undefined {
  if (typeof error === 'string' && error in codeKeys) return error as ClientErrorCode;
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const value = (error as { code?: unknown }).code;
    if (typeof value !== 'string') return undefined;
    if (value in codeKeys) return value as ClientErrorCode;
  }
  return undefined;
}

export function clientError(error: unknown, fallback: ClientErrorCode): ClientError {
  return new ClientError(errorCode(error) ?? fallback);
}

export function errorMessage(error: unknown, fallback: ClientErrorCode = 'operation_failed'): string {
  return t(codeKeys[errorCode(error) ?? fallback]);
}
