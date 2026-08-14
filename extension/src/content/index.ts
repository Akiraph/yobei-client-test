interface FillItem {
  id: string;
  username?: string;
  password?: string;
  totp?: string;
  recoveryCodes?: string;
}

interface FillRequest {
  type: 'yobei:fill';
  item: FillItem;
  totpCode?: string;
}

(() => {
  const contentWindow = window as Window & { __yobeiContentScriptLoaded?: boolean };
  if (contentWindow.__yobeiContentScriptLoaded) return;
  contentWindow.__yobeiContentScriptLoaded = true;

function isFillable(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  return (
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
    !el.disabled &&
    el.offsetParent !== null &&
    el.getBoundingClientRect().width > 0 &&
    el.getBoundingClientRect().height > 0
  );
}

function findUsernameField(): HTMLInputElement | null {
  const byAutocomplete = document.querySelector<HTMLInputElement>('input[autocomplete="username"]');
  if (byAutocomplete && isFillable(byAutocomplete)) return byAutocomplete;

  const candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="email"], input[type="tel"], input[type="text"]'));
  const match = candidates
    .filter(isFillable)
    .find((el) => {
      if (el.type === 'email') return true;
      const hint = `${el.name} ${el.id} ${el.autocomplete} ${el.placeholder}`.toLowerCase();
      return /user|login|account|email|phone/.test(hint);
    });
  return match ?? null;
}

function findPasswordField(): HTMLInputElement | null {
  const passwords = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'));
  return passwords.find(isFillable) ?? null;
}

function isRegistrationPasswordField(field: HTMLInputElement): boolean {
  const hint = `${field.name} ${field.id} ${field.autocomplete} ${field.placeholder} ${location.pathname}`.toLowerCase();
  return field.autocomplete === 'new-password'
    || /signup|sign-up|register|registration|create-account|createaccount|new-password|confirm-password/.test(hint);
}

function findRegistrationPasswordField(): HTMLInputElement | null {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
    .filter(isFillable)
    .find(isRegistrationPasswordField) ?? null;
}

function findTotpField(): HTMLInputElement | null {
  const oneTime = document.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]');
  if (oneTime && isFillable(oneTime)) return oneTime;

  const candidates = Array.from(document.querySelectorAll<HTMLInputElement>('input[inputmode="numeric"], input[type="text"]'));
  return (
    candidates
      .filter(isFillable)
      .find((el) => {
        const hint = `${el.name} ${el.id} ${el.autocomplete} ${el.placeholder}`.toLowerCase();
        return /otp|totp|one.?time|code/.test(hint);
      }) ?? null
  );
}

function findRecoveryField(): HTMLInputElement | HTMLTextAreaElement | null {
  return findRecoveryFields()[0] ?? null;
}

function findRecoveryFields(): Array<HTMLInputElement | HTMLTextAreaElement> {
  const candidates = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'textarea, input:not([type="hidden"])',
  ));
  return candidates
    .filter(isFillable)
    .filter((el) => {
      const hint = `${el.name} ${el.id} ${el.autocomplete} ${el.placeholder}`.toLowerCase();
      return /recovery|backup|emergency|restore|备用|恢复/.test(hint);
    });
}

