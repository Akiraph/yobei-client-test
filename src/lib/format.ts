import { t } from './i18n';

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  const day = Math.floor(diff / 86400000);

  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minutesAgo', { count: min });
  if (day < 1) return t('time.today');
  if (day < 7) return t('time.daysAgo', { count: day });
  if (day < 30) return t('time.weeksAgo', { count: Math.floor(day / 7) });
  return t('time.monthsAgo', { count: Math.floor(day / 30) });
}

export function initial(title: string): string {
  return title.trim().charAt(0).toUpperCase();
}
