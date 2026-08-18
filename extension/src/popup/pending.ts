import type { PendingPasswordCapture, PendingRecoveryCapture } from '../background/session';
import type { BridgeResponse } from './bridge';

export type PendingCapture =
  | { kind: 'password'; capture: PendingPasswordCapture }
  | { kind: 'recovery'; capture: PendingRecoveryCapture };

function captures<T>(response: BridgeResponse): T[] | null {
  return response.ok && Array.isArray(response.captures) ? response.captures as T[] : null;
}

export function mergePending(password: BridgeResponse, recovery: BridgeResponse): PendingCapture[] {
  const result: PendingCapture[] = [];
  const passwords = captures<PendingPasswordCapture>(password);
  const recoveries = captures<PendingRecoveryCapture>(recovery);
  if (passwords) result.push(...passwords.map((capture) => ({ kind: 'password' as const, capture })));
  if (recoveries) result.push(...recoveries.map((capture) => ({ kind: 'recovery' as const, capture })));
  return result;
}
