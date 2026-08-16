import { For } from 'solid-js';
import { accountMatches, itemContentFor, saveAccountCredential, saveItem, state } from '../../lib/store';
import { errorMessage } from '../../lib/errors';
import { notifyError, notifyOk } from '../../lib/notify';
import { showDialog, hideDialog } from '../../lib/dialog';
import { t } from '../../lib/i18n';
import type { VaultItem } from '../../lib/types';

type ParsedTotp = { title: string; secret: string; account?: string; service?: string };

function parseOtpauthUri(uri: string): ParsedTotp | null {
  try {
    const url = new URL(uri);
    if (url.protocol !== 'otpauth:' || !url.pathname.includes('/')) return null;
    const secret = url.searchParams.get('secret');
    if (!secret) return null;
    const path = decodeURIComponent(url.pathname.slice(1));
    const label = path.includes('/') ? path.split('/').slice(1).join('/') : path;
    const title = url.searchParams.get('issuer') || label.split(':')[0] || label;
    const account = label.includes(':') ? label.split(':').slice(1).join(':') : undefined;
    return { title, secret, account, service: url.searchParams.get('issuer') || title };
  } catch {
    return null;
  }
}

async function runTotpAction(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    notifyError(errorMessage(error, 'operation_failed'));
  }
}

function totpCredentialPatch(parsed: ParsedTotp) {
  return {
    totp: parsed.secret,
    ...(parsed.account ? { username: parsed.account } : {}),
  };
}

async function createTotpItem(parsed: ParsedTotp) {
  await saveItem({ type: 'login', data: { title: parsed.title, totp: parsed.secret, username: parsed.account } });
  notifyOk(t('list.totpAdded', { title: parsed.title }));
}

async function updateTotpItem(item: VaultItem, parsed: ParsedTotp) {
  await saveAccountCredential(item, totpCredentialPatch(parsed));
  notifyOk(t('list.totpUpdated', { title: item.title }));
}

function showCredentialChoice(parsed: ParsedTotp, candidates: VaultItem[]) {
  showDialog(
    t('list.chooseAccountTitle'),
    <div class="credential-choice-list">
      <p class="dialog-desc">{t('list.chooseAccountHint')}</p>
      <For each={candidates}>
        {(item) => (
          <button class="credential-choice" onClick={() => {
            hideDialog();
            void runTotpAction(() => updateTotpItem(item, parsed));
          }}>
            <span class="credential-choice-title">{item.title}</span>
            <span class="credential-choice-meta">{item.username || t('list.noUsername')}{item.url ? ` · ${item.url}` : ''}</span>
          </button>
        )}
      </For>
      <button class="btn btn-primary credential-choice-new" onClick={() => {
        hideDialog();
        void runTotpAction(() => createTotpItem(parsed));
      }}>
        {t('list.createAccount')}
      </button>
    </div>,
  );
}

/// Adds a TOTP from a scanned/decoded otpauth:// URI, matching against existing
/// login items and prompting the user when several could be the target.
export async function addTotpFromUri(uri: string): Promise<void> {
  const parsed = parseOtpauthUri(uri);
  if (!parsed) {
    notifyError(t('error.invalidTotp'));
    return;
  }
  try {
    const candidates = (await Promise.all(
      state.items
        .filter((item) => item.type === 'login')
        .map(async (item) => {
          const data = await itemContentFor(item.id);
          return accountMatches(item, data, parsed.account, parsed.service, parsed.title) ? item : null;
        }),
    )).filter((item): item is VaultItem => item !== null);
    if (candidates.length === 0) {
      await runTotpAction(() => createTotpItem(parsed));
      return;
    }
    if (candidates.length === 1) {
      await runTotpAction(() => updateTotpItem(candidates[0], parsed));
      return;
    }
    showCredentialChoice(parsed, candidates);
  } catch (error) {
    notifyError(errorMessage(error, 'operation_failed'));
  }
}
