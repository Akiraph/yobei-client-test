import { errorCode, type ExtensionErrorCode } from '../lib/errors';

const WS_URL = 'ws://127.0.0.1:42610';
const SESSION_KEY = 'session';
const DEVICE_ID_KEY = 'deviceId';
const DEVICE_KEY_STORAGE = 'deviceKey';
const BRIDGE_PROTOCOL = 1;
const AUTH_TIMEOUT_MS = 5000;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_INDEX_ITEMS = 5000;
const MAX_INDEX_BYTES = 2 * 1024 * 1024;
const MAX_SECRET_BYTES = 16 * 1024;
const PENDING_RECOVERY_KEY = 'pendingRecoveryCaptures';
const PENDING_PASSWORD_KEY = 'pendingPasswordCaptures';
const PENDING_CAPTURE_KEY = 'pendingCaptureKey';
const MAX_PENDING_RECOVERY = 12;

export type SecretField = 'username' | 'password' | 'totp_code' | 'recovery_codes' | 'passkeys';

export interface SessionSnapshot {
  deviceId: string | null;
  paired: boolean;
  unlocked: boolean;
  connecting: boolean;
  items: DecryptedItem[];
  code: ExtensionErrorCode | null;
}

export interface DecryptedItem {
  id: string;
  itemType: string;
  title: string;
  username?: string;
  url?: string;
  hasPassword: boolean;
  hasTotp: boolean;
  hasRecoveryCodes: boolean;
  hasPasskeys: boolean;
}

export interface SecretItem {
  id: string;
  username?: string;
  password?: string;
  totp_code?: string;
  recovery_codes?: string;
  passkeys?: string[];
}

interface PersistedSession {
  deviceId: string | null;
  paired: boolean;
  code: ExtensionErrorCode | null;
}

interface BridgeItem {
  id: string;
  item_type: string;
  title: string;
  username?: string | null;
  url?: string | null;
  has_password: boolean;
  has_totp: boolean;
  has_recovery_codes: boolean;
  has_passkeys: boolean;
}

interface EncryptedMessage {
  type: 'index' | 'secret' | 'capture';
  request_id?: string;
  nonce?: string;
  ciphertext?: string;
}

const EMPTY: PersistedSession = { deviceId: null, paired: false, code: null };

let ws: WebSocket | null = null;
let connectPromise: Promise<void> | null = null;
let sessionKey: CryptoKey | null = null;
let items: DecryptedItem[] = [];
let connecting = false;
let requestCounter = 0;
let authWaiter: { resolve: () => void; reject: (error: Error) => void; timer: number } | null = null;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();
let refreshInFlight: Promise<DecryptedItem[]> | null = null;
let pendingCaptureKey: CryptoKey | null = null;

function b64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const result = new Uint8Array(left.length + right.length);
  result.set(left);
  result.set(right, left.length);
  return result;
}

async function readSession(): Promise<PersistedSession> {
  const result = await chrome.storage.local.get(SESSION_KEY);
  return { ...EMPTY, ...(result[SESSION_KEY] as Partial<PersistedSession> | undefined) };
}

async function writeSession(patch: Partial<PersistedSession>): Promise<void> {
  const current = await readSession();
  await chrome.storage.local.set({ [SESSION_KEY]: { ...current, ...patch } });
}

async function getPendingCaptureKey(): Promise<CryptoKey> {
  if (pendingCaptureKey) return pendingCaptureKey;
  const stored = await chrome.storage.local.get(PENDING_CAPTURE_KEY);
  const jwk = stored[PENDING_CAPTURE_KEY] as JsonWebKey | undefined;
  if (jwk) {
    try {
      pendingCaptureKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'AES-GCM' },
        false,
        ['decrypt', 'encrypt'],
      );
      return pendingCaptureKey;
    } catch {
      await chrome.storage.local.remove(PENDING_CAPTURE_KEY);
    }
  }
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['decrypt', 'encrypt'],
  ) as CryptoKey;
  const exported = await crypto.subtle.exportKey('jwk', key);
  await chrome.storage.local.set({ [PENDING_CAPTURE_KEY]: exported });
  pendingCaptureKey = key;
  return key;
}

