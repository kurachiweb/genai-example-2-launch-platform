import type { Clock } from '../adapters/http-poller.ts';

export interface VirtualClock extends Clock {
  run<T>(work: Promise<T>): Promise<T>;
}

interface Timer {
  readonly at: number;
  readonly wake: () => void;
}

const START_MS = Date.UTC(2026, 10, 23);

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

// 待ちの処理が全て時計の待ちになるまで待ち、最も早い待ちの時刻へ時計を進める。実時間を使わず長い監視を速く終える
export function createVirtualClock(): VirtualClock {
  let current = START_MS;
  const timers: Timer[] = [];

  const advanceToNextTimer = (): void => {
    const next = timers.toSorted((a, b) => a.at - b.at)[0];
    if (next === undefined) {
      throw new Error('時計の待ちが無いため、時計を進められません');
    }
    timers.splice(timers.indexOf(next), 1);
    current = Math.max(current, next.at);
    next.wake();
  };

  return {
    now: () => current,
    sleep: (ms) =>
      new Promise((resolve) => {
        timers.push({ at: current + Math.max(0, ms), wake: resolve });
      }),
    run: async (work) => {
      const state = { settled: false };
      const tracked = work.finally(() => {
        state.settled = true;
      });
      tracked.catch(() => undefined);
      for (;;) {
        await flushMicrotasks();
        if (state.settled) break;
        advanceToNextTimer();
      }
      return tracked;
    },
  };
}
