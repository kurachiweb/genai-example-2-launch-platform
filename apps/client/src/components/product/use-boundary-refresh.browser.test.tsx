import { afterEach, describe, expect, test, vi } from 'vitest';
import { renderHook } from 'vitest-browser-react';

import {
  BOUNDARY_REFRESH_DELAY_MS,
  useBoundaryRefresh,
} from './use-boundary-refresh.ts';

const NOW = new Date('2026-11-11T07:00:00.000Z');
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
// setTimeoutが即時に実行してしまう待ちの上限(2^31-1ミリ秒)を超える先
const BEYOND_TIMER_LIMIT_MS = 30 * DAY_MS;

const isoAfter = (milliseconds: number): string =>
  new Date(NOW.getTime() + milliseconds).toISOString();

const useClock = (): void => {
  vi.useFakeTimers({
    now: NOW,
    toFake: ['Date', 'setTimeout', 'clearTimeout'],
  });
};

afterEach(() => {
  vi.useRealTimers();
});

describe('useBoundaryRefresh', () => {
  test('最も近い境界を過ぎた時刻(時計のずれの分の遅れを含む)に1回取り直す', async () => {
    useClock();
    const refresh = vi.fn();
    await renderHook(() => {
      useBoundaryRefresh([isoAfter(10 * MINUTE_MS)], refresh);
    });

    await vi.advanceTimersByTimeAsync(
      10 * MINUTE_MS + BOUNDARY_REFRESH_DELAY_MS - 1,
    );
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('取り直しても境界が変わらなければ、残りの境界ごとに取り直し、過ぎた境界では取り直さない', async () => {
    useClock();
    const refresh = vi.fn();
    await renderHook(() => {
      useBoundaryRefresh(
        [isoAfter(DAY_MS), isoAfter(-MINUTE_MS), isoAfter(MINUTE_MS)],
        refresh,
      );
    });

    await vi.advanceTimersByTimeAsync(MINUTE_MS + BOUNDARY_REFRESH_DELAY_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(DAY_MS - MINUTE_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  test('境界が無ければ取り直さない', async () => {
    useClock();
    const refresh = vi.fn();
    await renderHook(() => {
      useBoundaryRefresh([], refresh);
    });

    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(refresh).not.toHaveBeenCalled();
  });

  test('タイマーの待ちの上限より先の境界は、すぐには取り直さず、その時刻に取り直す', async () => {
    useClock();
    const refresh = vi.fn();
    await renderHook(() => {
      useBoundaryRefresh([isoAfter(BEYOND_TIMER_LIMIT_MS)], refresh);
    });

    await vi.advanceTimersByTimeAsync(MINUTE_MS);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(
      BEYOND_TIMER_LIMIT_MS - MINUTE_MS + BOUNDARY_REFRESH_DELAY_MS - 1,
    );
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test('アンマウントした後は取り直さない', async () => {
    useClock();
    const refresh = vi.fn();
    const { unmount } = await renderHook(() => {
      useBoundaryRefresh([isoAfter(MINUTE_MS)], refresh);
    });

    await unmount();
    await vi.advanceTimersByTimeAsync(DAY_MS);
    expect(refresh).not.toHaveBeenCalled();
  });
});
