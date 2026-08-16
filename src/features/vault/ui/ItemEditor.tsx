import { createSignal, For, Show } from 'solid-js';
import { IconBack, IconEye, IconEyeOff, IconTrash } from '../../../components/Icon';
import { notifyError } from '../../../lib/notify';
import { errorMessage } from '../../../lib/errors';
import type { EditableVaultItem, ItemType } from '../../../lib/types';
import { t } from '../../../lib/i18n';
import type { VaultFeature } from '../model';

interface Props {
  feature: VaultFeature;
  item?: EditableVaultItem | null;
  onClose: () => void;
}

export default function ItemEditor(props: Props) {
  const isEdit = () => !!props.item;
  const src = () => props.item;

  const [type, setType] = createSignal<ItemType>(src()?.type ?? 'login');
  const [title, setTitle] = createSignal(src()?.title ?? '');
  const [url, setUrl] = createSignal(src()?.url ?? '');
  const [username, setUsername] = createSignal(src()?.username ?? '');
  const [password, setPassword] = createSignal(src()?.password ?? '');
  const [totp, setTotp] = createSignal(src()?.totp ?? '');
  const [recoveryCodes, setRecoveryCodes] = createSignal<string[]>((src()?.recoveryCodes ?? '').split(/\r?\n/).filter(Boolean));
  const [passkeys, setPasskeys] = createSignal<string[]>(src()?.passkeys ?? []);
  const [notes, setNotes] = createSignal(src()?.notes ?? '');
  const [showPw, setShowPw] = createSignal(false);
  const [showTotp, setShowTotp] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  async function doSave() {
    const itemTitle = title().trim();
    if (!itemTitle) {
      notifyError(t('editor.titleRequired'));
      return;
    }
    if (type() === 'login'
      && !username().trim()
      && !password()
      && !totp().trim()
      && recoveryCodes().length === 0
      && passkeys().length === 0) {
      notifyError(t('editor.loginRequired'));
      return;
    }
    setSaving(true);
    try {
      await props.feature.saveItem({
        id: src()?.id,
        type: type(),
        data: {
          title: itemTitle,
          username: username().trim() || undefined,
          password: password() || undefined,
          totp: totp().trim() || undefined,
          recoveryCodes: recoveryCodes().join('\n') || undefined,
          passkeys: passkeys(),
          url: url().trim() || undefined,
          notes: notes() || undefined,
        },
      });
      props.onClose();
    } catch (error) {
      setSaving(false);
      notifyError(errorMessage(error));
    }
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !saving()) doSave();
  }

  function setCode(index: number, value: string) {
    setRecoveryCodes((codes) => codes.map((code, i) => (i === index ? value : code)));
  }
  function addCode() {
    setRecoveryCodes((codes) => [...codes, '']);
  }
  function removeCode(index: number) {
    setRecoveryCodes((codes) => codes.filter((_, i) => i !== index));
  }
  function removePasskey(index: number) {
    setPasskeys((keys) => keys.filter((_, i) => i !== index));
  }

  return (
    <div class="detail-pane">
      <div class="detail-scroll">
        <div class="detail-header editor-header">
          <div class="editor-head">
            <button class="icon-btn detail-back" onClick={props.onClose} aria-label={t('common.back')}>
              <IconBack size={16} />
            </button>
            <div class="editor-title font-serif">{isEdit() ? t('editor.edit') : t('editor.new')}</div>
          </div>
        </div>

        <Show when={!isEdit()}>
          <div class="detail-section">
            <div class="field-label">{t('editor.type')}</div>
            <div class="type-switch" role="radiogroup" aria-label={t('editor.type')}>
              <button
                class={`type-chip${type() === 'login' ? ' active' : ''}`}
                onClick={() => setType('login')}
                role="radio"
                aria-checked={type() === 'login'}
              >
                {t('editor.login')}
              </button>
              <button
                class={`type-chip${type() === 'note' ? ' active' : ''}`}
                onClick={() => setType('note')}
                role="radio"
                aria-checked={type() === 'note'}
              >
                {t('editor.note')}
              </button>
            </div>
          </div>
        </Show>

        <div class="detail-section">
          <div class="field-group">
            <label class="field-label" for="editor-title">{t('editor.title')}</label>
            <input
              id="editor-title"
              class="fog-input"
              value={title()}
              onInput={(e) => setTitle(e.currentTarget.value)}
              placeholder={type() === 'note' ? t('editor.titlePlaceholderNote') : t('editor.titlePlaceholderLogin')}
              autofocus
            />
          </div>

          <Show when={type() === 'login'}>
            <div class="field-group">
              <label class="field-label" for="editor-url">{t('editor.url')}</label>
              <input
                id="editor-url"
                class="fog-input"
                value={url()}
                onInput={(e) => setUrl(e.currentTarget.value)}
                placeholder={t('editor.urlPlaceholder')}
              />
            </div>
            <div class="field-group">
              <label class="field-label" for="editor-username">{t('editor.username')}</label>
              <input
                id="editor-username"
                class="fog-input"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                placeholder={t('editor.usernamePlaceholder')}
              />
            </div>
            <div class="field-group">
              <label class="field-label" for="editor-password">{t('editor.password')}</label>
              <div class="editor-pw">
                <input
                  id="editor-password"
                  class="fog-input"
                  type={showPw() ? 'text' : 'password'}
                  value={password()}
                  onInput={(e) => setPassword(e.currentTarget.value)}
                  placeholder={t('editor.passwordPlaceholder')}
                />
                <button
                  class="icon-btn"
                  onClick={() => setShowPw(!showPw())}
                  title={showPw() ? t('editor.hidePassword') : t('editor.showPassword')}
                  aria-label={showPw() ? t('editor.hidePassword') : t('editor.showPassword')}
                >
                  <Show when={showPw()} fallback={<IconEye size={15} />}>
                    <IconEyeOff size={15} />
                  </Show>
                </button>
              </div>
            </div>
            <div class="field-group">
              <label class="field-label" for="editor-totp">{t('editor.totp')}</label>
              <div class="editor-pw">
                <input
                  id="editor-totp"
                  class="fog-input"
                  type={showTotp() ? 'text' : 'password'}
                  value={totp()}
                  onInput={(e) => setTotp(e.currentTarget.value)}
                  placeholder={t('editor.totpPlaceholder')}
                  spellcheck={false}
                />
                <button
                  class="icon-btn"
                  onClick={() => setShowTotp(!showTotp())}
                  title={showTotp() ? t('editor.hideTotp') : t('editor.showTotp')}
                  aria-label={showTotp() ? t('editor.hideTotp') : t('editor.showTotp')}
                >
                  <Show when={showTotp()} fallback={<IconEye size={15} />}>
                    <IconEyeOff size={15} />
                  </Show>
                </button>
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">{t('editor.recoveryCodes')}</label>
              <div class="code-list">
                <For each={recoveryCodes()}>
                  {(code, i) => (
                    <div class="code-row">
                      <input
                        class="fog-input"
                        value={code}
                        onInput={(e) => setCode(i(), e.currentTarget.value)}
                        placeholder={t('editor.recoveryCodesPlaceholder')}
                        spellcheck={false}
                      />
                      <button class="icon-btn" onClick={() => removeCode(i())} title={t('common.delete')} aria-label={t('common.delete')}>
                        <IconTrash size={14} />
                      </button>
                    </div>
                  )}
                </For>
                <button class="btn btn-ghost" onClick={addCode}>{t('common.add')}</button>
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">{t('editor.passkeys')}</label>
              <div class="passkey-list">
                <For each={passkeys()}>
                  {(pk, i) => (
                    <div class="passkey-row">
                      <span class="passkey-text">{pk}</span>
                      <button class="icon-btn danger" onClick={() => removePasskey(i())} title={t('common.delete')} aria-label={t('common.delete')}>
                        <IconTrash size={14} />
                      </button>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>

          <div class="field-group">
            <label class="field-label" for="editor-notes">
              {type() === 'note' ? t('editor.content') : t('editor.notes')}
            </label>
            <textarea
              id="editor-notes"
              class="fog-input fog-textarea"
              value={notes()}
              onInput={(e) => setNotes(e.currentTarget.value)}
              placeholder={type() === 'note' ? t('editor.notePlaceholder') : t('editor.notesPlaceholder')}
            />
          </div>

        </div>

        <div class="editor-actions">
          <button class="btn btn-ghost" onClick={props.onClose}>{t('common.cancel')}</button>
          <button class="btn btn-primary" onClick={doSave} onKeyDown={handleKey} disabled={saving()}>
            {saving() ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