async function getDeviceId(): Promise<string | null> {
  const result = await chrome.storage.local.get(DEVICE_ID_KEY);
  return typeof result[DEVICE_ID_KEY] === 'string' ? result[DEVICE_ID_KEY] : null;
}

async function ensureDeviceId(): Promise<string> {
  const existing = await getDeviceId();
  if (existing) return existing;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ [DEVICE_ID_KEY]: id });
  return id;
}

async function loadDeviceKeyJwk(): Promise<JsonWebKey> {
  const result = await chrome.storage.local.get(DEVICE_KEY_STORAGE);
  if (result[DEVICE_KEY_STORAGE]) return result[DEVICE_KEY_STORAGE] as JsonWebKey;
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  ) as CryptoKeyPair;
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  await chrome.storage.local.set({ [DEVICE_KEY_STORAGE]: privateJwk });
  return privateJwk;
}

async function publicKeyB64(jwk: JsonWebKey): Promise<string> {
  const publicJwk: JsonWebKey = { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y };
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
  return bytesToB64(new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)));
}

async function localPublicKey(): Promise<{ deviceId: string; pubkey: string }> {
  const jwk = await loadDeviceKeyJwk();
  return { deviceId: await ensureDeviceId(), pubkey: await publicKeyB64(jwk) };
}

function send(message: unknown): boolean {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(message));
  return true;
}

function waitForAuth(): Promise<void> {
  if (authWaiter) return Promise.reject(new Error('auth_request_in_progress'));
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      if (!authWaiter) return;
      authWaiter = null;
      reject(new Error('bridge_auth_timeout'));
    }, AUTH_TIMEOUT_MS);
    authWaiter = { resolve, reject, timer };
  });
}

function resolveAuth(): void {
  const waiter = authWaiter;
  authWaiter = null;
  if (waiter) globalThis.clearTimeout(waiter.timer);
  waiter?.resolve();
}

function rejectAuth(code: ExtensionErrorCode): void {
  const waiter = authWaiter;
  authWaiter = null;
  if (waiter) globalThis.clearTimeout(waiter.timer);
  waiter?.reject(new Error(code));
}

function rejectPending(code: ExtensionErrorCode): void {
  for (const [id, request] of pending) {
    globalThis.clearTimeout(request.timer);
    request.reject(new Error(code));
    pending.delete(id);
  }
}

async function rejectPairing(code: ExtensionErrorCode): Promise<void> {
  sessionKey = null;
  items = [];
  rejectAuth(code);
  rejectPending(code);
  await writeSession({ paired: false, code });
}

async function deriveSessionKey(serverPublicB64: string): Promise<CryptoKey> {
  const jwk = await loadDeviceKeyJwk();
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const serverPublic = await crypto.subtle.importKey(
    'raw',
    b64ToBytes(serverPublicB64),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: serverPublic },
    privateKey,
    256,
  );
  const extensionPublic = b64ToBytes(await publicKeyB64(jwk));
  const salt = concatBytes(b64ToBytes(serverPublicB64), extensionPublic);
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  const keyBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('yobei-bridge-v1') },
    hkdfKey,
    256,
  );
  return crypto.subtle.importKey('raw', keyBits, 'AES-GCM', false, ['decrypt', 'encrypt']);
}

async function onPaired(message: { server_pub?: string }): Promise<void> {
  if (!message.server_pub) {
    await rejectPairing('data_corrupt');
    return;
  }
  try {
    sessionKey = await deriveSessionKey(message.server_pub);
    items = [];
    await writeSession({ deviceId: await getDeviceId(), paired: true, code: null });
    resolveAuth();
  } catch {
    await rejectPairing('data_corrupt');
  }
}

function nextRequestId(): string {
  requestCounter += 1;
  return `${Date.now().toString(36)}-${requestCounter.toString(36)}`;
}

