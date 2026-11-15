import { beforeEach, describe, expect, mock, test } from 'bun:test';

import {
  hasTurnstileScriptFailed,
  recordTurnstileScriptFailure,
  resetTurnstileScriptFailure,
  subscribeTurnstileScriptFailure,
} from './turnstile-script-failure.ts';

beforeEach(() => {
  resetTurnstileScriptFailure();
});

describe('turnstile-script-failure', () => {
  test('記録の前は、スクリプトの読み込みに失敗していないと答える', () => {
    expect(hasTurnstileScriptFailed()).toBe(false);
  });

  test('失敗を記録すると、失敗したと答え、購読している全員に1回ずつ知らせる', () => {
    const first = mock(() => undefined);
    const second = mock(() => undefined);
    subscribeTurnstileScriptFailure(first);
    subscribeTurnstileScriptFailure(second);

    recordTurnstileScriptFailure();

    expect(hasTurnstileScriptFailed()).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('記録済みの時に再び記録しても、購読している者に知らせ直さない', () => {
    const listener = mock(() => undefined);
    subscribeTurnstileScriptFailure(listener);
    recordTurnstileScriptFailure();

    recordTurnstileScriptFailure();

    expect(hasTurnstileScriptFailed()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('購読を解除した者には、その後の記録を知らせない', () => {
    const listener = mock(() => undefined);
    const unsubscribe = subscribeTurnstileScriptFailure(listener);

    unsubscribe();
    recordTurnstileScriptFailure();

    expect(listener).not.toHaveBeenCalled();
  });

  test('記録を消すと、失敗していないと答え、購読している者に知らせる', () => {
    recordTurnstileScriptFailure();
    const listener = mock(() => undefined);
    subscribeTurnstileScriptFailure(listener);

    resetTurnstileScriptFailure();

    expect(hasTurnstileScriptFailed()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('記録が無い時に消しても、購読している者に知らせない', () => {
    const listener = mock(() => undefined);
    subscribeTurnstileScriptFailure(listener);

    resetTurnstileScriptFailure();

    expect(listener).not.toHaveBeenCalled();
  });

  test('記録を消した後は、再び失敗を記録して知らせる', () => {
    recordTurnstileScriptFailure();
    resetTurnstileScriptFailure();
    const listener = mock(() => undefined);
    subscribeTurnstileScriptFailure(listener);

    recordTurnstileScriptFailure();

    expect(hasTurnstileScriptFailed()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
