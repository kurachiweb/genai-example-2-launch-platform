import { describe, expect, expectTypeOf, test } from 'bun:test';

import {
  cookieMaxAgeSeconds,
  evaluateSession,
  newSessionTimes,
  type SessionPolicy,
} from '../auth/session-policy.ts';
import { ADMIN_SESSION_POLICY } from './admin-session-policy.ts';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

const ISSUED_AT = new Date('2026-11-03T00:00:00.000Z');

const at = (offsetMs: number): Date => new Date(ISSUED_AT.getTime() + offsetMs);

const timesLastUsedAt = (lastUsedOffsetMs: number) => ({
  ...newSessionTimes(ISSUED_AT, ADMIN_SESSION_POLICY),
  lastUsedAt: at(lastUsedOffsetMs),
});

describe('ADMIN_SESSION_POLICY', () => {
  test('アイドル1時間・絶対12時間・更新の間引き5分を秒で持つ', () => {
    expect(ADMIN_SESSION_POLICY).toEqual({
      idleSeconds: 3600,
      absoluteSeconds: 43_200,
      touchIntervalSeconds: 300,
    });
    expectTypeOf(ADMIN_SESSION_POLICY).toEqualTypeOf<SessionPolicy>();
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(ADMIN_SESSION_POLICY)).toBe(true);
  });
});

describe('ADMIN_SESSION_POLICYでの認証の判定', () => {
  test('発行から12時間後を絶対期限にする', () => {
    expect(
      newSessionTimes(ISSUED_AT, ADMIN_SESSION_POLICY).absoluteExpiresAt,
    ).toEqual(at(12 * HOUR_MS));
  });

  test('最後の利用から1時間の直前は有効で、1時間ちょうどで期限切れになる', () => {
    const times = timesLastUsedAt(2 * HOUR_MS);

    expect(
      evaluateSession(times, at(3 * HOUR_MS - 1), ADMIN_SESSION_POLICY).status,
    ).toBe('active');
    expect(
      evaluateSession(times, at(3 * HOUR_MS), ADMIN_SESSION_POLICY),
    ).toEqual({ status: 'expired' });
  });

  test('利用が続いていても発行から12時間の直前は有効で、12時間ちょうどで期限切れになる', () => {
    const times = timesLastUsedAt(12 * HOUR_MS - 10 * MINUTE_MS);

    expect(
      evaluateSession(times, at(12 * HOUR_MS - 1), ADMIN_SESSION_POLICY).status,
    ).toBe('active');
    expect(
      evaluateSession(times, at(12 * HOUR_MS), ADMIN_SESSION_POLICY),
    ).toEqual({ status: 'expired' });
  });

  test('前回の更新から5分の直前は最終利用を更新せず、5分ちょうどで更新する', () => {
    const times = timesLastUsedAt(HOUR_MS);

    expect(
      evaluateSession(
        times,
        at(HOUR_MS + 5 * MINUTE_MS - 1),
        ADMIN_SESSION_POLICY,
      ),
    ).toMatchObject({ status: 'active', touch: false });
    expect(
      evaluateSession(times, at(HOUR_MS + 5 * MINUTE_MS), ADMIN_SESSION_POLICY),
    ).toMatchObject({ status: 'active', touch: true });
  });

  test('Cookieの有効期間をアイドル期限と絶対期限の早い方に合わせる', () => {
    expect(
      cookieMaxAgeSeconds(
        timesLastUsedAt(HOUR_MS),
        at(HOUR_MS),
        ADMIN_SESSION_POLICY,
      ),
    ).toBe(3600);
    expect(
      cookieMaxAgeSeconds(
        timesLastUsedAt(12 * HOUR_MS - 10 * MINUTE_MS),
        at(12 * HOUR_MS - 10 * MINUTE_MS),
        ADMIN_SESSION_POLICY,
      ),
    ).toBe(600);
  });
});
