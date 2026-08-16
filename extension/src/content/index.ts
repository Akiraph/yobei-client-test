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

interface MatchItem {
  id: string;
  title: string;
  username: string;
  hasTotp: boolean;
}

// Morning-mist palette — mirrors the desktop client's fog tokens so the inline
// experience reads as the same product, not a detached popup.
const C = {
  text: '#0F1726',
  muted: '#647A99',
  faint: '#8FA5BE',
  surface: '#FFFFFF',
  surfaceHover: '#F0F5FB',
  border: '#D2E2F0',
  accent: '#6FA896',
  accentText: '#2E5A4C',
  danger: '#C45656',
  ringTrack: '#D2E2F0',
  font: "-apple-system, 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif",
  mono: "ui-monospace, 'Cascadia Mono', 'Segoe UI', monospace",
  shadow: '0 6px 24px rgba(35, 47, 73, 0.16), 0 2px 6px rgba(35, 47, 73, 0.08)',
};

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

  function isTotpField(field: HTMLInputElement): boolean {
    const hint = `${field.name} ${field.id} ${field.autocomplete} ${field.placeholder}`.toLowerCase();
    return field.autocomplete === 'one-time-code' || /otp|totp|one.?time|code|2fa|verification|验证/.test(hint);
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

  function isLoginField(field: HTMLInputElement): boolean {
    if (!isFillable(field)) return false;
    if (field.type === 'password') return !isRegistrationPasswordField(field);
    const hint = `${field.name} ${field.id} ${field.autocomplete} ${field.placeholder}`.toLowerCase();
    return field.type === 'email' || /user|login|account|email/.test(hint);
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

  // ── Inline overlay: autofill menu + TOTP hover ──────────────────────────────

  let overlay: HTMLDivElement | null = null;
  let activeField: HTMLInputElement | null = null;
  let totpTimer: number | undefined;

  function ensureOverlay(): HTMLDivElement {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.setAttribute('data-yobei', 'overlay');
    overlay.style.cssText = 'position:fixed;z-index:2147483647;display:none;';
    document.documentElement.append(overlay);
    return overlay;
  }

  function hideOverlay(): void {
    if (overlay) overlay.style.display = 'none';
    if (totpTimer !== undefined) {
      window.clearInterval(totpTimer);
      totpTimer = undefined;
    }
    activeField = null;
  }

  function positionOverlay(field: HTMLInputElement): void {
    const root = ensureOverlay();
    const rect = field.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const placeAbove = spaceBelow < 160 && rect.top > 200;
    root.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 340))}px`;
    if (placeAbove) {
      root.style.top = `${Math.max(8, rect.top - 8)}px`;
      root.style.transform = 'translateY(-100%)';
    } else {
      root.style.top = `${rect.bottom + 8}px`;
      root.style.transform = 'none';
    }
    root.style.display = 'block';
  }

  function el(tag: string, styles: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.style.cssText = styles;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  async function requestMatches(): Promise<MatchItem[]> {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'get_matches', url: location.href });
      if (response?.ok && Array.isArray(response.items)) {
        return response.items as MatchItem[];
      }
    } catch {
      // bridge unavailable — no overlay
    }
    return [];
  }

  async function showAutofillMenu(field: HTMLInputElement): Promise<void> {
    const matches = await requestMatches();
    if (matches.length === 0) return;
    activeField = field;

    const root = ensureOverlay();
    root.innerHTML = '';
    const list = el('div', `background:${C.surface};border:1px solid ${C.border};border-radius:12px;box-shadow:${C.shadow};padding:6px;min-width:280px;max-width:340px;font-family:${C.font};`);
    for (const match of matches) {
      const row = el('button', `display:flex;align-items:center;gap:10px;width:100%;border:none;background:transparent;padding:9px 12px;border-radius:8px;cursor:pointer;text-align:left;font-family:${C.font};`);
      row.addEventListener('mouseenter', () => { row.style.background = C.surfaceHover; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
      row.append(el('span', `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;color:${C.text};`, match.title));
      if (match.username) row.append(el('span', `max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:${C.muted};`, match.username));
      if (match.hasTotp) row.append(el('span', `font-size:11px;color:${C.accentText};background:${C.surfaceHover};padding:2px 7px;border-radius:999px;`, '2FA'));
      row.addEventListener('click', () => { void fillMatch(match); });
      list.append(row);
    }
    root.append(list);
    positionOverlay(field);
  }

  async function fillMatch(match: MatchItem): Promise<void> {
    const field = activeField;
    hideOverlay();
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'get_item_secret',
        id: match.id,
        fields: ['username', 'password'],
      });
      const username = typeof response?.item?.username === 'string' ? response.item.username : '';
      const password = typeof response?.item?.password === 'string' ? response.item.password : '';

      const passwordField = findPasswordField();
      if (password && passwordField) focusAndFill(passwordField, password);
      const usernameField = findUsernameField();
      if (username && usernameField) focusAndFill(usernameField, username);
    } catch {
      // swallow — nothing to fill
    }
  }

  async function showTotpHover(field: HTMLInputElement): Promise<void> {
    const matches = await requestMatches();
    const match = matches.find((item) => item.hasTotp);
    if (!match) return;

    let code = '';
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'get_item_secret',
        id: match.id,
        fields: ['totp_code'],
      });
      code = typeof response?.item?.totp_code === 'string' ? response.item.totp_code : '';
    } catch {
      return;
    }
    if (!code) return;
    activeField = field;

    const root = ensureOverlay();
    root.innerHTML = '';
    const pill = el('button', `display:flex;align-items:center;gap:12px;border:1px solid ${C.border};border-radius:12px;background:${C.surface};box-shadow:${C.shadow};padding:10px 14px;cursor:pointer;font-family:${C.font};`);
    pill.append(el('span', `font-family:${C.mono};font-size:20px;font-weight:700;letter-spacing:0.08em;color:${C.text};`, code));

    // Countdown ring — depletes over the 30s TOTP period.
    const ring = el('svg', 'width:20px;height:20px;flex-shrink:0;') as unknown as SVGSVGElement;
    ring.setAttribute('viewBox', '0 0 20 20');
    const track = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    track.setAttribute('cx', '10');
    track.setAttribute('cy', '10');
    track.setAttribute('r', '8');
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', C.ringTrack);
    track.setAttribute('stroke-width', '2.5');
    const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    arc.setAttribute('cx', '10');
    arc.setAttribute('cy', '10');
    arc.setAttribute('r', '8');
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', C.accent);
    arc.setAttribute('stroke-width', '2.5');
    arc.setAttribute('stroke-linecap', 'round');
    const circumference = 2 * Math.PI * 8;
    arc.setAttribute('stroke-dasharray', String(circumference));
    arc.setAttribute('transform', 'rotate(-90 10 10)');
    ring.append(track, arc);

    const update = () => {
      const period = 30;
      const remaining = period - (Math.floor(Date.now() / 1000) % period);
      arc.setAttribute('stroke-dashoffset', String(circumference * (1 - remaining / period)));
    };
    update();
    if (totpTimer !== undefined) window.clearInterval(totpTimer);
    totpTimer = window.setInterval(update, 500);

    pill.append(ring);
    pill.append(el('span', `font-size:11px;color:${C.faint};`, match.title));
    pill.addEventListener('click', () => {
      const target = activeField ?? findTotpField();
      hideOverlay();
      if (target) focusAndFill(target, code);
    });
    root.append(pill);
    positionOverlay(field);
  }

  document.addEventListener('click', (event) => {
    if (overlay && event.target instanceof Node && !overlay.contains(event.target)) hideOverlay();
  }, true);
  document.addEventListener('blur', () => { if (activeField) hideOverlay(); }, true);
  window.addEventListener('scroll', hideOverlay, true);
  window.addEventListener('resize', hideOverlay);

  // ── Password generation & capture ────────────────────────────────────────────

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
    button.style.cssText = `position:fixed;z-index:2147483647;padding:6px 10px;border:1px solid ${C.accent};border-radius:8px;background:${C.surface};color:${C.accentText};font:12px ${C.font};cursor:pointer;box-shadow:${C.shadow};`;
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
    const captureKey = `${location.href} ${username} ${password}`;
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
    if (event.target instanceof HTMLInputElement) {
      if (isRegistrationPasswordField(event.target)) {
        void suggestPassword(event.target);
        return;
      }
      if (isTotpField(event.target)) {
        void showTotpHover(event.target);
        return;
      }
      if (isLoginField(event.target)) {
        void showAutofillMenu(event.target);
      }
    }
  }, true);
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
