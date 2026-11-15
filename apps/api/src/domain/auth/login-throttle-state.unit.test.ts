import { describe, expect, test } from 'bun:test';

import {
  alarmOutcome,
  applyFailure,
  cooldownMs,
  currentStatus,
  LOGIN_BASE_COOLDOWN_MS,
  LOGIN_FAILURE_RETENTION_MS,
  LOGIN_FREE_ATTEMPTS,
  LOGIN_MAX_COOLDOWN_MS,
  type LoginThrottleState,
} from './login-throttle-state.ts';

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;
const DAY_MS = 24 * HOUR_MS;

const START = Date.parse('2026-11-02T00:00:00.000Z');

const failWithUnlockBetween = (
  count: number,
): LoginThrottleState | undefined => {
  let state: LoginThrottleState | undefined;
  for (let index = 0; index < count; index += 1) {
    state = { ...applyFailure(state, START).next, lockedUntil: undefined };
  }
  return state;
};

const countingState = (failures: number): LoginThrottleState => ({
  failures,
  lockedUntil: undefined,
  lastFailureAt: START,
});

describe('定数', () => {
  test('5回まで無制限、初回1秒・上限5分のクールダウン、24時間の保持を持つ', () => {
    expect(LOGIN_FREE_ATTEMPTS).toBe(5);
    expect(LOGIN_BASE_COOLDOWN_MS).toBe(1000);
    expect(LOGIN_MAX_COOLDOWN_MS).toBe(300_000);
    expect(LOGIN_FAILURE_RETENTION_MS).toBe(86_400_000);
  });
});

describe('cooldownMs', () => {
  test.each([0, 1, 5])('失敗%i回ではクールダウンが無い', (failures) => {
    expect(cooldownMs(failures)).toBe(0);
  });

  test.each([
    [6, 1000],
    [7, 2000],
    [8, 4000],
    [13, 128_000],
    [14, 256_000],
  ])('失敗%i回のクールダウンは%iミリ秒', (failures, expected) => {
    expect(cooldownMs(failures)).toBe(expected);
  });

  test.each([15, 16, 100, 2000])(
    '失敗%i回のクールダウンは上限の300秒',
    (failures) => {
      expect(cooldownMs(failures)).toBe(300_000);
    },
  );
});

describe('currentStatus', () => {
  test('記録が無ければロックしていない', () => {
    expect(currentStatus(undefined, START)).toEqual({ locked: false });
  });

  test('ロックの無い記録ではロックしていない', () => {
    expect(currentStatus(countingState(5), START)).toEqual({ locked: false });
  });

  test('ロックの終了前はロック中で、残りの秒を切り上げて返す', () => {
    const state: LoginThrottleState = {
      failures: 7,
      lockedUntil: START + 2000,
      lastFailureAt: START,
    };
    expect(currentStatus(state, START)).toEqual({
      locked: true,
      retryAfterSeconds: 2,
    });
    expect(currentStatus(state, START + 1001)).toEqual({
      locked: true,
      retryAfterSeconds: 1,
    });
    expect(currentStatus(state, START + 1999)).toEqual({
      locked: true,
      retryAfterSeconds: 1,
    });
  });

  test('ロックの終了時刻ちょうどからはロックしていない', () => {
    const state: LoginThrottleState = {
      failures: 6,
      lockedUntil: START + 1000,
      lastFailureAt: START,
    };
    expect(currentStatus(state, START + 1000)).toEqual({ locked: false });
  });

  test('最後の失敗から24時間ちょうどからは記録が無いものとして扱う', () => {
    const state: LoginThrottleState = {
      failures: 15,
      lockedUntil: START + DAY_MS + 1,
      lastFailureAt: START,
    };
    expect(currentStatus(state, START + DAY_MS - 1)).toEqual({
      locked: true,
      retryAfterSeconds: 1,
    });
    expect(currentStatus(state, START + DAY_MS)).toEqual({ locked: false });
  });
});

