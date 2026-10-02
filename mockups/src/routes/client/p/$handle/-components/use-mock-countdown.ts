import { useCallback, useState } from 'react';

import { useCountdown } from '#/lib/countdown';
import type { Countdown } from '#/lib/countdown';

// モックの現在時刻からの残り時間を、実時間の経過に合わせて減らしていく
export function useMockCountdown(
  target: Date,
  mockNow: Date,
): Countdown | null {
  const [loadedAt] = useState(() => Date.now());
  const offset = target.getTime() - mockNow.getTime();
  const getTarget = useCallback(
    () => new Date(loadedAt + offset),
    [loadedAt, offset],
  );
  return useCountdown(getTarget);
}
