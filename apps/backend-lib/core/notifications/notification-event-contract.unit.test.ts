import { describe, expect, test } from 'bun:test';

import {
  AWARD_KINDS,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_PUBLISH_EVENT_LIMIT,
  type NotificationEvent,
  notificationEventDedupeKey,
  notificationEventSchema,
  NotificationPublishError,
  type NotificationPublishRequest,
  parseNotificationPublishRequest,
} from './notification-event-contract.ts';

const MATCH_ID = '01M7BNN5000000000000000001';
const PRODUCT_ID = '01M7BNN5000000000000000002';
const AT = new Date('2026-10-25T07:45:00.000Z');

const preview: NotificationEvent = { type: 'match_preview', matchId: MATCH_ID };
const result: NotificationEvent = { type: 'match_result', matchId: MATCH_ID };
const weekAward: NotificationEvent = {
  type: 'award',
  award: 'product_of_the_week',
  period: '2026-W37',
  productId: PRODUCT_ID,
};
const yearAward: NotificationEvent = {
  type: 'award',
  award: 'product_of_the_year',
  period: '2026',
  productId: PRODUCT_ID,
};

const request = (
  overrides: Partial<NotificationPublishRequest> = {},
): NotificationPublishRequest => ({
  publisher: 'tournament-week',
  events: [preview],
  at: AT,
  ...overrides,
});

const captureError = (run: () => unknown): NotificationPublishError => {
  try {
    run();
  } catch (error) {
    if (error instanceof NotificationPublishError) {
      return error;
    }
    throw error;
  }
  throw new Error('NotificationPublishErrorが投げられませんでした');
};

describe('通知イベントの種類と賞の種類', () => {
  test('通知イベントは開始予告・結果・受賞の3種類で、凍結されている', () => {
    expect([...NOTIFICATION_EVENT_TYPES]).toEqual([
      'match_preview',
      'match_result',
      'award',
    ]);
    expect(Object.isFrozen(NOTIFICATION_EVENT_TYPES)).toBe(true);
  });

  test('賞はProduct of the WeekとProduct of the Yearの2種類で、凍結されている', () => {
    expect([...AWARD_KINDS]).toEqual([
      'product_of_the_week',
      'product_of_the_year',
    ]);
    expect(Object.isFrozen(AWARD_KINDS)).toBe(true);
  });

  test('1回の発行の件数の上限は50件である', () => {
    expect(NOTIFICATION_PUBLISH_EVENT_LIMIT).toBe(50);
  });
});

describe('notificationEventSchema', () => {
  test.each([
    ['マッチの開始予告', preview],
    ['マッチの結果', result],
    ['Weekの受賞', weekAward],
    ['Yearの受賞', yearAward],
    [
      '53週の年の第53週の受賞',
      { ...weekAward, period: '2026-W53' } satisfies NotificationEvent,
    ],
  ])('%sの通知イベントを受け付ける', (_label, event) => {
    expect(notificationEventSchema.safeParse(event)).toEqual({
      success: true,
      data: event,
    });
  });

  test('名称や利用者の情報を持ち込めず、識別子と賞の期間だけが残る', () => {
    expect(
      notificationEventSchema.parse({
        ...weekAward,
        productName: 'Sample Product',
        ownerEmail: 'owner@launch.example',
      }),
    ).toEqual(weekAward);
  });

  test.each([
    ['種類の欠落', { matchId: MATCH_ID }],
    ['未知の種類', { type: 'match_started', matchId: MATCH_ID }],
    ['マッチのIDの欠落', { type: 'match_result' }],
    ['ULIDでないマッチのID', { type: 'match_preview', matchId: 'match-1' }],
    [
      '小文字のULIDのマッチのID',
      { type: 'match_preview', matchId: MATCH_ID.toLowerCase() },
    ],
    [
      '時刻の範囲を超えるULIDのマッチのID',
      { type: 'match_result', matchId: '8ZZZZZZZZZZZZZZZZZZZZZZZZZ' },
    ],
    ['ULIDでないプロダクトのID', { ...weekAward, productId: 'product-1' }],
    ['未知の賞', { ...weekAward, award: 'product_of_the_month' }],
    ['Weekの賞に年の期間', { ...weekAward, period: '2026' }],
    ['Yearの賞にISO週の期間', { ...yearAward, period: '2026-W37' }],
    ['第0週', { ...weekAward, period: '2026-W00' }],
    ['第54週', { ...weekAward, period: '2026-W54' }],
    ['52週の年の第53週', { ...weekAward, period: '2025-W53' }],
    ['1桁の週', { ...weekAward, period: '2026-W5' }],
    ['小文字のw', { ...weekAward, period: '2026-w37' }],
    ['0年', { ...yearAward, period: '0000' }],
    ['5桁の年', { ...yearAward, period: '20260' }],
  ])('%sの通知イベントを拒否する', (_label, event) => {
    expect(notificationEventSchema.safeParse(event).success).toBe(false);
  });
});

