import { describe, expect, test } from 'bun:test';

import { assertRetryPolicy } from '../retry-policy.ts';
import {
  EXPAND_NOTIFICATION_EVENT_MESSAGE,
  FLUSH_NOTIFICATION_SLOT_MESSAGE,
  NOTIFICATION_CONTINUE_DELAY_SECONDS,
  NOTIFICATION_RETRY_POLICY,
} from './notifications.ts';

const EVENT_ID = '01M7BNN5000000000000000001';

describe('FLUSH_NOTIFICATION_SLOT_MESSAGE', () => {
  test('種別notifications.flush-slotの凍結済みの契約である', () => {
    expect(FLUSH_NOTIFICATION_SLOT_MESSAGE.type).toBe(
      'notifications.flush-slot',
    );
    expect(Object.isFrozen(FLUSH_NOTIFICATION_SLOT_MESSAGE)).toBe(true);
  });

  test.each([
    ['夜の枠', 'evening:2026-10-24'],
    ['朝の枠', 'morning:2026-10-25'],
    ['受賞の枠', `award:${EVENT_ID}`],
  ])('%sのキーだけの本文を受け付ける', (_label, slotKey) => {
    expect(
      FLUSH_NOTIFICATION_SLOT_MESSAGE.schema.safeParse({ slotKey }),
    ).toEqual({ success: true, data: { slotKey } });
  });

  test('本文に宛先や名称を持ち込めない', () => {
    expect(
      FLUSH_NOTIFICATION_SLOT_MESSAGE.schema.parse({
        slotKey: 'evening:2026-10-24',
        recipientEmail: 'maker@launch.example',
        productName: 'Sample Product',
      }),
    ).toEqual({ slotKey: 'evening:2026-10-24' });
  });

  test.each([
    ['キーの欠落', {}],
    ['空のキー', { slotKey: '' }],
    ['未知の枠の種類', { slotKey: 'noon:2026-10-24' }],
    ['存在しない日付', { slotKey: 'evening:2026-02-30' }],
    ['ULIDでない受賞の枠', { slotKey: 'award:event-1' }],
    ['数値のキー', { slotKey: 1 }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(FLUSH_NOTIFICATION_SLOT_MESSAGE.schema.safeParse(body).success).toBe(
      false,
    );
  });
});

describe('EXPAND_NOTIFICATION_EVENT_MESSAGE', () => {
  test('種別notifications.expand-eventの凍結済みの契約である', () => {
    expect(EXPAND_NOTIFICATION_EVENT_MESSAGE.type).toBe(
      'notifications.expand-event',
    );
    expect(Object.isFrozen(EXPAND_NOTIFICATION_EVENT_MESSAGE)).toBe(true);
  });

  test('通知イベントのIDだけの本文を受け付け、他の項目を除く', () => {
    expect(
      EXPAND_NOTIFICATION_EVENT_MESSAGE.schema.parse({
        eventId: EVENT_ID,
        productId: EVENT_ID,
      }),
    ).toEqual({ eventId: EVENT_ID });
  });

  test.each([
    ['IDの欠落', {}],
    ['ULIDでないID', { eventId: 'event-1' }],
    ['小文字のULID', { eventId: EVENT_ID.toLowerCase() }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(
      EXPAND_NOTIFICATION_EVENT_MESSAGE.schema.safeParse(body).success,
    ).toBe(false);
  });
});

describe('NOTIFICATION_RETRY_POLICY', () => {
  test('試行は5回まで、間隔は60秒から倍にして1800秒までで、Queueの再配信の上限に収まる', () => {
    expect(NOTIFICATION_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      baseDelaySeconds: 60,
      maxDelaySeconds: 1800,
    });
    expect(Object.isFrozen(NOTIFICATION_RETRY_POLICY)).toBe(true);
    expect(() => {
      assertRetryPolicy(NOTIFICATION_RETRY_POLICY);
    }).not.toThrow();
  });

  test('1回で終わらない段は1秒後に続きを処理する', () => {
    expect(NOTIFICATION_CONTINUE_DELAY_SECONDS).toBe(1);
  });
});