async function decryptMessage(message: EncryptedMessage): Promise<unknown> {
  if (!sessionKey || !message.nonce || !message.ciphertext) throw new Error('data_corrupt');
  const maxBytes = message.type === 'index' ? MAX_INDEX_BYTES : MAX_SECRET_BYTES;
  if (message.ciphertext.length > Math.ceil(maxBytes * 4 / 3) + 32) throw new Error('data_corrupt');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBytes(message.nonce) },
    sessionKey,
    b64ToBytes(message.ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as unknown;
}

function isBridgeItem(value: unknown): value is BridgeItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<BridgeItem>;
  return typeof item.id === 'string'
    && item.id.length > 0
    && item.id.length <= 128
    && typeof item.item_type === 'string'
    && item.item_type.length <= 32
    && typeof item.title === 'string'
    && item.title.length <= 512
    && (item.username === undefined || item.username === null || (typeof item.username === 'string' && item.username.length <= 512))
    && (item.url === undefined || item.url === null || (typeof item.url === 'string' && item.url.length <= 2048))
    && typeof item.has_password === 'boolean'
    && typeof item.has_totp === 'boolean'
    && typeof item.has_recovery_codes === 'boolean'
    && typeof item.has_passkeys === 'boolean';
}

function updateIndex(value: unknown): void {
  if (!Array.isArray(value) || value.length > MAX_INDEX_ITEMS || !value.every(isBridgeItem)) {
    throw new Error('data_corrupt');
  }
  items = value.map((item) => ({
    id: item.id,
    itemType: item.item_type,
    title: item.title || item.id,
    username: item.username ?? undefined,
    url: item.url ?? undefined,
    hasPassword: item.has_password,
    hasTotp: item.has_totp,
    hasRecoveryCodes: item.has_recovery_codes,
    hasPasskeys: item.has_passkeys,
  }));
}

async function onEncryptedMessage(message: EncryptedMessage): Promise<void> {
  try {
    const value = await decryptMessage(message);
    if (message.request_id) {
      const request = pending.get(message.request_id);
      if (!request) return;
      pending.delete(message.request_id);
      globalThis.clearTimeout(request.timer);
      request.resolve(value);
      return;
    }
    if (message.type === 'index') updateIndex(value);
    await writeSession({ paired: true, code: null });
  } catch {
    if (message.request_id) {
      const request = pending.get(message.request_id);
      if (request) {
        pending.delete(message.request_id);
        globalThis.clearTimeout(request.timer);
        request.reject(new Error('data_corrupt'));
      }
    }
    items = [];
    await writeSession({ code: 'data_corrupt' });
  }
}

function rejectRequest(requestId: unknown, code: ExtensionErrorCode): void {
  if (typeof requestId !== 'string') return;
  const request = pending.get(requestId);
  if (!request) return;
  pending.delete(requestId);
  globalThis.clearTimeout(request.timer);
  request.reject(new Error(code));
}

async function requestEncrypted<T>(type: 'index' | 'secret' | 'capture', message: Record<string, unknown>): Promise<T> {
  const requestId = String(message.request_id);
  if (!sessionKey) throw new Error('vault_locked');
  const response = new Promise<T>((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('bridge_unavailable'));
    }, REQUEST_TIMEOUT_MS);
    pending.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
  });
  if (!send({ ...message, type })) {
    const request = pending.get(requestId);
    if (request) globalThis.clearTimeout(request.timer);
    pending.delete(requestId);
    throw new Error('bridge_disconnected');
  }
  return response;
}

async function onLocked(): Promise<void> {
  sessionKey = null;
  items = [];
  rejectAuth('vault_locked');
  rejectPending('vault_locked');
  const deviceId = await getDeviceId();
  await writeSession({ deviceId, paired: deviceId !== null, code: null });
}

async function onHello(message: Record<string, unknown>): Promise<void> {
  if (message.app !== 'yobei' || message.protocol !== BRIDGE_PROTOCOL) {
    ws?.close();
    return;
  }
  const deviceId = await getDeviceId();
  if (!deviceId) {
    await writeSession({ paired: false, code: null });
    resolveAuth();
    return;
  }
  const identity = await localPublicKey();
  send({ type: 'resume', device_id: identity.deviceId, pubkey: identity.pubkey });
}

