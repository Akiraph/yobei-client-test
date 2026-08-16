import { loadCore, generatePassword } from './core';
import {
  ensureSession,
  pair,
  clearPairing,
  getItemSecrets,
  captureRecoveryCode,
  captureLoginPassword,
  enqueuePendingRecoveryCapture,
  enqueuePendingPasswordCapture,
  getPendingRecoveryCaptures,
  getPendingPasswordCaptures,
  savePendingRecoveryCapture,
  savePendingPasswordCapture,
  createPendingRecoveryCapture,
  createPendingPasswordCapture,
  getSnapshot,
  matchesForHost,
  type SecretField,
} from './session';
import { failure } from '../lib/errors';

chrome.runtime.onInstalled.addListener(() => {
  void loadCore().catch((error) => console.error('[yobei] core initialization failed', error));
});

chrome.runtime.onStartup.addListener(() => {
  void loadCore().catch((error) => console.error('[yobei] core initialization failed', error));
});

interface FillRequest {
  id: string;
  tabId: number;
}

async function sendFillMessage(tabId: number, message: Record<string, unknown>): Promise<{ ok?: boolean; filled?: string[]; reason?: string }> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

function secretFields(value: unknown): SecretField[] {
  if (!Array.isArray(value)) return [];
  return value.filter((field): field is SecretField => field === 'username' || field === 'password' || field === 'totp_code' || field === 'recovery_codes' || field === 'passkeys');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'ping':
      sendResponse({ ok: true });
      break;
    case 'core_ready':
      loadCore()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    case 'session_status':
      ensureSession()
        .then(sendResponse)
        .catch((error) => sendResponse(failure(error, 'bridge_unavailable')));
      return true;
    case 'pair':
      pair(String(message.code ?? ''))
        .then(() => getSnapshot())
        .then(sendResponse)
        .catch((error) => sendResponse(failure(error, 'pair_rejected')));
      return true;
    case 'clear_pairing':
      clearPairing()
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    case 'get_item_secret': {
      const id = typeof message.id === 'string' ? message.id : '';
      const fields = secretFields(message.fields);
      if (!id || fields.length === 0) {
        sendResponse({ ok: false, code: 'invalid_input' });
        break;
      }
      getItemSecrets(id, fields)
        .then((item) => sendResponse({ ok: true, item }))
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    }
    case 'get_matches': {
      const host = typeof message.url === 'string' ? message.url : '';
      sendResponse({
        ok: true,
        items: matchesForHost(host).map((item) => ({
          id: item.id,
          title: item.title,
          username: item.username ?? '',
          hasTotp: item.hasTotp,
        })),
      });
      break;
    }
    case 'fill': {
      const request = message as FillRequest;
      if (!request.id || !Number.isInteger(request.tabId)) {
        sendResponse({ ok: false, code: 'invalid_input' });
        break;
      }
      getItemSecrets(request.id, ['username', 'password', 'totp_code', 'recovery_codes'])
        .then((secret) => {
          if (!secret.password && !secret.username && !secret.totp_code && !secret.recovery_codes) {
            return { ok: false, code: 'item_not_found' };
          }
          return sendFillMessage(request.tabId, {
            type: 'yobei:fill',
            item: { id: request.id, username: secret.username, password: secret.password, recoveryCodes: secret.recovery_codes },
            totpCode: secret.totp_code,
            recoveryCodes: secret.recovery_codes,
          })
            .then((result) => ({ ok: true, ...result }));
        })
        .then(sendResponse)
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    }
    case 'capture_recovery': {
      const recoveryCodes = typeof message.recoveryCodes === 'string' ? message.recoveryCodes : '';
      const username = typeof message.username === 'string' ? message.username : '';
      const url = typeof message.url === 'string' ? message.url : '';
      captureRecoveryCode(recoveryCodes, username, url)
        .then(async (result) => {
          const pendingId = result.matched
            ? undefined
            : await enqueuePendingRecoveryCapture(recoveryCodes, username, url, result.candidates);
          sendResponse({ ok: true, ...result, pendingId });
        })
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    }
    case 'pending_recovery':
      getPendingRecoveryCaptures()
        .then((captures) => sendResponse({ ok: true, captures }))
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    case 'pending_password':
      getPendingPasswordCaptures()
        .then((captures) => sendResponse({ ok: true, captures }))
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    case 'save_pending_recovery': {
      const captureId = typeof message.captureId === 'string' ? message.captureId : '';
      const itemId = typeof message.itemId === 'string' ? message.itemId : '';
      savePendingRecoveryCapture(captureId, itemId)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    }
    case 'create_pending_recovery': {
      const captureId = typeof message.captureId === 'string' ? message.captureId : '';
      const title = typeof message.title === 'string' ? message.title : '';
      createPendingRecoveryCapture(captureId, title)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    }
    case 'save_pending_password': {
      const captureId = typeof message.captureId === 'string' ? message.captureId : '';
      const itemId = typeof message.itemId === 'string' ? message.itemId : '';
      savePendingPasswordCapture(captureId, itemId)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    }
    case 'create_pending_password': {
      const captureId = typeof message.captureId === 'string' ? message.captureId : '';
      const title = typeof message.title === 'string' ? message.title : '';
      createPendingPasswordCapture(captureId, title)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    }
    case 'capture_password': {
      const password = typeof message.password === 'string' ? message.password : '';
      const username = typeof message.username === 'string' ? message.username : '';
      const url = typeof message.url === 'string' ? message.url : '';
      captureLoginPassword(password, username, url)
        .then(async (result) => {
          const pendingId = result.matched
            ? undefined
            : await enqueuePendingPasswordCapture(password, username, url, result.candidates);
          sendResponse({ ok: true, ...result, pendingId });
        })
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    }
    case 'generate_password':
      loadCore()
        .then(() => sendResponse({ ok: true, password: generatePassword(String(message.mode ?? ''), String(message.opts ?? '')) }))
        .catch((error) => sendResponse(failure(error, 'operation_failed')));
      return true;
    default:
      sendResponse({ ok: false, code: 'invalid_input' });
  }
});
