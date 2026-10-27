const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const AVERAGE_MONTH_DAYS = 30.44;
const ELAPSED_LIMIT_DAYS = 30;
const REMAINING_MONTH_THRESHOLD_DAYS = 60;

export const formatElapsed = (from: Date, now: Date): string | null => {
  const elapsed = now.getTime() - from.getTime();
  if (elapsed < MINUTE_MS) {
    return 'たった今';
  }
  if (elapsed < HOUR_MS) {
    return `${String(Math.floor(elapsed / MINUTE_MS))}分前`;
  }
  if (elapsed < DAY_MS) {
    return `${String(Math.floor(elapsed / HOUR_MS))}時間前`;
  }
  const days = Math.floor(elapsed / DAY_MS);
  return days < ELAPSED_LIMIT_DAYS ? `${String(days)}日前` : null;
};

export const formatRemaining = (target: Date, now: Date): string => {
  const remaining = target.getTime() - now.getTime();
  if (remaining <= 0) {
    return '期限切れ';
  }
  if (remaining < HOUR_MS) {
    return `あと${String(Math.max(1, Math.floor(remaining / MINUTE_MS)))}分`;
  }
  if (remaining < DAY_MS) {
    return `あと${String(Math.floor(remaining / HOUR_MS))}時間`;
  }
  const days = Math.floor(remaining / DAY_MS);
  if (days < REMAINING_MONTH_THRESHOLD_DAYS) {
    return `あと${String(days)}日`;
  }
  return `あと約${String(Math.round(days / AVERAGE_MONTH_DAYS))}か月`;
};