async function onMessage(event: MessageEvent): Promise<void> {
  let message: Record<string, unknown>;
  try {
    message = JSON.parse(String(event.data)) as Record<string, unknown>;
  } catch {
    return;
  }
  switch (message.type) {
    case 'hello':
      await onHello(message);
      break;
    case 'paired':
      await onPaired(message as { server_pub?: string });
      break;
    case 'locked':
      await onLocked();
      break;
    case 'unlocked': {
      if (!(await getDeviceId())) break;
      const identity = await localPublicKey();
      send({ type: 'resume', device_id: identity.deviceId, pubkey: identity.pubkey });
      break;
    }
    case 'items_changed':
      if (sessionKey) void refreshIndexOnce().catch(() => writeSession({ code: 'bridge_unavailable' }));
      break;
    case 'index':
    case 'secret':
    case 'capture':
      await onEncryptedMessage(message as unknown as EncryptedMessage);
      break;
    case 'rejected':
      await rejectPairing(errorCode(message.code, 'pair_rejected'));
      break;
    case 'error':
      rejectAuth(errorCode(message.code, 'operation_failed'));
      rejectRequest(message.request_id, errorCode(message.code, 'operation_failed'));
      await writeSession({ code: errorCode(message.code, 'operation_failed') });
      break;
  }
}

async function connect(): Promise<void> {
  if (ws?.readyState === WebSocket.OPEN) return;
  if (connectPromise) return connectPromise;
  connecting = true;
  const socket = new WebSocket(WS_URL);
  ws = socket;
  socket.onmessage = (event) => { void onMessage(event); };
  socket.onclose = () => {
    connecting = false;
    connectPromise = null;
    if (ws === socket) ws = null;
    sessionKey = null;
    items = [];
    rejectAuth('bridge_disconnected');
    rejectPending('bridge_disconnected');
    void writeSession({ code: 'bridge_disconnected' });
  };
  connectPromise = new Promise<void>((resolve, reject) => {
    const timeout = globalThis.setTimeout(() => {
      socket.close();
      reject(new Error('bridge_unavailable'));
    }, 2500);
    socket.onopen = () => { globalThis.clearTimeout(timeout); connecting = false; resolve(); };
    socket.onerror = () => { globalThis.clearTimeout(timeout); reject(new Error('bridge_unavailable')); };
  }).catch(async (error) => {
    connecting = false;
    connectPromise = null;
    await writeSession({ code: errorCode(error, 'bridge_unavailable') });
    throw error;
  });
  await connectPromise;
}

export async function ensureSession(): Promise<SessionSnapshot> {
  try {
    await connect();
    const persisted = await readSession();
    if (!sessionKey && persisted.paired) await waitForAuth();
  } catch {
  }
  return getSnapshot();
}

export async function refreshIndex(): Promise<DecryptedItem[]> {
  const requestId = nextRequestId();
  const value = await requestEncrypted<unknown>('index', { type: 'index', request_id: requestId });
  updateIndex(value);
  await writeSession({ paired: true, code: null });
  return items;
}

function refreshIndexOnce(): Promise<DecryptedItem[]> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshIndex().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function getItemSecrets(id: string, fields: SecretField[]): Promise<SecretItem> {
  if (!id || id.length > 128 || fields.length === 0 || fields.length > 5 || new Set(fields).size !== fields.length) {
    throw new Error('invalid_input');
  }
  const requestId = nextRequestId();
  return requestEncrypted<SecretItem>('secret', { type: 'secret', request_id: requestId, id, fields });
}

function normalizeHost(url: string): string {
  try {
    const parsed = new URL(url.includes('://') ? url : `https://${url}`);
    return parsed.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return (url ?? '')
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0];
  }
}