// Native setters and events keep controlled inputs in sync.
function setField(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function focusAndFill(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  el.focus();
  setField(el, value);
}

chrome.runtime.onMessage.addListener((msg: FillRequest, _sender, sendResponse) => {
  if (msg?.type !== 'yobei:fill') return;

  const filled: string[] = [];
  const passwordField = findPasswordField();
  if (msg.item.password && passwordField) {
    focusAndFill(passwordField, msg.item.password);
    filled.push('password');
  }

  const usernameField = findUsernameField();
  if (msg.item.username && usernameField) {
    focusAndFill(usernameField, msg.item.username);
    filled.push('username');
  }

  if (msg.totpCode) {
    const totpField = findTotpField();
    if (totpField) {
      focusAndFill(totpField, msg.totpCode);
      filled.push('totp');
    } else {
      void navigator.clipboard.writeText(msg.totpCode);
    }
  }

  if (msg.item.recoveryCodes) {
    const recoveryField = findRecoveryField();
    if (recoveryField) {
      focusAndFill(recoveryField, msg.item.recoveryCodes);
      filled.push('recovery');
    } else {
      void navigator.clipboard.writeText(msg.item.recoveryCodes);
    }
  }

  if (filled.length === 0) {
    sendResponse({ ok: false, reason: 'no-fillable-field' });
    return;
  }

  sendResponse({ ok: true, filled });
});

let lastCapturedRecovery = '';
let lastCapturedPassword = '';
let captureTimer: number | undefined;
let passwordSuggestion: HTMLButtonElement | undefined;
let passwordSuggestionField: HTMLInputElement | undefined;

function positionPasswordSuggestion(): void {
  if (!passwordSuggestion || !passwordSuggestionField) return;
  const rect = passwordSuggestionField.getBoundingClientRect();
  passwordSuggestion.style.left = `${Math.max(8, rect.right - 80)}px`;
  passwordSuggestion.style.top = `${Math.max(8, rect.top - 34)}px`;
}

function removePasswordSuggestion(): void {
  passwordSuggestion?.remove();
  passwordSuggestion = undefined;
  passwordSuggestionField = undefined;
}

async function suggestPassword(field: HTMLInputElement): Promise<void> {
  if (passwordSuggestion && passwordSuggestionField === field) {
    positionPasswordSuggestion();
    return;
  }
  removePasswordSuggestion();
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Yobei';
  button.style.cssText = 'position:fixed;z-index:2147483647;padding:6px 10px;border:1px solid #6fa896;border-radius:6px;background:#f7faf8;color:#3f4c63;font:12px Segoe UI,Microsoft YaHei,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.16)';
  passwordSuggestionField = field;
  positionPasswordSuggestion();
  button.addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({
      type: 'generate_password',
      mode: 'random',
      opts: JSON.stringify({ length: 20, useLower: true, useUpper: true, useDigits: true, useSymbols: true }),
    });
    if (response?.ok && typeof response.password === 'string') {
      setField(field, response.password);
      field.focus();
    }
  });
  document.documentElement.append(button);
  passwordSuggestion = button;
  positionPasswordSuggestion();
}

function capturePasswordFromPage(): void {
  const field = findRegistrationPasswordField();
  const password = field?.value ?? '';
  if (!password) return;
  const username = findUsernameField()?.value ?? '';
  const captureKey = `${location.href}\u0000${username}\u0000${password}`;
  if (captureKey === lastCapturedPassword) return;
  lastCapturedPassword = captureKey;
  void chrome.runtime.sendMessage({
    type: 'capture_password',
    password,
    username,
    url: location.href,
  });
}

function captureRecoveryFromPage(): void {
  const recoveryCodes = findRecoveryFields()
    .map((field) => field.value.trim())
    .filter(Boolean)
    .join('\n');
  if (!recoveryCodes || recoveryCodes === lastCapturedRecovery) return;
  lastCapturedRecovery = recoveryCodes;
  const username = findUsernameField()?.value ?? '';
  void chrome.runtime.sendMessage({
    type: 'capture_recovery',
    recoveryCodes,
    username,
    url: location.href,
  });
}

document.addEventListener('submit', () => {
  window.setTimeout(() => {
    captureRecoveryFromPage();
    capturePasswordFromPage();
  }, 0);
}, true);
document.addEventListener('focusin', (event) => {
  if (event.target instanceof HTMLInputElement && isRegistrationPasswordField(event.target)) {
    void suggestPassword(event.target);
  }
}, true);
window.addEventListener('scroll', positionPasswordSuggestion, true);
window.addEventListener('resize', positionPasswordSuggestion);
document.addEventListener('change', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    const hint = `${event.target.name} ${event.target.id} ${event.target.autocomplete} ${event.target.placeholder}`.toLowerCase();
    if (/recovery|backup|emergency|restore|备用|恢复/.test(hint)) {
      if (captureTimer !== undefined) window.clearTimeout(captureTimer);
      captureTimer = window.setTimeout(captureRecoveryFromPage, 200);
    }
  }
}, true);
})();
