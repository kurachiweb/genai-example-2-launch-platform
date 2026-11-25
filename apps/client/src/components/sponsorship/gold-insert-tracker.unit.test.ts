import { describe, expect, mock, test } from 'bun:test';

import {
  createGoldInsertTracker,
  goldInsertTracker,
} from './gold-insert-tracker.ts';

describe('createGoldInsertTracker', () => {
  test('差し込みが1つも無い間の描画済みの数は0である', () => {
    const tracker = createGoldInsertTracker();

    expect(tracker.getSnapshot()).toBe(0);
  });

  test('差し込みを登録すると数が増え、購読者へ知らせる', () => {
    const tracker = createGoldInsertTracker();
    const listener = mock(() => undefined);
    tracker.subscribe(listener);

    tracker.register(1);
    tracker.register(2);

    expect(tracker.getSnapshot()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('登録を解除すると数が減り、購読者へ知らせる', () => {
    const tracker = createGoldInsertTracker();
    const unregisterFirst = tracker.register(1);
    tracker.register(2);
    const listener = mock(() => undefined);
    tracker.subscribe(listener);

    unregisterFirst();

    expect(tracker.getSnapshot()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('同じ解除の関数を2回呼んでも1回だけ減らし、2回目は知らせない', () => {
    const tracker = createGoldInsertTracker();
    const unregister = tracker.register(1);
    tracker.register(2);
    const listener = mock(() => undefined);
    tracker.subscribe(listener);

    unregister();
    unregister();

    expect(tracker.getSnapshot()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('同じ位置の差し込みは1つと数え、全ての登録を解除するまで数に残す', () => {
    const tracker = createGoldInsertTracker();
    const listener = mock(() => undefined);
    tracker.subscribe(listener);

    const unregisterFirst = tracker.register(1);
    const unregisterSecond = tracker.register(1);

    expect(tracker.getSnapshot()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);

    unregisterFirst();

    expect(tracker.getSnapshot()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);

    unregisterSecond();

    expect(tracker.getSnapshot()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  test('購読を解除した購読者へは知らせない', () => {
    const tracker = createGoldInsertTracker();
    const listener = mock(() => undefined);
    const unsubscribe = tracker.subscribe(listener);

    unsubscribe();
    tracker.register(1);

    expect(listener).not.toHaveBeenCalled();
  });

  test('複数の購読者の全てへ知らせる', () => {
    const tracker = createGoldInsertTracker();
    const first = mock(() => undefined);
    const second = mock(() => undefined);
    tracker.subscribe(first);
    tracker.subscribe(second);

    tracker.register(1);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  test('サーバーの描画では数が未確定のためnullを返す', () => {
    const tracker = createGoldInsertTracker();
    tracker.register(1);

    expect(tracker.getServerSnapshot()).toBeNull();
  });

  test('useSyncExternalStoreへ渡せるよう、メソッドを取り出して呼んでも同じ追跡の状態を扱う', () => {
    const { register, subscribe, getSnapshot, getServerSnapshot } =
      createGoldInsertTracker();
    const listener = mock(() => undefined);
    subscribe(listener);

    const unregister = register(3);

    expect(getSnapshot()).toBe(1);
    expect(getServerSnapshot()).toBeNull();

    unregister();

    expect(getSnapshot()).toBe(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('goldInsertTracker', () => {
  test('ページの部品が共有する追跡は、差し込みが無い間の数が0である', () => {
    expect(goldInsertTracker.getSnapshot()).toBe(0);
    expect(goldInsertTracker.getServerSnapshot()).toBeNull();
  });
});