describe('applyFailure', () => {
  test('記録が無ければ1回目として数え、ロックせず24時間後にアラームを置く', () => {
    expect(applyFailure(undefined, START)).toEqual({
      next: { failures: 1, lockedUntil: undefined, lastFailureAt: START },
      status: { locked: false },
      alarmAt: START + DAY_MS,
    });
  });

  test.each([2, 3, 4, 5])('%i回目まではロックしない', (failures) => {
    const now = START + 10 * SECOND_MS;
    expect(applyFailure(countingState(failures - 1), now)).toEqual({
      next: { failures, lockedUntil: undefined, lastFailureAt: now },
      status: { locked: false },
      alarmAt: now + DAY_MS,
    });
  });

  test('6回目で1秒ロックし、アラームをロックの終了時刻に置く', () => {
    const now = START + 10 * SECOND_MS;
    expect(applyFailure(countingState(5), now)).toEqual({
      next: { failures: 6, lockedUntil: now + 1000, lastFailureAt: now },
      status: { locked: true, retryAfterSeconds: 1 },
      alarmAt: now + 1000,
    });
  });

  test.each([
    [6, 1000, 1],
    [7, 2000, 2],
    [14, 256_000, 256],
    [15, 300_000, 300],
    [16, 300_000, 300],
    [30, 300_000, 300],
  ])(
    'ロックの解けた後の%i回目の失敗は%iミリ秒ロックする',
    (failures, cooldown, retryAfterSeconds) => {
      const result = applyFailure(failWithUnlockBetween(failures - 1), START);
      expect(result.next).toEqual({
        failures,
        lockedUntil: START + cooldown,
        lastFailureAt: START,
      });
      expect(result.status).toEqual({ locked: true, retryAfterSeconds });
      expect(result.alarmAt).toBe(START + cooldown);
    },
  );

  test('ロック中の失敗は数えず、記録とアラームを変えない', () => {
    const locked: LoginThrottleState = {
      failures: 7,
      lockedUntil: START + 2000,
      lastFailureAt: START,
    };
    expect(applyFailure(locked, START + 500)).toEqual({
      next: locked,
      status: { locked: true, retryAfterSeconds: 2 },
      alarmAt: START + 2000,
    });
  });

  test('ロックの終了時刻ちょうどの失敗は数え、倍のクールダウンでロックする', () => {
    const state: LoginThrottleState = {
      failures: 6,
      lockedUntil: START + 1000,
      lastFailureAt: START,
    };
    const now = START + 1000;
    expect(applyFailure(state, now)).toEqual({
      next: { failures: 7, lockedUntil: now + 2000, lastFailureAt: now },
      status: { locked: true, retryAfterSeconds: 2 },
      alarmAt: now + 2000,
    });
  });

  test('最後の失敗から24時間を過ぎた記録は無いものとして1回目から数え直す', () => {
    const state: LoginThrottleState = {
      failures: 15,
      lockedUntil: undefined,
      lastFailureAt: START,
    };
    const now = START + DAY_MS;
    expect(applyFailure(state, now)).toEqual({
      next: { failures: 1, lockedUntil: undefined, lastFailureAt: now },
      status: { locked: false },
      alarmAt: now + DAY_MS,
    });
  });

  test('24時間の直前の失敗は数え続ける', () => {
    const now = START + DAY_MS - 1;
    expect(applyFailure(countingState(5), now).next).toEqual({
      failures: 6,
      lockedUntil: now + 1000,
      lastFailureAt: now,
    });
  });

  test('引数の記録を書き換えない', () => {
    const state = countingState(5);
    const snapshot = { ...state };
    applyFailure(state, START + 1);
    expect(state).toEqual(snapshot);
  });
});

describe('alarmOutcome', () => {
  test('ロックの終了時刻を過ぎたらロックだけを解いて回数を残し、最後の失敗から24時間後にアラームを置き直す', () => {
    const state: LoginThrottleState = {
      failures: 7,
      lockedUntil: START + 2000,
      lastFailureAt: START,
    };
    expect(alarmOutcome(state, START + 2000)).toEqual({
      kind: 'unlock',
      next: { failures: 7, lockedUntil: undefined, lastFailureAt: START },
      alarmAt: START + DAY_MS,
    });
    expect(alarmOutcome(state, START + 2500)).toEqual({
      kind: 'unlock',
      next: { failures: 7, lockedUntil: undefined, lastFailureAt: START },
      alarmAt: START + DAY_MS,
    });
  });

  test('ロックを解いた後の次の失敗は倍のクールダウンでロックする', () => {
    const locked = applyFailure(countingState(5), START).next;
    const outcome = alarmOutcome(locked, START + 1000);
    if (outcome.kind !== 'unlock') {
      throw new Error('ロックが解けていません。');
    }
    expect(currentStatus(outcome.next, START + 1000)).toEqual({
      locked: false,
    });
    const now = START + 5000;
    expect(applyFailure(outcome.next, now)).toEqual({
      next: { failures: 7, lockedUntil: now + 2000, lastFailureAt: now },
      status: { locked: true, retryAfterSeconds: 2 },
      alarmAt: now + 2000,
    });
  });

  test('最後の失敗から24時間ちょうどからは記録を消す', () => {
    expect(alarmOutcome(countingState(3), START + DAY_MS)).toEqual({
      kind: 'clear',
    });
    expect(alarmOutcome(countingState(3), START + DAY_MS + HOUR_MS)).toEqual({
      kind: 'clear',
    });
  });

  test('24時間を過ぎていればロックが残っていても記録を消す', () => {
    const state: LoginThrottleState = {
      failures: 15,
      lockedUntil: START + DAY_MS + 1,
      lastFailureAt: START,
    };
    expect(alarmOutcome(state, START + DAY_MS)).toEqual({ kind: 'clear' });
  });

  test('ロックの終了前に起きたらロックの終了時刻へ置き直す', () => {
    const state: LoginThrottleState = {
      failures: 6,
      lockedUntil: START + 1000,
      lastFailureAt: START,
    };
    expect(alarmOutcome(state, START + 999)).toEqual({
      kind: 'reschedule',
      alarmAt: START + 1000,
    });
  });

  test('ロックの終了が24時間より後なら最後の失敗から24時間後へ置き直す', () => {
    const state: LoginThrottleState = {
      failures: 15,
      lockedUntil: START + DAY_MS + 1,
      lastFailureAt: START,
    };
    expect(alarmOutcome(state, START + DAY_MS - 1)).toEqual({
      kind: 'reschedule',
      alarmAt: START + DAY_MS,
    });
  });

  test('ロックが無く24時間の前に起きたら最後の失敗から24時間後へ置き直す', () => {
    expect(alarmOutcome(countingState(3), START + DAY_MS - 1)).toEqual({
      kind: 'reschedule',
      alarmAt: START + DAY_MS,
    });
  });

  test('引数の記録を書き換えない', () => {
    const state: LoginThrottleState = {
      failures: 6,
      lockedUntil: START + 1000,
      lastFailureAt: START,
    };
    const snapshot = { ...state };
    alarmOutcome(state, START + 1000);
    expect(state).toEqual(snapshot);
  });
});
