import { describe, expect, test } from 'bun:test';

import {
  applyHit,
  type CounterRule,
  type WindowState,
  windowEndsAt,
} from './fixed-window.ts';

const rule: CounterRule = {
  name: 'email-resend-by-address',
  limit: 3,
  windowSeconds: 60,
};
const WINDOW_MS = 60_000;
const STARTED_AT = Date.UTC(2026, 9, 25, 3, 0, 0);

describe('applyHit', () => {
  test('状態が無ければ最初の要求の時点で期間を始め、期間の終わりにAlarmを予約する', () => {
    const outcome = applyHit(undefined, STARTED_AT, rule);

    expect(outcome).toEqual({
      next: { count: 1, windowStartedAt: STARTED_AT, windowSeconds: 60 },
      decision: {
        allowed: true,
        count: 1,
        remaining: 2,
        resetAt: STARTED_AT + WINDOW_MS,
      },
      scheduleAlarmAt: STARTED_AT + WINDOW_MS,
    });
  });

  test('期間内で上限未満なら回数を1増やし、リセット時刻を変えずAlarmを予約しない', () => {
    const state: WindowState = {
      count: 1,
      windowStartedAt: STARTED_AT,
      windowSeconds: 60,
    };

    const outcome = applyHit(state, STARTED_AT + 30_000, rule);

    expect(outcome).toEqual({
      next: { count: 2, windowStartedAt: STARTED_AT, windowSeconds: 60 },
      decision: {
        allowed: true,
        count: 2,
        remaining: 1,
        resetAt: STARTED_AT + WINDOW_MS,
      },
      scheduleAlarmAt: undefined,
    });
  });

  test('上限に達していれば拒否し、保存する状態を返さずリセット時刻を変えない', () => {
    const state: WindowState = {
      count: 3,
      windowStartedAt: STARTED_AT,
      windowSeconds: 60,
    };

    const outcome = applyHit(state, STARTED_AT + 59_999, rule);

    expect(outcome).toEqual({
      next: undefined,
      decision: {
        allowed: false,
        count: 3,
        remaining: 0,
        resetAt: STARTED_AT + WINDOW_MS,
      },
      scheduleAlarmAt: undefined,
    });
  });

  test('上限までの要求を許可して残り回数を減らし、上限を超えた要求を拒否し続ける', () => {
    const decisions = [];
    let state: WindowState | undefined;
    for (let offset = 0; offset < 5; offset += 1) {
      const outcome = applyHit(state, STARTED_AT + offset * 1000, rule);
      decisions.push(outcome.decision);
      state = outcome.next ?? state;
    }

    expect(
      decisions.map(({ allowed, count, remaining }) => ({
        allowed,
        count,
        remaining,
      })),
    ).toEqual([
      { allowed: true, count: 1, remaining: 2 },
      { allowed: true, count: 2, remaining: 1 },
      { allowed: true, count: 3, remaining: 0 },
      { allowed: false, count: 3, remaining: 0 },
      { allowed: false, count: 3, remaining: 0 },
    ]);
    expect(new Set(decisions.map(({ resetAt }) => resetAt))).toEqual(
      new Set([STARTED_AT + WINDOW_MS]),
    );
    expect(state).toEqual({
      count: 3,
      windowStartedAt: STARTED_AT,
      windowSeconds: 60,
    });
  });

  test('期間の終わりちょうどの要求は、上限に達していても新しい期間を始める', () => {
    const state: WindowState = {
      count: 3,
      windowStartedAt: STARTED_AT,
      windowSeconds: 60,
    };
    const now = STARTED_AT + WINDOW_MS;

    const outcome = applyHit(state, now, rule);

    expect(outcome).toEqual({
      next: { count: 1, windowStartedAt: now, windowSeconds: 60 },
      decision: {
        allowed: true,
        count: 1,
        remaining: 2,
        resetAt: now + WINDOW_MS,
      },
      scheduleAlarmAt: now + WINDOW_MS,
    });
  });

  test('期限切れから時間が経った要求は、その時点を新しい期間の開始にする', () => {
    const state: WindowState = {
      count: 2,
      windowStartedAt: STARTED_AT,
      windowSeconds: 60,
    };
    const now = STARTED_AT + 5 * WINDOW_MS + 123;

    const outcome = applyHit(state, now, rule);

    expect(outcome.next).toEqual({
      count: 1,
      windowStartedAt: now,
      windowSeconds: 60,
    });
    expect(outcome.decision.resetAt).toBe(now + WINDOW_MS);
    expect(outcome.scheduleAlarmAt).toBe(now + WINDOW_MS);
  });

  test('期限の判定には、規則ではなく期間を始めたときに保存した長さを使う', () => {
    const state: WindowState = {
      count: 3,
      windowStartedAt: STARTED_AT,
      windowSeconds: 10,
    };
    const now = STARTED_AT + 10_000;

    const outcome = applyHit(state, now, rule);

    expect(outcome.next).toEqual({
      count: 1,
      windowStartedAt: now,
      windowSeconds: 60,
    });
    expect(outcome.scheduleAlarmAt).toBe(now + WINDOW_MS);
  });

  test('上限を下げた規則で、保存済みの回数が上限を超えていても残り回数は0になる', () => {
    const state: WindowState = {
      count: 5,
      windowStartedAt: STARTED_AT,
      windowSeconds: 60,
    };

    const outcome = applyHit(state, STARTED_AT + 1000, rule);

    expect(outcome.next).toBeUndefined();
    expect(outcome.decision).toEqual({
      allowed: false,
      count: 5,
      remaining: 0,
      resetAt: STARTED_AT + WINDOW_MS,
    });
  });

  test('渡した状態を書き換えない', () => {
    const state: WindowState = Object.freeze({
      count: 1,
      windowStartedAt: STARTED_AT,
      windowSeconds: 60,
    });

    const outcome = applyHit(state, STARTED_AT + 1000, rule);

    expect(outcome.next).not.toBe(state);
    expect(state).toEqual({
      count: 1,
      windowStartedAt: STARTED_AT,
      windowSeconds: 60,
    });
  });

  test.each([
    ['上限が0', { ...rule, limit: 0 }],
    ['上限が小数', { ...rule, limit: 1.5 }],
    ['上限がNaN', { ...rule, limit: Number.NaN }],
    ['期間が0秒', { ...rule, windowSeconds: 0 }],
    ['期間が小数', { ...rule, windowSeconds: 0.5 }],
    ['期間が無限大', { ...rule, windowSeconds: Number.POSITIVE_INFINITY }],
  ])('%sの規則はRangeErrorにする', (_label, invalidRule) => {
    expect(() => applyHit(undefined, STARTED_AT, invalidRule)).toThrow(
      RangeError,
    );
  });

  test('現在時刻が有限の数でなければRangeErrorにする', () => {
    expect(() => applyHit(undefined, Number.NaN, rule)).toThrow(RangeError);
  });
});

describe('windowEndsAt', () => {
  test('期間の開始時刻に期間の秒数をミリ秒にして足した時刻を返す', () => {
    expect(
      windowEndsAt({ count: 1, windowStartedAt: 1_000, windowSeconds: 60 }),
    ).toBe(61_000);
  });
});
