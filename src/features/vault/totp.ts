import { actions } from '../../core/state';
import { t } from '../../core/locale';

export async function addTotpFromUri(uri: string): Promise<void> {
  const match = uri.match(/secret=([^&]+)/i);
  if (!match) throw new Error('invalid_qr');

  const title = uri.match(/^otpauth:\/\/totp\/([^?]+)/i)?.[1] ?? t('list.new');
  await actions.save({
    type: 'login',
    data: {
      title: decodeURIComponent(title),
      totp: decodeURIComponent(match[1]),
    },
  });
}
