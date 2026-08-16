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
  let autofillMatches: MatchItem[] = [];
  let autofillRows: HTMLElement[] = [];
  let autofillIndex = -1;

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
    autofillMatches = [];
    autofillRows = [];
    autofillIndex = -1;
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

  function msg(key: string, substitutions?: string[]): string {
    try {
      return chrome.i18n.getMessage(key, substitutions) || key;
    } catch {
      return key;
    }
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

  function setAutofillIndex(index: number): void {
    autofillIndex = index;
    autofillRows.forEach((row, i) => {
      row.style.background = i === index ? C.surfaceHover : 'transparent';
    });
  }

  function onAutofillKeydown(event: KeyboardEvent): void {
    if (autofillRows.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setAutofillIndex((autofillIndex + 1) % autofillRows.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setAutofillIndex((autofillIndex - 1 + autofillRows.length) % autofillRows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const match = autofillMatches[autofillIndex];
      if (match) void fillMatch(match);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      hideOverlay();
    }
  }

  async function showAutofillMenu(field: HTMLInputElement): Promise<void> {
    const matches = await requestMatches();
    if (matches.length === 0) return;
    activeField = field;
    autofillMatches = matches;
    autofillRows = [];
    autofillIndex = 0;

    const root = ensureOverlay();
    root.innerHTML = '';
    const list = el('div', `background:${C.surface};border:1px solid ${C.border};border-radius:12px;box-shadow:${C.shadow};padding:6px;min-width:280px;max-width:340px;font-family:${C.font};`);
    matches.forEach((match, index) => {
      const row = el('button', `display:flex;align-items:center;gap:10px;width:100%;border:none;background:${index === autofillIndex ? C.surfaceHover : 'transparent'};padding:9px 12px;border-radius:8px;cursor:pointer;text-align:left;font-family:${C.font};`);
      row.addEventListener('mouseenter', () => { setAutofillIndex(index); });
      row.append(el('span', `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:600;color:${C.text};`, match.title));
      if (match.username) row.append(el('span', `max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:${C.muted};`, match.username));
      if (match.hasTotp) row.append(el('span', `font-size:11px;color:${C.accentText};background:${C.surfaceHover};padding:2px 7px;border-radius:999px;`, '2FA'));
      row.addEventListener('click', () => { void fillMatch(match); });
      list.append(row);
      autofillRows.push(row);
    });
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
  document.addEventListener('keydown', onAutofillKeydown, true);
  window.addEventListener('scroll', hideOverlay, true);
  window.addEventListener('resize', hideOverlay);

  // ── Password generation & capture ────────────────────────────────────────────

  let lastCapturedRecovery = '';
  let lastCapturedPassword = '';
  let captureTimer: number | undefined;
  let generatorMode: 'random' | 'passphrase' | 'pin' = 'random';

  const GENERATOR_MODE_LABELS: Record<'random' | 'passphrase' | 'pin', string> = {
    random: 'content_random',
    passphrase: 'content_passphrase',
    pin: 'content_pin',
  };

  function generatorOptions(mode: 'random' | 'passphrase' | 'pin'): string {
    return JSON.stringify(
      mode === 'random'
        ? { length: 16, useLower: true, useUpper: true, useDigits: true, useSymbols: true }
        : mode === 'passphrase'
          ? { words: 4, separator: '-' }
          : { length: 6 },
    );
  }

  async function generatePasswordValue(mode: 'random' | 'passphrase' | 'pin'): Promise<string> {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'generate_password',
        mode,
        opts: generatorOptions(mode),
      });
      if (response?.ok && typeof response.password === 'string') return response.password;
    } catch {
      // bridge unavailable — leave empty
    }
    return '';
  }

  function smallBtn(label: string, color: string, borderColor: string): HTMLElement {
    const btn = el('button', `flex:1;border:1px solid ${borderColor};border-radius:8px;padding:6px 8px;background:transparent;font-size:12px;color:${color};cursor:pointer;font-family:${C.font};`);
    btn.textContent = label;
    return btn;
  }

  function useGeneratedPassword(field: HTMLInputElement, value: string): void {
    hideOverlay();
    if (!value) return;
    setField(field, value);
    field.focus();
  }

  async function copyGenerated(value: string): Promise<void> {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore
    }
  }

  async function regenerateGenerated(valueEl: HTMLElement): Promise<void> {
    const password = await generatePasswordValue(generatorMode);
    if (password) valueEl.textContent = password;
  }

  async function showGeneratorMenu(field: HTMLInputElement): Promise<void> {
    const root = ensureOverlay();
    root.innerHTML = '';
    const box = el('div', `background:${C.surface};border:1px solid ${C.border};border-radius:12px;box-shadow:${C.shadow};padding:12px 14px;min-width:300px;max-width:360px;font-family:${C.font};`);

    const valueEl = el('div', `font-family:${C.mono};font-size:16px;font-weight:600;letter-spacing:0.03em;color:${C.text};word-break:break-all;min-height:22px;`, msg('content_generate'));
    box.append(valueEl);

    const actions = el('div', `display:flex;gap:8px;margin-top:10px;`);
    const useBtn = smallBtn(msg('content_use'), C.accentText, C.accent);
    useBtn.addEventListener('click', () => { useGeneratedPassword(field, valueEl.textContent ?? ''); });
    const copyBtn = smallBtn(msg('content_copy'), C.muted, C.border);
    copyBtn.addEventListener('click', () => { void copyGenerated(valueEl.textContent ?? ''); });
    const regenBtn = smallBtn(msg('content_regenerate'), C.muted, C.border);
    regenBtn.addEventListener('click', () => { void regenerateGenerated(valueEl); });
    actions.append(useBtn, copyBtn, regenBtn);
    box.append(actions);

    const modes = el('div', `display:flex;gap:6px;margin-top:8px;`);
    (['random', 'passphrase', 'pin'] as const).forEach((mode) => {
      const active = generatorMode === mode;
      const btn = el('button', `border:1px solid ${active ? C.accent : C.border};border-radius:999px;padding:3px 10px;background:${active ? C.surfaceHover : 'transparent'};font-size:11px;color:${active ? C.accentText : C.muted};cursor:pointer;font-family:${C.font};`, msg(GENERATOR_MODE_LABELS[mode]));
      btn.addEventListener('click', () => { generatorMode = mode; void regenerateGenerated(valueEl); });
      modes.append(btn);
    });
    box.append(modes);

    root.append(box);
    positionOverlay(field);
    void regenerateGenerated(valueEl);
  }

  async function capturePasswordFromPage(): Promise<void> {
    const field = findRegistrationPasswordField();
    const password = field?.value ?? '';
    if (!password) return;
    const username = findUsernameField()?.value ?? '';
    const captureKey = `${location.href} ${username} ${password}`;
    if (captureKey === lastCapturedPassword) return;
    lastCapturedPassword = captureKey;

    let response: CaptureResponse | undefined;
    try {
      response = await chrome.runtime.sendMessage({
        type: 'capture_password',
        password,
        username,
        url: location.href,
      });
    } catch {
      return;
    }
    if (response?.ok !== true || response.matched !== false || !response.pendingId) return;
    showSavePrompt(field, response.pendingId, response.candidates ?? []);
  }

  interface SaveCandidate {
    id: string;
    title?: string;
    username?: string;
    url?: string;
  }

  interface CaptureResponse {
    ok?: boolean;
    matched?: boolean;
    pendingId?: string;
    candidates?: SaveCandidate[];
  }

  function promptButton(label: string, username: string | undefined, onClick: () => void, accent = false): HTMLElement {
    const row = el('button', `display:flex;align-items:center;gap:10px;width:100%;border:none;background:transparent;padding:8px 12px;border-radius:8px;cursor:pointer;text-align:left;font-family:${C.font};`);
    row.addEventListener('mouseenter', () => { row.style.background = C.surfaceHover; });
    row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });
    row.append(el('span', `flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:${accent ? 600 : 400};color:${accent ? C.accentText : C.muted};`, label));
    if (username) row.append(el('span', `max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:${C.muted};`, username));
    row.addEventListener('click', onClick);
    return row;
  }

  function showSavePrompt(field: HTMLInputElement | null, pendingId: string, candidates: SaveCandidate[]): void {
    activeField = null;
    const root = ensureOverlay();
    root.innerHTML = '';
    const box = el('div', `background:${C.surface};border:1px solid ${C.border};border-radius:12px;box-shadow:${C.shadow};padding:10px 12px;min-width:280px;max-width:340px;font-family:${C.font};`);
    box.append(el('div', `font-size:13px;font-weight:600;color:${C.text};padding:2px 4px 8px;`, msg('content_savePasswordTitle')));

    if (candidates.length > 0) {
      for (const candidate of candidates.slice(0, 4)) {
        box.append(promptButton(
          candidate.title ?? msg('content_saveNew'),
          candidate.username,
          () => { void saveCapturedPassword(pendingId, candidate.id); },
          true,
        ));
      }
      box.append(promptButton(`+ ${msg('content_saveNew')}`, undefined, () => { void saveCapturedPassword(pendingId); }, true));
    } else {
      box.append(promptButton(msg('content_save'), undefined, () => { void saveCapturedPassword(pendingId); }, true));
    }
    box.append(promptButton(msg('content_dontSave'), undefined, () => { void discardCapturedPassword(pendingId); }));

    root.append(box);
    if (field) {
      positionOverlay(field);
    } else {
      root.style.left = '50%';
      root.style.top = '80px';
      root.style.transform = 'translateX(-50%)';
      root.style.display = 'block';
    }
  }

  async function saveCapturedPassword(pendingId: string, itemId?: string): Promise<void> {
    let response: { ok?: boolean } | undefined;
    try {
      response = await chrome.runtime.sendMessage(
        itemId
          ? { type: 'save_pending_password', captureId: pendingId, itemId }
          : { type: 'create_pending_password', captureId: pendingId, title: location.hostname },
      );
    } catch {
      return;
    }
    if (response?.ok) {
      const root = overlay;
      if (root) {
        root.innerHTML = '';
        root.append(el('div', `background:${C.surface};border:1px solid ${C.border};border-radius:12px;box-shadow:${C.shadow};padding:10px 14px;color:${C.accentText};font-size:13px;font-family:${C.font};`, msg('content_saved')));
        window.setTimeout(hideOverlay, 1500);
      }
    }
  }

  async function discardCapturedPassword(pendingId: string): Promise<void> {
    hideOverlay();
    try {
      await chrome.runtime.sendMessage({ type: 'discard_pending_password', captureId: pendingId });
    } catch {
      // The capture stays pending and remains available from the popup.
    }
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

  // ── Hover preview: a low-presence badge showing the match count ───────────────

  let hoverBadge: HTMLButtonElement | null = null;
  let hoverBadgeField: HTMLInputElement | null = null;
  let hoverBadgeTimer: number | undefined;

  function removeHoverBadge(): void {
    hoverBadge?.remove();
    hoverBadge = null;
    hoverBadgeField = null;
  }

  function positionHoverBadge(): void {
    if (!hoverBadge || !hoverBadgeField) return;
    const rect = hoverBadgeField.getBoundingClientRect();
    hoverBadge.style.left = `${Math.max(8, rect.right - hoverBadge.offsetWidth)}px`;
    hoverBadge.style.top = `${Math.max(8, rect.top - 30)}px`;
  }

  async function showHoverBadge(field: HTMLInputElement): Promise<void> {
    const matches = await requestMatches();
    if (matches.length === 0 || hoverBadgeField === field) return;
    removeHoverBadge();
    const badge = document.createElement('button');
    badge.type = 'button';
    badge.textContent = msg('content_matchBadge', [String(matches.length)]);
    badge.style.cssText = `position:fixed;z-index:2147483647;padding:5px 10px;border:1px solid ${C.border};border-radius:999px;background:${C.surface};color:${C.accentText};font:12px ${C.font};cursor:pointer;box-shadow:${C.shadow};`;
    hoverBadge = badge;
    hoverBadgeField = field;
    badge.addEventListener('mouseenter', () => {
      if (hoverBadgeTimer !== undefined) window.clearTimeout(hoverBadgeTimer);
    });
    badge.addEventListener('click', () => {
      removeHoverBadge();
      field.focus();
    });
    document.documentElement.append(badge);
    positionHoverBadge();
  }

  document.addEventListener('mouseover', (event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (!isLoginField(event.target) || document.activeElement === event.target) return;
    if (hoverBadgeTimer !== undefined) window.clearTimeout(hoverBadgeTimer);
    const field = event.target;
    hoverBadgeTimer = window.setTimeout(() => { void showHoverBadge(field); }, 150);
  }, true);

  document.addEventListener('mouseout', (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target !== hoverBadgeField) return;
    if (hoverBadgeTimer !== undefined) window.clearTimeout(hoverBadgeTimer);
    hoverBadgeTimer = window.setTimeout(removeHoverBadge, 200);
  }, true);

  document.addEventListener('submit', () => {
    window.setTimeout(() => {
      captureRecoveryFromPage();
      capturePasswordFromPage();
    }, 0);
  }, true);
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof HTMLInputElement) {
      removeHoverBadge();
      if (isRegistrationPasswordField(event.target)) {
        void showGeneratorMenu(event.target);
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
