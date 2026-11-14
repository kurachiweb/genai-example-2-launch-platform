import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import type {
  CounterDecision,
  CounterRule,
  WindowState,
} from '../../core/rate-limit/fixed-window.ts';
import type { RateLimitCounter } from './rate-limit-counter.ts';

const WINDOW_STATE_KEY = 'window';
const MILLISECONDS_PER_SECOND = 1000;

// eventの実行時の環境の型には厳密カウンタのバインディングが無いため、型を名前で引かず実物を確かめて取り出す
function isCounterNamespace(
  value: unknown,
): value is DurableObjectNamespace<RateLimitCounter> {
  return typeof value === 'object' && value !== null && 'idFromName' in value;
}

function counterNamespace(): DurableObjectNamespace<RateLimitCounter> {
  const source: object = env;
  const binding: unknown = Reflect.get(source, 'RATE_LIMIT_COUNTER');
  if (!isCounterNamespace(binding)) {
    throw new Error('RATE_LIMIT_COUNTERのバインディングがありません。');
  }
  return binding;
}

function counterStub(name: string): DurableObjectStub<RateLimitCounter> {
  const namespace = counterNamespace();
  return namespace.get(namespace.idFromName(name));
}

interface StoredRecords {
  readonly entries: readonly (readonly [string, unknown])[];
  readonly alarm: number | null;
}

async function readStoredRecords(
  stub: DurableObjectStub<RateLimitCounter>,
): Promise<StoredRecords> {
  return runInDurableObject(stub, async (_instance, state) => ({
    entries: [...state.storage.kv.list()],
    alarm: await state.storage.getAlarm(),
  }));
}

function rule(limit: number, windowSeconds = 60): CounterRule {
  return { name: 'counter-test', limit, windowSeconds };
}

describe('RateLimitCounter', () => {
  test('最初の要求で期間を始め、期間の終わりにAlarmを予約して状態だけを保存する', async () => {
    const stub = counterStub('counter-test:first-hit');
    const before = Date.now();

    const decision = await stub.hit(rule(3, 30));
    const records = await readStoredRecords(stub);

    expect(decision).toMatchObject({ allowed: true, count: 1, remaining: 2 });
    expect(decision.resetAt).toBeGreaterThanOrEqual(
      before + 30 * MILLISECONDS_PER_SECOND,
    );
    expect(records.alarm).toBe(decision.resetAt);
    expect(records.entries).toStrictEqual([
      [
        WINDOW_STATE_KEY,
        {
          count: 1,
          windowStartedAt: decision.resetAt - 30 * MILLISECONDS_PER_SECOND,
          windowSeconds: 30,
        },
      ],
    ]);
  });

  test('同じキーへの並行した要求を取りこぼしや重複なく数え、上限を超えた分を拒否する', async () => {
    const stub = counterStub('counter-test:concurrent');
    const limit = 7;
    const requests = 12;

    const decisions = await Promise.all(
      Array.from({ length: requests }, () => stub.hit(rule(limit))),
    );
    const allowed = decisions.filter((decision) => decision.allowed);
    const rejected = decisions.filter((decision) => !decision.allowed);
    const records = await readStoredRecords(stub);

    expect(
      allowed.map((decision) => decision.count).toSorted((a, b) => a - b),
    ).toStrictEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rejected).toHaveLength(requests - limit);
    expect(
      rejected.every(
        (decision) => decision.count === limit && decision.remaining === 0,
      ),
    ).toBe(true);
    expect(new Set(decisions.map((decision) => decision.resetAt)).size).toBe(1);
    expect(records.entries).toStrictEqual([
      [WINDOW_STATE_KEY, expect.objectContaining({ count: limit })],
    ]);
  });

  test('拒否しても期間の開始・リセット予定時刻・Alarmを変えない', async () => {
    const stub = counterStub('counter-test:rejected');
    const first = await stub.hit(rule(1));
    const before = await readStoredRecords(stub);

    const rejected: CounterDecision = await stub.hit(rule(1));
    const after = await readStoredRecords(stub);

    expect(rejected).toStrictEqual({
      allowed: false,
      count: 1,
      remaining: 0,
      resetAt: first.resetAt,
    });
    expect(after).toStrictEqual(before);
  });

  test('期間の終わったAlarmの実行後に回数と期間の記録とAlarmが残らず、次の要求で新しい期間が始まる', async () => {
    const stub = counterStub('counter-test:alarm');
    await stub.hit(rule(2, 10));
    await stub.hit(rule(2, 10));
    const ended: WindowState = {
      count: 2,
      windowStartedAt: Date.now() - 10 * MILLISECONDS_PER_SECOND,
      windowSeconds: 10,
    };
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.kv.put(WINDOW_STATE_KEY, ended);
    });

    const ran = await runDurableObjectAlarm(stub);
    const records = await readStoredRecords(stub);
    const next = await stub.hit(rule(2, 10));

    expect(ran).toBe(true);
    expect(records).toStrictEqual({ entries: [], alarm: null });
    expect(next).toMatchObject({ allowed: true, count: 1, remaining: 1 });
  });

  test('期間の途中でAlarmが重複して実行されても記録とAlarmを残し、続きから数える', async () => {
    const stub = counterStub('counter-test:duplicate-alarm');
    await stub.hit(rule(3));
    await stub.hit(rule(3));
    const before = await readStoredRecords(stub);

    await runInDurableObject(stub, async (instance) => {
      await instance.alarm();
    });
    const after = await readStoredRecords(stub);
    const next = await stub.hit(rule(3));

    expect(after).toStrictEqual(before);
    expect(next).toMatchObject({ allowed: true, count: 3, remaining: 0 });
  });

  test('期間の途中でAlarmだけが消えていれば、Alarmの実行で期間の終わりに予約し直す', async () => {
    const stub = counterStub('counter-test:lost-alarm');
    const first = await stub.hit(rule(3));
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.deleteAlarm();
    });

    await runInDurableObject(stub, async (instance) => {
      await instance.alarm();
    });
    const records = await readStoredRecords(stub);

    expect(records.alarm).toBe(first.resetAt);
    expect(records.entries).toStrictEqual([
      [WINDOW_STATE_KEY, expect.objectContaining({ count: 1 })],
    ]);
  });

  test('期間の途中のリセットで回数と期間の記録とAlarmが残らず、次の要求で0から数え直す', async () => {
    const stub = counterStub('counter-test:reset');
    await stub.hit(rule(3));
    await stub.hit(rule(3));
    await stub.hit(rule(3));

    await stub.reset();
    const records = await readStoredRecords(stub);
    const next = await stub.hit(rule(3));

    expect(records).toStrictEqual({ entries: [], alarm: null });
    expect(next).toMatchObject({ allowed: true, count: 1, remaining: 2 });
  });

  test('Alarmが実行される前でも、期限の切れた期間は次の要求で新しい期間になる', async () => {
    const stub = counterStub('counter-test:expired');
    await stub.hit(rule(1, 10));
    const expired: WindowState = {
      count: 1,
      windowStartedAt: Date.now() - 11 * MILLISECONDS_PER_SECOND,
      windowSeconds: 10,
    };
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.kv.put(WINDOW_STATE_KEY, expired);
    });

    const decision = await stub.hit(rule(1, 10));
    const records = await readStoredRecords(stub);

    expect(decision).toMatchObject({ allowed: true, count: 1, remaining: 0 });
    expect(records.alarm).toBe(decision.resetAt);
  });
});