function hostsMatch(left: string, right: string): boolean {
  if (!left || !right) return false;
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

/// Login items whose host matches the page being browsed (or all login items
/// when the host is empty). Returns nothing while the vault is locked.
export function matchesForHost(host: string): DecryptedItem[] {
  if (!sessionKey) return [];
  const target = normalizeHost(host);
  return items.filter((item) => {
    if (item.itemType !== 'login') return false;
    if (!target) return true;
    return hostsMatch(normalizeHost(item.url ?? ''), target);
  });
}

export interface CaptureResult {
  matched: boolean;
  id?: string;
  candidates?: Array<{ id: string; title?: string; username?: string; url?: string }>;
}

export interface PendingRecoveryCapture {
  id: string;
  username: string;
  url: string;
  candidates: Array<{ id: string; title?: string; username?: string; url?: string }>;
}

export interface PendingPasswordCapture {
  id: string;
  username: string;
  url: string;
  candidates: Array<{ id: string; title?: string; username?: string; url?: string }>;
}

interface StoredPendingRecoveryCapture extends PendingRecoveryCapture {
  recoveryNonce: string;
  recoveryCiphertext: string;
  recoveryCodes: string;
}

interface StoredPendingPasswordCapture extends PendingPasswordCapture {
  passwordNonce: string;
  passwordCiphertext: string;
  password: string;
}

async function readPendingRecoveryCaptures(): Promise<StoredPendingRecoveryCapture[]> {
  if (!sessionKey) return [];
  const key = await getPendingCaptureKey();
  const result = await chrome.storage.local.get(PENDING_RECOVERY_KEY);
  const value = result[PENDING_RECOVERY_KEY];
  if (!Array.isArray(value)) return [];
  const captures: StoredPendingRecoveryCapture[] = [];
  for (const capture of value) {
    if (!capture || typeof capture !== 'object') continue;
    const item = capture as Partial<StoredPendingRecoveryCapture>;
    if (typeof item.id !== 'string'
      || typeof item.recoveryNonce !== 'string'
      || typeof item.recoveryCiphertext !== 'string'
      || typeof item.username !== 'string'
      || typeof item.url !== 'string'
      || !Array.isArray(item.candidates)) continue;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64ToBytes(item.recoveryNonce) },
        key,
        b64ToBytes(item.recoveryCiphertext),
      );
      const recoveryCodes = new TextDecoder().decode(plain);
      if (recoveryCodes.length === 0 || recoveryCodes.length > MAX_SECRET_BYTES) continue;
      captures.push({
        id: item.id,
        username: item.username ?? '',
        url: item.url ?? '',
        candidates: item.candidates ?? [],
        recoveryNonce: item.recoveryNonce,
        recoveryCiphertext: item.recoveryCiphertext,
        recoveryCodes,
      });
    } catch {
      continue;
    }
  }
  return captures;
}

async function writePendingRecoveryCaptures(value: StoredPendingRecoveryCapture[]): Promise<void> {
  const persisted = value.slice(0, MAX_PENDING_RECOVERY).map(({ recoveryCodes: _recoveryCodes, ...capture }) => capture);
  await chrome.storage.local.set({ [PENDING_RECOVERY_KEY]: persisted });
}

async function readPendingPasswordCaptures(): Promise<StoredPendingPasswordCapture[]> {
  if (!sessionKey) return [];
  const key = await getPendingCaptureKey();
  const result = await chrome.storage.local.get(PENDING_PASSWORD_KEY);
  const value = result[PENDING_PASSWORD_KEY];
  if (!Array.isArray(value)) return [];
  const captures: StoredPendingPasswordCapture[] = [];
  for (const capture of value) {
    if (!capture || typeof capture !== 'object') continue;
    const item = capture as Partial<StoredPendingPasswordCapture>;
    if (typeof item.id !== 'string'
      || typeof item.passwordNonce !== 'string'
      || typeof item.passwordCiphertext !== 'string'
      || typeof item.username !== 'string'
      || typeof item.url !== 'string'
      || !Array.isArray(item.candidates)) continue;
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: b64ToBytes(item.passwordNonce) },
        key,
        b64ToBytes(item.passwordCiphertext),
      );
      const password = new TextDecoder().decode(plain);
      if (password.length === 0 || password.length > MAX_SECRET_BYTES) continue;
      captures.push({
        id: item.id,
        username: item.username,
        url: item.url,
        candidates: item.candidates,
        passwordNonce: item.passwordNonce,
        passwordCiphertext: item.passwordCiphertext,
        password,
      });
    } catch {
      continue;
    }
  }
  return captures;
}

