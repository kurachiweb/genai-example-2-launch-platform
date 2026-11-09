import { useSyncExternalStore } from 'react';

import { useDisplayPreferences } from '../../../lib/components/datetime/use-display-preferences.ts';
import { yearInTimeZone } from './launch-date-format.ts';

const subscribeNothing = (): (() => void) => () => undefined;

// 年は表示中に変わることがほぼ無いため購読せず、描画のたびに利用者のタイムゾーンの今年を読む
export function useCurrentYear(): number {
  const { timeZone } = useDisplayPreferences();
  const readYear = (): number => yearInTimeZone(new Date(), timeZone);
  return useSyncExternalStore(subscribeNothing, readYear, readYear);
}
