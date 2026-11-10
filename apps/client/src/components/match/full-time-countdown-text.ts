const MINUTE_S = 60;
const HOUR_S = 60 * MINUTE_S;

export const COUNTDOWN_REGION_LABEL = 'フルタイムまでの残り時間';

export const COUNTDOWN_LABEL = 'フルタイムまであと';

export const COUNTDOWN_PLACEHOLDER = '--:--:--';

export const COUNTDOWN_END_SUFFIX = '終了';

const twoDigits = (value: number): string => String(value).padStart(2, '0');

export const countdownDigitsOf = (remainingSeconds: number): string => {
  const seconds = Math.max(0, remainingSeconds);
  const hours = Math.floor(seconds / HOUR_S);
  const minutes = Math.floor((seconds % HOUR_S) / MINUTE_S);
  return `${twoDigits(hours)}:${twoDigits(minutes)}:${twoDigits(seconds % MINUTE_S)}`;
};

export const countdownReadingOf = (remainingSeconds: number): string => {
  const hours = Math.floor(remainingSeconds / HOUR_S);
  const minutes = Math.floor((remainingSeconds % HOUR_S) / MINUTE_S);
  if (hours > 0) {
    return `${COUNTDOWN_LABEL}${String(hours)}時間${String(minutes)}分`;
  }
  if (minutes > 0) {
    return `${COUNTDOWN_LABEL}${String(minutes)}分`;
  }
  return `${COUNTDOWN_LABEL}1分未満`;
};
