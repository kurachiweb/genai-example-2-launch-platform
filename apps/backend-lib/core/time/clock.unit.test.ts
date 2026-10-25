import { describe, expect, test } from 'bun:test';

import { systemClock } from './clock.ts';

describe('systemClock', () => {
  test('呼び出した時点の現在時刻を返す', () => {
    const before = Date.now();

    const now = systemClock.now();

    const after = Date.now();
    expect(now).toBeInstanceOf(Date);
    expect(now.getTime()).toBeGreaterThanOrEqual(before);
    expect(now.getTime()).toBeLessThanOrEqual(after);
  });

  test('呼び出しごとに別のDateを返し、利用側の変更が次の呼び出しに影響しない', () => {
    const first = systemClock.now();
    first.setTime(0);

    const second = systemClock.now();

    expect(second).not.toBe(first);
    expect(second.getTime()).toBeGreaterThan(0);
  });
});