async function writePendingPasswordCaptures(value: StoredPendingPasswordCapture[]): Promise<void> {
  const persisted = value.slice(0, MAX_PENDING_RECOVERY).map(({ password: _password, ...capture }) => capture);
  await chrome.storage.local.set({ [PENDING_PASSWORD_KEY]: persisted });
}

export async function enqueuePendingRecoveryCapture(
  recoveryCodes: string,
  username: string,
  url: string,
  candidates: CaptureResult['candidates'] = [],
): Promise<string> {
  if (!sessionKey) throw new Error('vault_locked');
  const key = await getPendingCaptureKey();
  const id = crypto.randomUUID();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(recoveryCodes),
  );
  const pending = await readPendingRecoveryCaptures();
  pending.unshift({
    id,
    username,
    url,
    candidates: candidates ?? [],
    recoveryNonce: bytesToB64(nonce),
    recoveryCiphertext: bytesToB64(new Uint8Array(ciphertext)),
    recoveryCodes,
  });
  await writePendingRecoveryCaptures(pending);
  return id;
}

export async function getPendingRecoveryCaptures(): Promise<PendingRecoveryCapture[]> {
  const pending = await readPendingRecoveryCaptures();
  return pending.map(({ recoveryNonce: _recoveryNonce, recoveryCiphertext: _recoveryCiphertext, recoveryCodes: _recoveryCodes, ...capture }) => capture);
}

export async function enqueuePendingPasswordCapture(
  password: string,
  username: string,
  url: string,
  candidates: CaptureResult['candidates'] = [],
): Promise<string> {
  if (!sessionKey) throw new Error('vault_locked');
  const key = await getPendingCaptureKey();
  const id = crypto.randomUUID();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    new TextEncoder().encode(password),
  );
  const pending = await readPendingPasswordCaptures();
  pending.unshift({
    id,
    username,
    url,
    candidates: candidates ?? [],
    passwordNonce: bytesToB64(nonce),
    passwordCiphertext: bytesToB64(new Uint8Array(ciphertext)),
    password,
  });
  await writePendingPasswordCaptures(pending);
  return id;
}

export async function getPendingPasswordCaptures(): Promise<PendingPasswordCapture[]> {
  const pending = await readPendingPasswordCaptures();
  return pending.map(({ passwordNonce: _passwordNonce, passwordCiphertext: _passwordCiphertext, password: _password, ...capture }) => capture);
}

export async function savePendingPasswordCapture(captureId: string, itemId: string): Promise<CaptureResult> {
  const pending = await readPendingPasswordCaptures();
  const capture = pending.find((item) => item.id === captureId);
  if (!capture || !itemId) throw new Error('invalid_input');
  const result = await captureLoginPassword(capture.password, capture.username, capture.url, itemId);
  if (result.matched) await writePendingPasswordCaptures(pending.filter((item) => item.id !== captureId));
  return result;
}

export async function createPendingPasswordCapture(captureId: string, title: string): Promise<CaptureResult> {
  const pending = await readPendingPasswordCaptures();
  const capture = pending.find((item) => item.id === captureId);
  if (!capture || !title.trim()) throw new Error('invalid_input');
  const result = await captureLoginPassword(capture.password, capture.username, capture.url, undefined, title.trim());
  if (result.matched) await writePendingPasswordCaptures(pending.filter((item) => item.id !== captureId));
  return result;
}

export async function discardPendingPasswordCapture(captureId: string): Promise<void> {
  if (!captureId) throw new Error('invalid_input');
  const pending = await readPendingPasswordCaptures();
  await writePendingPasswordCaptures(pending.filter((item) => item.id !== captureId));
}

