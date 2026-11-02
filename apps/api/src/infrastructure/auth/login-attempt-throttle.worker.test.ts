import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import {
  LOGIN_FAILURE_RETENTION_MS,
  type LoginThrottleState,
} from '../../domain/auth/login-throttle-state.ts';
import type { LoginAttemptThrottle } from './login-attempt-throttle.ts';

const STATE_KEY = 'state';

const FREE_ATTEMPTS = 5;

function throttleStub(): DurableObjectStub<LoginAttemptThrottle> {
  const namespace = env.LOGIN_ATTEMPT_THROTTLE;
  return namespace.get(
    namespace.idFromName(`login-throttle-test:${crypto.randomUUID()}`),
  );
}

interface StoredRecords {
  readonly entries: readonly (readonly [string, unknown])[];
  readonly alarm: number | null;
}

async function readStoredRecords(
  stub: DurableObjectStub<LoginAttemptThrottle>,
): Promise<StoredRecords> {
  return runInDurableObject(stub, async (_instance, state) => ({
    entries: [...state.storage.kv.list()],
    alarm: await state.storage.getAlarm(),
  }));
}

async function overwriteState(
  stub: DurableObjectStub<LoginAttemptThrottle>,
  next: LoginThrottleState,
): Promise<void> {
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.kv.put(STATE_KEY, next);
  });
}

async function recordFailures(
  stub: DurableObjectStub<LoginAttemptThrottle>,
  count: number,
  now: number,
): Promise<void> {
  for (let attempt = 0; attempt < count; attempt += 1) {
    await stub.recordFailure(now);
  }
}

