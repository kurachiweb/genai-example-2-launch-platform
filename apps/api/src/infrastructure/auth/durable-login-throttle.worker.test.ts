import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import { createKeyedHasher } from '../../../lib/core/crypto/keyed-hasher.ts';
import {
  type HashedRateLimitKey,
  hashRateLimitKey,
} from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type {
  AuthIncident,
  AuthIncidentReporter,
  LoginThrottleKeys,
} from '../../application/auth/ports.ts';
import type { LoginThrottleState } from '../../domain/auth/login-throttle-state.ts';
import {
  createDurableLoginThrottle,
  loginThrottleObjectName,
} from './durable-login-throttle.ts';
import type { LoginAttemptThrottle } from './login-attempt-throttle.ts';

const STATE_KEY = 'state';

const LOCKING_FAILURES = 6;

class RecordingReporter implements AuthIncidentReporter {
  readonly incidents: AuthIncident[] = [];

  report(incident: AuthIncident): void {
    this.incidents.push(incident);
  }
}

async function randomKey(): Promise<HashedRateLimitKey> {
  return hashRateLimitKey(
    createKeyedHasher(env.HASH_PEPPER),
    'durable-login-throttle-test',
    crypto.randomUUID(),
  );
}

async function randomKeys(): Promise<{
  readonly email: HashedRateLimitKey;
  readonly ip: HashedRateLimitKey;
}> {
  return { email: await randomKey(), ip: await randomKey() };
}

function stubNamed(name: string): DurableObjectStub<LoginAttemptThrottle> {
  const namespace = env.LOGIN_ATTEMPT_THROTTLE;
  return namespace.get(namespace.idFromName(name));
}

async function storedState(
  name: string,
): Promise<LoginThrottleState | undefined> {
  return runInDurableObject(stubNamed(name), (_instance, state) =>
    state.storage.kv.get<LoginThrottleState>(STATE_KEY),
  );
}

async function lockFor(name: string, remainingMs: number): Promise<void> {
  const now = Date.now();
  await runInDurableObject(stubNamed(name), (_instance, state) => {
    state.storage.kv.put(STATE_KEY, {
      failures: LOCKING_FAILURES,
      lockedUntil: now + remainingMs,
      lastFailureAt: now,
    } satisfies LoginThrottleState);
  });
}

function createThrottle(reporter = new RecordingReporter()) {
  return createDurableLoginThrottle(env.LOGIN_ATTEMPT_THROTTLE, reporter);
}

async function recordFailures(
  count: number,
  scope: 'user' | 'admin',
  keys: LoginThrottleKeys,
  now: Date,
): Promise<void> {
  const throttle = createThrottle();
  for (let attempt = 0; attempt < count; attempt += 1) {
    await throttle.recordFailure(scope, keys, now);
  }
}

describe('loginThrottleObjectName', () => {
  test('メールアドレス単位は区分とハッシュ化済みのキーで、IPアドレス単位はキーだけで名前を作る', () => {
    const key = 'a1b2c3' as HashedRateLimitKey;

    expect(loginThrottleObjectName('email', 'user', key)).toBe(
      'login-email:user:a1b2c3',
    );
    expect(loginThrottleObjectName('email', 'admin', key)).toBe(
      'login-email:admin:a1b2c3',
    );
    expect(loginThrottleObjectName('ip', 'user', key)).toBe('login-ip:a1b2c3');
    expect(loginThrottleObjectName('ip', 'admin', key)).toBe('login-ip:a1b2c3');
  });
});

