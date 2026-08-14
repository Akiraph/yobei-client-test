export const errorCodes = [
  'invalid_input',
  'invalid_password',
  'vault_locked',
  'item_not_found',
  'data_corrupt',
  'bridge_unavailable',
  'bridge_disconnected',
  'bridge_auth_timeout',
  'pair_rejected',
  'extension_unavailable',
  'operation_failed',
] as const;

export type ExtensionErrorCode = typeof errorCodes[number];

const knownCodes = new Set<string>(errorCodes);

export function errorCode(value: unknown, fallback: ExtensionErrorCode): ExtensionErrorCode {
  const candidate = value instanceof Error ? value.message : value;
  return typeof candidate === 'string' && knownCodes.has(candidate)
    ? candidate as ExtensionErrorCode
    : fallback;
}

export function failure(value: unknown, fallback: ExtensionErrorCode): { ok: false; code: ExtensionErrorCode } {
  return { ok: false, code: errorCode(value, fallback) };
}
