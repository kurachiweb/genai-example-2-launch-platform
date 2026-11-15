import { describe, expect, test } from 'bun:test';

import {
  cookieMaxAgeSeconds,
  evaluateSession,
  newSessionTimes,
  type SessionPolicy,
  type SessionTimes,
  USER_SESSION_POLICY,
} from './session-policy.ts';

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const ISSUED_AT = new Date('2026-11-02T00:00:00.000Z');

const at = (offsetMs: number): Date => new Date(ISSUED_AT.getTime() + offsetMs);

const userTimes = (lastUsedOffsetMs: number): SessionTimes => ({
  createdAt: ISSUED_AT,
  lastUsedAt: at(lastUsedOffsetMs),
  absoluteExpiresAt: at(90 * DAY_MS),
});

const ADMIN_LIKE_POLICY: SessionPolicy = {
  idleSeconds: 2 * 60 * 60,
  absoluteSeconds: 12 * 60 * 60,
  touchIntervalSeconds: 60,
};

describe('USER_SESSION_POLICY', () => {
  test('アイドル14日・絶対90日・更新の間隔15分を秒で持つ', () => {
    expect(USER_SESSION_POLICY).toEqual({
      idleSeconds: 1_209_600,
      absoluteSeconds: 7_776_000,
      touchIntervalSeconds: 900,
    });
  });

  test('実行時に書き換えられない', () => {
    expect(Object.isFrozen(USER_SESSION_POLICY)).toBe(true);
  });
});

describe('newSessionTimes', () => {
  test('発行日時と最終利用日時を現在にし、絶対期限を発行から90日後にする', () => {
    expect(newSessionTimes(ISSUED_AT, USER_SESSION_POLICY)).toEqual({
      createdAt: ISSUED_AT,
      lastUsedAt: ISSUED_AT,
      absoluteExpiresAt: at(90 * DAY_MS),
    });
  });

  test('引数の日時を共有せず別のDateを返す', () => {
    const now = new Date(ISSUED_AT);
    const times = newSessionTimes(now, USER_SESSION_POLICY);
    now.setTime(0);
    expect(times.createdAt).toEqual(ISSUED_AT);
    expect(times.lastUsedAt).toEqual(ISSUED_AT);
  });
});

describe('evaluateSession', () => {
  test('最後の利用から14日の直前は有効で、14日ちょうどで期限切れになる', () => {
    const times = userTimes(10 * DAY_MS);
    expect(
      evaluateSession(times, at(24 * DAY_MS - 1), USER_SESSION_POLICY).status,
    ).toBe('active');
    expect(
      evaluateSession(times, at(24 * DAY_MS), USER_SESSION_POLICY),
    ).toEqual({ status: 'expired' });
  });

  test('利用が続いていても発行から90日の直前は有効で、90日ちょうどで期限切れになる', () => {
    const times = userTimes(90 * DAY_MS - HOUR_MS);
    expect(
      evaluateSession(times, at(90 * DAY_MS - 1), USER_SESSION_POLICY).status,
    ).toBe('active');
    expect(
      evaluateSession(times, at(90 * DAY_MS), USER_SESSION_POLICY),
    ).toEqual({ status: 'expired' });
  });

  test('最後の利用から15分未満は最終利用日時の更新を省く', () => {
    const times = userTimes(DAY_MS);
    expect(
      evaluateSession(
        times,
        at(DAY_MS + 15 * MINUTE_MS - 1),
        USER_SESSION_POLICY,
      ),
    ).toEqual({
      status: 'active',
      touch: false,
      maxAgeSeconds: 1_209_600 - 900,
    });
  });

  test('最後の利用から15分以上なら更新し、Cookieの有効期間を更新後のアイドル期限に合わせる', () => {
    const times = userTimes(DAY_MS);
    expect(
      evaluateSession(times, at(DAY_MS + 15 * MINUTE_MS), USER_SESSION_POLICY),
    ).toEqual({ status: 'active', touch: true, maxAgeSeconds: 1_209_600 });
  });

  test('更新しても絶対期限の方が早ければCookieの有効期間を絶対期限に合わせる', () => {
    const times = userTimes(85 * DAY_MS);
    expect(
      evaluateSession(times, at(87 * DAY_MS), USER_SESSION_POLICY),
    ).toEqual({ status: 'active', touch: true, maxAgeSeconds: 3 * 86_400 });
  });

  test('最終利用日時が現在より後でも更新せずに有効とする', () => {
    const times = userTimes(DAY_MS);
    expect(
      evaluateSession(times, at(DAY_MS - SECOND_MS), USER_SESSION_POLICY),
    ).toMatchObject({ status: 'active', touch: false });
  });
});

describe('cookieMaxAgeSeconds', () => {
  test('アイドル期限の残りが短ければその秒数を返す', () => {
    expect(
      cookieMaxAgeSeconds(
        userTimes(DAY_MS),
        at(2 * DAY_MS),
        USER_SESSION_POLICY,
      ),
    ).toBe(13 * 86_400);
  });

  test('絶対期限の残りが短ければその秒数を返す', () => {
    expect(
      cookieMaxAgeSeconds(
        userTimes(89 * DAY_MS),
        at(89 * DAY_MS),
        USER_SESSION_POLICY,
      ),
    ).toBe(86_400);
  });

  test('1秒に満たない端数はセッションより長く残らないよう切り捨てる', () => {
    expect(
      cookieMaxAgeSeconds(
        userTimes(0),
        at(10 * DAY_MS + 1500),
        USER_SESSION_POLICY,
      ),
    ).toBe(4 * 86_400 - 2);
  });

  test('残りが1秒未満でも1を返す', () => {
    expect(
      cookieMaxAgeSeconds(
        userTimes(0),
        at(14 * DAY_MS - 1),
        USER_SESSION_POLICY,
      ),
    ).toBe(1);
  });
});

describe('利用者と別の値の方針', () => {
  test('同じ関数で、管理者の方針の値に従って発行・期限切れ・更新・Cookieの有効期間を判定する', () => {
    const times = newSessionTimes(ISSUED_AT, ADMIN_LIKE_POLICY);
    expect(times.absoluteExpiresAt).toEqual(at(12 * HOUR_MS));

    expect(evaluateSession(times, at(2 * HOUR_MS), ADMIN_LIKE_POLICY)).toEqual({
      status: 'expired',
    });
    expect(
      evaluateSession(times, at(2 * HOUR_MS), USER_SESSION_POLICY).status,
    ).toBe('active');

    expect(evaluateSession(times, at(MINUTE_MS), ADMIN_LIKE_POLICY)).toEqual({
      status: 'active',
      touch: true,
      maxAgeSeconds: 2 * 60 * 60,
    });
    expect(
      evaluateSession(times, at(MINUTE_MS), USER_SESSION_POLICY),
    ).toMatchObject({ status: 'active', touch: false });

    const nearAbsolute: SessionTimes = {
      ...times,
      lastUsedAt: at(11 * HOUR_MS),
    };
    expect(
      cookieMaxAgeSeconds(nearAbsolute, at(11 * HOUR_MS), ADMIN_LIKE_POLICY),
    ).toBe(60 * 60);
  });
});