describe('createDurableLoginThrottle', () => {
  test('失敗をメールアドレス単位とIPアドレス単位の両方に記録する', async () => {
    const keys = await randomKeys();
    const now = new Date();

    await recordFailures(2, 'user', keys, now);

    expect(
      await storedState(loginThrottleObjectName('email', 'user', keys.email)),
    ).toStrictEqual({
      failures: 2,
      lockedUntil: undefined,
      lastFailureAt: now.getTime(),
    });
    expect(
      await storedState(loginThrottleObjectName('ip', 'user', keys.ip)),
    ).toStrictEqual({
      failures: 2,
      lockedUntil: undefined,
      lastFailureAt: now.getTime(),
    });
  });

  test('6回目の失敗で両方の単位がロックし、記録の結果と状態の確認がロックを返す', async () => {
    const keys = await randomKeys();
    const now = new Date();
    const throttle = createThrottle();
    await recordFailures(LOCKING_FAILURES - 1, 'user', keys, now);

    const recorded = await throttle.recordFailure('user', keys, now);
    const status = await throttle.status('user', keys, now);

    expect(recorded).toStrictEqual({ locked: true, retryAfterSeconds: 1 });
    expect(status).toStrictEqual({ locked: true, retryAfterSeconds: 1 });
  });

  test('どちらかの単位だけがロック中でもロック中を返す', async () => {
    const emailLocked = await randomKeys();
    const ipLocked = await randomKeys();
    await lockFor(
      loginThrottleObjectName('email', 'user', emailLocked.email),
      30_000,
    );
    await lockFor(loginThrottleObjectName('ip', 'user', ipLocked.ip), 30_000);
    const throttle = createThrottle();

    const statuses = await Promise.all([
      throttle.status('user', emailLocked, new Date()),
      throttle.status('user', ipLocked, new Date()),
    ]);

    expect(statuses).toStrictEqual([
      { locked: true, retryAfterSeconds: 30 },
      { locked: true, retryAfterSeconds: 30 },
    ]);
  });

  test('両方の単位がロック中なら残り時間の長い方を返す', async () => {
    const keys = await randomKeys();
    await lockFor(loginThrottleObjectName('email', 'user', keys.email), 8000);
    await lockFor(loginThrottleObjectName('ip', 'user', keys.ip), 64_000);
    const throttle = createThrottle();

    const status = await throttle.status('user', keys, new Date());

    expect(status).toStrictEqual({ locked: true, retryAfterSeconds: 64 });
  });

  test('どちらの単位もロックされていなければロックされていない', async () => {
    const keys = await randomKeys();
    const throttle = createThrottle();
    await recordFailures(3, 'user', keys, new Date());

    const status = await throttle.status('user', keys, new Date());

    expect(status).toStrictEqual({ locked: false });
  });

  test('メールアドレス単位は利用者と管理者で別の記録になる', async () => {
    const userKeys = await randomKeys();
    const adminKeys = { email: userKeys.email, ip: await randomKey() };
    const now = new Date();
    await recordFailures(LOCKING_FAILURES, 'user', userKeys, now);
    const throttle = createThrottle();

    const adminStatus = await throttle.status('admin', adminKeys, now);

    expect(adminStatus).toStrictEqual({ locked: false });
    expect(
      await storedState(
        loginThrottleObjectName('email', 'admin', userKeys.email),
      ),
    ).toBeUndefined();
  });

  test('IPアドレス単位は利用者と管理者で同じ記録を共有する', async () => {
    const userKeys = await randomKeys();
    const adminKeys = { email: await randomKey(), ip: userKeys.ip };
    const now = new Date();
    await recordFailures(LOCKING_FAILURES, 'user', userKeys, now);
    const throttle = createThrottle();

    const adminStatus = await throttle.status('admin', adminKeys, now);
    await throttle.reset('admin', adminKeys);

    expect(adminStatus).toStrictEqual({ locked: true, retryAfterSeconds: 1 });
    expect(
      await storedState(loginThrottleObjectName('ip', 'user', userKeys.ip)),
    ).toBeUndefined();
  });

  test('成功による削除で両方の単位の記録を消す', async () => {
    const keys = await randomKeys();
    const now = new Date();
    await recordFailures(LOCKING_FAILURES, 'user', keys, now);
    const throttle = createThrottle();

    await throttle.reset('user', keys);
    const status = await throttle.status('user', keys, now);

    expect(status).toStrictEqual({ locked: false });
    expect(
      await storedState(loginThrottleObjectName('email', 'user', keys.email)),
    ).toBeUndefined();
    expect(
      await storedState(loginThrottleObjectName('ip', 'user', keys.ip)),
    ).toBeUndefined();
  });

  test('IPアドレスが不明なら、メールアドレス単位だけで確かめて運用者へ通知する', async () => {
    const email = await randomKey();
    const keys: LoginThrottleKeys = { email, ip: undefined };
    const now = new Date();
    const reporter = new RecordingReporter();
    const throttle = createThrottle(reporter);

    const before = await throttle.status('user', keys, now);
    await recordFailures(LOCKING_FAILURES, 'user', keys, now);
    const locked = await throttle.status('user', keys, now);

    expect(before).toStrictEqual({ locked: false });
    expect(locked).toStrictEqual({ locked: true, retryAfterSeconds: 1 });
    expect(reporter.incidents).toStrictEqual([
      { kind: 'login-throttle-ip-missing' },
      { kind: 'login-throttle-ip-missing' },
    ]);
    expect(
      await storedState(loginThrottleObjectName('email', 'user', email)),
    ).toMatchObject({ failures: LOCKING_FAILURES });
  });

  test('IPアドレスが不明でも、記録と削除はメールアドレス単位だけで行い通知を重ねない', async () => {
    const email = await randomKey();
    const keys: LoginThrottleKeys = { email, ip: undefined };
    const reporter = new RecordingReporter();
    const throttle = createThrottle(reporter);

    const recorded = await throttle.recordFailure('user', keys, new Date());
    await throttle.reset('user', keys);

    expect(recorded).toStrictEqual({ locked: false });
    expect(reporter.incidents).toStrictEqual([]);
    expect(
      await storedState(loginThrottleObjectName('email', 'user', email)),
    ).toBeUndefined();
  });

  test('IPアドレスが分かれば運用者へ通知しない', async () => {
    const reporter = new RecordingReporter();
    const throttle = createThrottle(reporter);

    await throttle.status('user', await randomKeys(), new Date());

    expect(reporter.incidents).toStrictEqual([]);
  });
});