describe('LoginAttemptThrottle', () => {
  test('記録の無い単位はロックされておらず、何も保存しない', async () => {
    const stub = throttleStub();

    const status = await stub.status(Date.now());
    const records = await readStoredRecords(stub);

    expect(status).toStrictEqual({ locked: false });
    expect(records).toStrictEqual({ entries: [], alarm: null });
  });

  test('5回目までの失敗はロックせず、回数と時刻を保存して24時間後にアラームを予約する', async () => {
    const stub = throttleStub();
    const now = Date.now();

    const statuses = [];
    for (let attempt = 0; attempt < FREE_ATTEMPTS; attempt += 1) {
      statuses.push(await stub.recordFailure(now));
    }
    const records = await readStoredRecords(stub);

    expect(statuses).toStrictEqual(
      Array.from({ length: FREE_ATTEMPTS }, () => ({ locked: false })),
    );
    expect(records).toStrictEqual({
      entries: [
        [
          STATE_KEY,
          { failures: 5, lockedUntil: undefined, lastFailureAt: now },
        ],
      ],
      alarm: now + LOGIN_FAILURE_RETENTION_MS,
    });
  });

  test('6回目の失敗で1秒ロックし、ロックの終了時刻にアラームを予約する', async () => {
    const stub = throttleStub();
    const now = Date.now();
    await recordFailures(stub, FREE_ATTEMPTS, now);

    const status = await stub.recordFailure(now);
    const records = await readStoredRecords(stub);

    expect(status).toStrictEqual({ locked: true, retryAfterSeconds: 1 });
    expect(records).toStrictEqual({
      entries: [
        [
          STATE_KEY,
          { failures: 6, lockedUntil: now + 1000, lastFailureAt: now },
        ],
      ],
      alarm: now + 1000,
    });
  });

  test('ロック中は状態の確認がロックと残り秒数を返し、失敗を数えず記録とアラームを変えない', async () => {
    const stub = throttleStub();
    const now = Date.now();
    await overwriteState(stub, {
      failures: 9,
      lockedUntil: now + 16_000,
      lastFailureAt: now,
    });
    await runInDurableObject(stub, async (_instance, state) => {
      await state.storage.setAlarm(now + 16_000);
    });
    const before = await readStoredRecords(stub);

    const status = await stub.status(now + 1500);
    const rejected = await stub.recordFailure(now + 1500);
    const after = await readStoredRecords(stub);

    expect(status).toStrictEqual({ locked: true, retryAfterSeconds: 15 });
    expect(rejected).toStrictEqual({ locked: true, retryAfterSeconds: 15 });
    expect(after).toStrictEqual(before);
  });

  test('同じ単位への並行した失敗を1つずつ処理し、ロックの後に届いた失敗を数えない', async () => {
    const stub = throttleStub();
    const now = Date.now();

    const statuses = await Promise.all(
      Array.from({ length: 10 }, () => stub.recordFailure(now)),
    );
    const records = await readStoredRecords(stub);

    expect(statuses.filter(({ locked }) => !locked)).toHaveLength(
      FREE_ATTEMPTS,
    );
    expect(statuses.filter(({ locked }) => locked)).toHaveLength(5);
    expect(records.entries).toStrictEqual([
      [STATE_KEY, { failures: 6, lockedUntil: now + 1000, lastFailureAt: now }],
    ]);
  });

  test('ロックの終了時刻のアラームでロックだけを解き、回数を残して24時間後にアラームを予約し直す', async () => {
    const stub = throttleStub();
    const now = Date.now();
    await recordFailures(stub, 6, now);
    const lastFailureAt = now - 2000;
    await overwriteState(stub, {
      failures: 6,
      lockedUntil: now - 1000,
      lastFailureAt,
    });

    const ran = await runDurableObjectAlarm(stub);
    const records = await readStoredRecords(stub);
    const status = await stub.status(Date.now());

    expect(ran).toBe(true);
    expect(records).toStrictEqual({
      entries: [
        [STATE_KEY, { failures: 6, lockedUntil: undefined, lastFailureAt }],
      ],
      alarm: lastFailureAt + LOGIN_FAILURE_RETENTION_MS,
    });
    expect(status).toStrictEqual({ locked: false });
  });

  test('ロックの解除の後の失敗は回数を引き継ぎ、前の2倍の長さでロックする', async () => {
    const stub = throttleStub();
    const now = Date.now();
    await recordFailures(stub, 6, now);
    await overwriteState(stub, {
      failures: 6,
      lockedUntil: now - 1000,
      lastFailureAt: now - 2000,
    });
    await runDurableObjectAlarm(stub);

    const status = await stub.recordFailure(now);

    expect(status).toStrictEqual({ locked: true, retryAfterSeconds: 2 });
  });

  test('最後の失敗から24時間が過ぎたアラームで記録とアラームを消す', async () => {
    const stub = throttleStub();
    const now = Date.now();
    await recordFailures(stub, 3, now);
    await overwriteState(stub, {
      failures: 3,
      lockedUntil: undefined,
      lastFailureAt: now - LOGIN_FAILURE_RETENTION_MS,
    });

    const ran = await runDurableObjectAlarm(stub);
    const records = await readStoredRecords(stub);
    const next = await stub.recordFailure(Date.now());

    expect(ran).toBe(true);
    expect(records).toStrictEqual({ entries: [], alarm: null });
    expect(next).toStrictEqual({ locked: false });
    expect((await readStoredRecords(stub)).entries).toStrictEqual([
      [STATE_KEY, expect.objectContaining({ failures: 1 })],
    ]);
  });

  test('ロックの途中でアラームが実行されても、記録を残してロックの終了時刻に予約し直す', async () => {
    const stub = throttleStub();
    const now = Date.now();
    await overwriteState(stub, {
      failures: 9,
      lockedUntil: now + 16_000,
      lastFailureAt: now,
    });
    const before = await readStoredRecords(stub);

    await runInDurableObject(stub, async (instance) => {
      await instance.alarm();
    });
    const after = await readStoredRecords(stub);

    expect(before.alarm).toBeNull();
    expect(after).toStrictEqual({ ...before, alarm: now + 16_000 });
  });

  test('記録の無いオブジェクトでアラームが実行されても何も保存しない', async () => {
    const stub = throttleStub();

    await runInDurableObject(stub, async (instance) => {
      await instance.alarm();
    });
    const records = await readStoredRecords(stub);

    expect(records).toStrictEqual({ entries: [], alarm: null });
  });

  test('成功による削除でロック中でも記録とアラームを消し、次の失敗を1回目から数える', async () => {
    const stub = throttleStub();
    const now = Date.now();
    await recordFailures(stub, 8, now);

    await stub.reset();
    const records = await readStoredRecords(stub);
    const status = await stub.status(now);
    const next = await stub.recordFailure(now);

    expect(records).toStrictEqual({ entries: [], alarm: null });
    expect(status).toStrictEqual({ locked: false });
    expect(next).toStrictEqual({ locked: false });
  });
});
