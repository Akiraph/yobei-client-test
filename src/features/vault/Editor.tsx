import { For, Show, createSignal } from 'solid-js';
import { errorKey } from '../../core/errors';
import { t } from '../../core/locale';
import { actions } from '../../core/state';
import type { ItemData, ItemType } from '../../core/types';
import { IconBack, IconEye, IconEyeOff, IconTrash } from '../../ui/icons';
import { notify } from '../../ui/notifications';

interface EditorProps {
  id?: string;
  source: ItemData | null | undefined;
  initialType?: ItemType;
  onClose: () => void;
}

export default function Editor(props: EditorProps) {
  const [type, setType] = createSignal<ItemType>(props.initialType ?? 'login');
  const [title, setTitle] = createSignal(props.source?.title ?? '');
  const [url, setUrl] = createSignal(props.source?.url ?? '');
  const [username, setUsername] = createSignal(props.source?.username ?? '');
  const [password, setPassword] = createSignal(props.source?.password ?? '');
  const [totp, setTotp] = createSignal(props.source?.totp ?? '');
  const [recoveryCodes, setRecoveryCodes] = createSignal((props.source?.recoveryCodes ?? '').split(/\r?\n/).filter(Boolean));
  const [notes, setNotes] = createSignal(props.source?.notes ?? '');
  const [showPassword, setShowPassword] = createSignal(false);
  const [showTotp, setShowTotp] = createSignal(false);
  const [saving, setSaving] = createSignal(false);

  function updateCode(index: number, value: string) {
    setRecoveryCodes((items) => items.map((item, position) => position === index ? value : item));
  }

  async function save() {
    if (!title().trim()) {
      notify.error(t('editor.titleRequired'));
      return;
    }
    if (type() === 'login' && !username().trim() && !password() && !totp().trim() && !recoveryCodes().length) {
      notify.error(t('editor.loginRequired'));
      return;
    }

    setSaving(true);
    try {
      await actions.save({
        id: props.id,
        type: type(),
        data: {
          title: title().trim(),
          url: url().trim() || undefined,
          username: username().trim() || undefined,
          password: password() || undefined,
          totp: totp().trim() || undefined,
          recoveryCodes: recoveryCodes().filter(Boolean).join('\n') || undefined,
          notes: notes() || undefined,
        },
      });
      props.onClose();
    } catch (error) {
      notify.error(t(errorKey(error)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="detail-pane">
      <div class="detail-scroll">
        <div class="detail-header editor-header">
          <button class="icon-btn detail-back" onClick={props.onClose} aria-label={t('common.back')}>
            <IconBack size={16} />
          </button>
          <div class="editor-title font-serif">{props.id ? t('editor.edit') : t('editor.new')}</div>
        </div>

        <Show when={!props.id}>
          <div class="detail-section">
            <div class="field-label">{t('editor.type')}</div>
            <div class="type-switch">
              <button class={`type-chip${type() === 'login' ? ' active' : ''}`} onClick={() => setType('login')}>{t('editor.login')}</button>
              <button class={`type-chip${type() === 'note' ? ' active' : ''}`} onClick={() => setType('note')}>{t('editor.note')}</button>
            </div>
          </div>
        </Show>

        <EditorField label={t('editor.title')} value={title()} onInput={setTitle} />

        <Show when={type() === 'login'}>
          <EditorField label={t('editor.url')} value={url()} onInput={setUrl} />
          <EditorField label={t('editor.username')} value={username()} onInput={setUsername} />
          <SecretField label={t('editor.password')} value={password()} visible={showPassword()} onVisible={() => setShowPassword((value) => !value)} onInput={setPassword} />
          <SecretField label={t('editor.totp')} value={totp()} visible={showTotp()} onVisible={() => setShowTotp((value) => !value)} onInput={setTotp} />
          <div class="field-group">
            <div class="field-label">{t('editor.recoveryCodes')}</div>
            <For each={recoveryCodes()}>
              {(value, index) => (
                <div class="code-row">
                  <input class="fog-input" value={value} onInput={(event) => updateCode(index(), event.currentTarget.value)} />
                  <button class="icon-btn" onClick={() => setRecoveryCodes((items) => items.filter((_, position) => position !== index()))} aria-label={t('common.delete')}><IconTrash size={14} /></button>
                </div>
              )}
            </For>
            <button class="btn btn-ghost" onClick={() => setRecoveryCodes((items) => [...items, ''])}>{t('common.add')}</button>
          </div>
        </Show>

        <div class="field-group">
          <label class="field-label">{type() === 'note' ? t('editor.content') : t('editor.notes')}</label>
          <textarea class="fog-input fog-textarea" value={notes()} onInput={(event) => setNotes(event.currentTarget.value)} />
        </div>

        <div class="editor-actions">
          <button class="btn btn-ghost" onClick={props.onClose}>{t('common.cancel')}</button>
          <button class="btn btn-primary" onClick={() => void save()} disabled={saving()}>{saving() ? t('common.saving') : t('common.save')}</button>
        </div>
      </div>
    </div>
  );
}

function EditorField(props: { label: string; value: string; onInput: (value: string) => void }) {
  return (
    <div class="field-group">
      <label class="field-label">{props.label}</label>
      <input class="fog-input" value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
    </div>
  );
}

function SecretField(props: { label: string; value: string; visible: boolean; onVisible: () => void; onInput: (value: string) => void }) {
  return (
    <div class="field-group">
      <label class="field-label">{props.label}</label>
      <div class="editor-pw">
        <input class="fog-input" type={props.visible ? 'text' : 'password'} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} />
        <button class="icon-btn" onClick={props.onVisible} aria-label={props.visible ? t('editor.hidePassword') : t('editor.showPassword')}>
          {props.visible ? <IconEyeOff size={15} /> : <IconEye size={15} />}
        </button>
      </div>
    </div>
  );
}