export async function savePendingRecoveryCapture(captureId: string, itemId: string): Promise<CaptureResult> {
  const pending = await readPendingRecoveryCaptures();
  const capture = pending.find((item) => item.id === captureId);
  if (!capture || !itemId) throw new Error('invalid_input');
  const result = await captureRecoveryCode(capture.recoveryCodes, capture.username, capture.url, itemId);
  if (result.matched) {
    await writePendingRecoveryCaptures(pending.filter((item) => item.id !== captureId));
  }
  return result;
}

export async function createPendingRecoveryCapture(captureId: string, title: string): Promise<CaptureResult> {
  const pending = await readPendingRecoveryCaptures();
  const capture = pending.find((item) => item.id === captureId);
  if (!capture || !title.trim()) throw new Error('invalid_input');
  const result = await captureRecoveryCode(capture.recoveryCodes, capture.username, capture.url, undefined, title.trim());
  if (result.matched) {
    await writePendingRecoveryCaptures(pending.filter((item) => item.id !== captureId));
  }
  return result;
}

export async function captureRecoveryCode(
  recoveryCodes: string,
  username: string,
  url: string,
  itemId?: string,
  title?: string,
): Promise<CaptureResult> {
  if (!sessionKey || recoveryCodes.trim().length === 0 || recoveryCodes.length > MAX_SECRET_BYTES || (itemId && itemId.length > 128) || (title && title.length > 512)) {
    throw new Error('invalid_input');
  }
  const requestId = nextRequestId();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({
    recovery_codes: recoveryCodes,
    username,
    url,
    ...(itemId ? { item_id: itemId } : {}),
    ...(title ? { title, create: true } : {}),
  }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, sessionKey, payload);
  return requestEncrypted<CaptureResult>('capture', {
    type: 'capture',
    request_id: requestId,
    nonce: bytesToB64(nonce),
    ciphertext: bytesToB64(new Uint8Array(ciphertext)),
  });
}

export async function captureLoginPassword(
  password: string,
  username: string,
  url: string,
  itemId?: string,
  title?: string,
): Promise<CaptureResult> {
  if (!sessionKey || password.length === 0 || password.length > MAX_SECRET_BYTES || (itemId && itemId.length > 128) || (title && title.length > 512)) {
    throw new Error('invalid_input');
  }
  const requestId = nextRequestId();
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({
    password,
    username,
    url,
    ...(itemId ? { item_id: itemId } : {}),
    ...(title ? { title, create: true } : {}),
  }));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, sessionKey, payload);
  return requestEncrypted<CaptureResult>('capture', {
    type: 'capture',
    request_id: requestId,
    nonce: bytesToB64(nonce),
    ciphertext: bytesToB64(new Uint8Array(ciphertext)),
  });
}

export async function pair(code: string): Promise<void> {
  await connect();
  const identity = await localPublicKey();
  const result = waitForAuth();
  if (!send({ type: 'pair', code: code.trim().toUpperCase(), device_id: identity.deviceId, pubkey: identity.pubkey })) {
    const waiter = authWaiter;
    authWaiter = null;
    if (waiter) globalThis.clearTimeout(waiter.timer);
    throw new Error('bridge_disconnected');
  }
  await result;
  await refreshIndexOnce();
}

export async function clearPairing(): Promise<void> {
  sessionKey = null;
  pendingCaptureKey = null;
  items = [];
  rejectAuth('pair_rejected');
  rejectPending('pair_rejected');
  await chrome.storage.local.remove([DEVICE_ID_KEY, DEVICE_KEY_STORAGE]);
  await chrome.storage.local.remove([PENDING_CAPTURE_KEY, PENDING_RECOVERY_KEY, PENDING_PASSWORD_KEY]);
  await chrome.storage.local.remove(SESSION_KEY);
}

export async function getSnapshot(): Promise<SessionSnapshot> {
  const persisted = await readSession();
  return {
    deviceId: persisted.deviceId,
    paired: persisted.paired,
    unlocked: sessionKey !== null,
    connecting,
    items,
    code: persisted.code,
  };
}