describe('notificationEventDedupeKey', () => {
  test('マッチの通知イベントは種類とマッチのIDで重複を判定する', () => {
    expect(notificationEventDedupeKey(preview)).toBe(
      `match_preview:${MATCH_ID}`,
    );
    expect(notificationEventDedupeKey(result)).toBe(`match_result:${MATCH_ID}`);
  });

  test('受賞は賞・期間・プロダクトのIDで重複を判定する', () => {
    expect(notificationEventDedupeKey(weekAward)).toBe(
      `award:product_of_the_week:2026-W37:${PRODUCT_ID}`,
    );
    expect(notificationEventDedupeKey(yearAward)).toBe(
      `award:product_of_the_year:2026:${PRODUCT_ID}`,
    );
  });

  test('同じマッチでも開始予告と結果は別の通知イベントになる', () => {
    expect(notificationEventDedupeKey(preview)).not.toBe(
      notificationEventDedupeKey(result),
    );
  });
});

describe('parseNotificationPublishRequest', () => {
  test('上限の50件までの通知イベントを検証して、余分な項目を除いた要求を返す', () => {
    const events = Array.from({ length: 50 }, () => preview);
    const parsed = parseNotificationPublishRequest(
      request({
        events: [
          { ...result, productName: 'Sample Product' } as NotificationEvent,
          ...events.slice(1),
        ],
      }),
    );

    expect(parsed.publisher).toBe('tournament-week');
    expect(parsed.at).toEqual(AT);
    expect(parsed.events).toHaveLength(50);
    expect(parsed.events[0]).toEqual(result);
  });

  test.each([
    ['0件', []],
    ['51件', Array.from({ length: 51 }, () => preview)],
  ])('通知イベントが%sの要求を件数の違反として拒否する', (_label, events) => {
    const error = captureError(() =>
      parseNotificationPublishRequest(request({ events })),
    );

    expect(error.reason).toBe('invalid-request');
    expect(error.eventIndex).toBeNull();
  });

  test.each([
    ['空の名前', ''],
    ['大文字を含む名前', 'Tournament-week'],
    ['下線を含む名前', 'tournament_week'],
    ['ピリオドを含む名前', 'tournament-week.pairing'],
    ['先頭がハイフンの名前', '-tournament'],
    ['末尾がハイフンの名前', 'tournament-'],
  ])('発行元が%sの要求を拒否する', (_label, publisher) => {
    const error = captureError(() =>
      parseNotificationPublishRequest(request({ publisher })),
    );

    expect(error.reason).toBe('invalid-request');
    expect(error.eventIndex).toBeNull();
  });

  test('発行の時点が不正な日時の要求を拒否する', () => {
    const error = captureError(() =>
      parseNotificationPublishRequest(request({ at: new Date(Number.NaN) })),
    );

    expect(error.reason).toBe('invalid-request');
  });

  test('契約に合わない通知イベントは最初に違反した要素の位置とともに拒否する', () => {
    const error = captureError(() =>
      parseNotificationPublishRequest(
        request({
          events: [
            preview,
            { ...yearAward, period: '2026-W37' },
            { type: 'match_result', matchId: 'match-1' },
          ],
        }),
      ),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('NotificationPublishError');
    expect(error.reason).toBe('invalid-event');
    expect(error.eventIndex).toBe(1);
  });
});

describe('NotificationPublishError', () => {
  test('理由と違反した要素の位置を持ち、位置を省くとnullになる', () => {
    const withIndex = new NotificationPublishError('match-not-decided', 3);
    const withoutIndex = new NotificationPublishError('match-not-found');

    expect(withIndex.reason).toBe('match-not-decided');
    expect(withIndex.eventIndex).toBe(3);
    expect(withoutIndex.eventIndex).toBeNull();
    expect(withIndex.message).toContain('match-not-decided');
  });
});
