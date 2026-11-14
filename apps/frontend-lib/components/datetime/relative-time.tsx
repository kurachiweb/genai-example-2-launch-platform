import { useSyncExternalStore } from 'react';

import type { DateTimeFormatName } from '../../utilities/datetime/date-time-formats.ts';
import { toDateTimeValue } from '../../utilities/datetime/date-time-value.ts';
import {
  formatElapsed,
  formatRemaining,
} from '../../utilities/datetime/relative-time.ts';
import { DateTime } from './date-time.tsx';

export interface RelativeTimeProps {
  readonly target: string | Date;
  readonly kind: 'remaining' | 'elapsed';
  readonly format: DateTimeFormatName;
}

const CLOCK_INTERVAL_MS = 60 * 1000;
const IDLE_CLOCK_TOLERANCE_MS = 1000;

// 一覧に多数並んでも更新のタイマーを1つにするため、表示中の部品で現在時刻を共有し、最後の部品が外れたらタイマーを止める
const clockListeners = new Set<() => void>();
let clockNow = 0;
let clockTimer: ReturnType<typeof setInterval> | undefined;

const tickClock = (): void => {
  clockNow = Date.now();
  for (const listener of clockListeners) {
    listener();
  }
};

const subscribeClock = (listener: () => void): (() => void) => {
  clockListeners.add(listener);
  if (clockTimer === undefined) {
    tickClock();
    clockTimer = setInterval(tickClock, CLOCK_INTERVAL_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  };
};

// タイマーが止まっている間に描画する部品が古い時刻を見ないよう読む時に進める。同じ描画の中で続けて読んでも値が変わらないよう、ずれが許容を超えた時だけ進める
const readClock = (): number => {
  const current = Date.now();
  if (
    clockTimer === undefined &&
    Math.abs(current - clockNow) >= IDLE_CLOCK_TOLERANCE_MS
  ) {
    clockNow = current;
  }
  return clockNow;
};

// サーバー側の描画とハイドレーションの時刻はブラウザの時刻と食い違うため、相対表現はハイドレーションの後にだけ出す
const readServerClock = (): null => null;

const relativeTextOf = (
  kind: RelativeTimeProps['kind'],
  target: Date,
  now: Date,
): string | null =>
  kind === 'remaining'
    ? formatRemaining(target, now)
    : formatElapsed(target, now);

export function RelativeTime({ target, kind, format }: RelativeTimeProps) {
  const now = useSyncExternalStore(subscribeClock, readClock, readServerClock);
  const date = toDateTimeValue(target);
  const relative =
    now === null ? null : relativeTextOf(kind, date, new Date(now));
  return (
    <>
      <DateTime value={date} format={format} />
      {relative !== null && <span className="ml-1">({relative})</span>}
    </>
  );
}
