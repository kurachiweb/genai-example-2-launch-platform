import { describe, expect, test } from 'bun:test';

import { RUN_MATCH_EVENT_MESSAGE } from './match.ts';

const ULID = '01JBQ6Z8Y3V4W5X6Y7Z8A9B0C1';

describe('RUN_MATCH_EVENT_MESSAGE', () => {
  test('種別match.run-match-eventの凍結済みの契約である', () => {
    expect(RUN_MATCH_EVENT_MESSAGE.type).toBe('match.run-match-event');
    expect(Object.isFrozen(RUN_MATCH_EVENT_MESSAGE)).toBe(true);
  });

  test('イベントのIDだけの本文を受け付ける', () => {
    expect(RUN_MATCH_EVENT_MESSAGE.schema.safeParse({ eventId: ULID })).toEqual(
      { success: true, data: { eventId: ULID } },
    );
  });

  test('本文にプロダクトの名称や利用者の情報を持ち込めず、検証の結果をもう一度検証しても同じ値になる', () => {
    const first = RUN_MATCH_EVENT_MESSAGE.schema.parse({
      eventId: ULID,
      matchId: ULID,
      productName: 'Sample Product',
      userHandle: 'sample-user',
    });

    expect(first).toEqual({ eventId: ULID });
    expect(RUN_MATCH_EVENT_MESSAGE.schema.parse(first)).toEqual(first);
  });

  test.each([
    ['イベントのIDの欠落', {}],
    ['空のイベントのID', { eventId: '' }],
    ['ULIDでないイベントのID', { eventId: 'event-1' }],
    ['数値のイベントのID', { eventId: 1 }],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(RUN_MATCH_EVENT_MESSAGE.schema.safeParse(body).success).toBe(false);
  });
});
