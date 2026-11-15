import { describe, expect, test } from 'bun:test';

import {
  RECHECK_DISPOSABLE_EMAIL_MESSAGE,
  RUN_USER_LIFECYCLE_MESSAGE,
} from './identity.ts';

const ULID = '01JBQ6Z8Y3V4W5X6Y7Z8A9B0C1';

describe('RUN_USER_LIFECYCLE_MESSAGE', () => {
  test('種別identity.run-user-lifecycleの凍結済みの契約である', () => {
    expect(RUN_USER_LIFECYCLE_MESSAGE.type).toBe('identity.run-user-lifecycle');
    expect(Object.isFrozen(RUN_USER_LIFECYCLE_MESSAGE)).toBe(true);
  });

  test('イベントのIDだけの本文を受け付ける', () => {
    expect(
      RUN_USER_LIFECYCLE_MESSAGE.schema.safeParse({ eventId: ULID }),
    ).toEqual({ success: true, data: { eventId: ULID } });
  });

  test('本文に利用者のIDや個人情報を持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = RUN_USER_LIFECYCLE_MESSAGE.schema.parse({
      eventId: ULID,
      userId: ULID,
      email: 'someone@mail.example',
    });

    expect(first).toEqual({ eventId: ULID });
    expect(RUN_USER_LIFECYCLE_MESSAGE.schema.parse(first)).toEqual(first);
  });

  test.each([
    ['イベントのIDの欠落', {}],
    ['空のイベントのID', { eventId: '' }],
    ['ULIDでないイベントのID', { eventId: 'event-1' }],
    ['数値のイベントのID', { eventId: 1 }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(RUN_USER_LIFECYCLE_MESSAGE.schema.safeParse(body).success).toBe(
      false,
    );
  });
});

describe('RECHECK_DISPOSABLE_EMAIL_MESSAGE', () => {
  test('種別identity.recheck-disposable-emailの凍結済みの契約である', () => {
    expect(RECHECK_DISPOSABLE_EMAIL_MESSAGE.type).toBe(
      'identity.recheck-disposable-email',
    );
    expect(Object.isFrozen(RECHECK_DISPOSABLE_EMAIL_MESSAGE)).toBe(true);
  });

  test('利用者のIDだけの本文を受け付ける', () => {
    expect(
      RECHECK_DISPOSABLE_EMAIL_MESSAGE.schema.safeParse({ userId: ULID }),
    ).toEqual({ success: true, data: { userId: ULID } });
  });

  test('本文にメールアドレスを持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = RECHECK_DISPOSABLE_EMAIL_MESSAGE.schema.parse({
      userId: ULID,
      email: 'someone@mail.example',
    });

    expect(first).toEqual({ userId: ULID });
    expect(RECHECK_DISPOSABLE_EMAIL_MESSAGE.schema.parse(first)).toEqual(first);
  });

  test.each([
    ['利用者のIDの欠落', {}],
    ['空の利用者のID', { userId: '' }],
    ['ULIDでない利用者のID', { userId: 'user-1' }],
    ['数値の利用者のID', { userId: 1 }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(
      RECHECK_DISPOSABLE_EMAIL_MESSAGE.schema.safeParse(body).success,
    ).toBe(false);
  });
});
