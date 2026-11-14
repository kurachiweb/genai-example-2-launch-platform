import { describe, expect, test } from 'bun:test';

import {
  parseBusinessDate,
  toBusinessDateTime,
} from '../time/business-time.ts';
import {
  awardSlot,
  EVENING_DISPATCH_DEADLINE_SECONDS,
  EVENING_SLOT_TIME,
  eveningSlot,
  MORNING_KICKOFF_WAIT_SECONDS,
  MORNING_SLOT_TIME,
  morningSlot,
  parseSlotKey,
  previewSlotFor,
  resultSlotFor,
} from './notification-slots.ts';

const DATE = parseBusinessDate('2026-10-24');
const EVENT_ID = '01M7BNN5000000000000000001';
const EXPANDED_AT = new Date('2026-10-25T03:12:34.567Z');

describe('送信枠の時刻と間隔', () => {
  test('夜の枠は23:45、朝の枠は0:00の業務時刻である', () => {
    expect(EVENING_SLOT_TIME).toEqual({ hour: 23, minute: 45 });
    expect(MORNING_SLOT_TIME).toEqual({ hour: 0, minute: 0 });
  });

  test('夜の枠の送り出しの期限は600秒、朝の枠が未開始のマッチを待つ間隔は300秒である', () => {
    expect(EVENING_DISPATCH_DEADLINE_SECONDS).toBe(600);
    expect(MORNING_KICKOFF_WAIT_SECONDS).toBe(300);
  });
});

describe('eveningSlot', () => {
  // 業務時刻はUTC−8のため、業務日付10-24の23:45はUTCの10-25 7:45になる
  test('期日は業務日付の23:45(UTCの翌日7:45)で、送り出しの期限は23:55である', () => {
    expect(eveningSlot(DATE)).toEqual({
      key: 'evening:2026-10-24',
      kind: 'evening',
      dueAt: new Date('2026-10-25T07:45:00.000Z'),
      settleUntil: new Date('2026-10-25T07:55:00.000Z'),
    });
  });

  test('23:44:59は期日より前で、23:45:00が期日になる', () => {
    const slot = eveningSlot(DATE);
    const justBefore = new Date('2026-10-25T07:44:59.999Z');

    expect(justBefore.getTime()).toBeLessThan(slot.dueAt.getTime());
    expect(toBusinessDateTime(slot.dueAt)).toMatchObject({
      date: DATE,
      hour: 23,
      minute: 45,
    });
  });

  test('23:54:59は送り出しの期限より前で、23:55:00が期限になる', () => {
    const slot = eveningSlot(DATE);
    const justBefore = new Date('2026-10-25T07:54:59.999Z');

    expect(justBefore.getTime()).toBeLessThan(slot.settleUntil.getTime());
    expect(slot.settleUntil.getTime() - slot.dueAt.getTime()).toBe(
      EVENING_DISPATCH_DEADLINE_SECONDS * 1000,
    );
    expect(toBusinessDateTime(slot.settleUntil)).toMatchObject({
      date: DATE,
      hour: 23,
      minute: 55,
    });
  });
});

describe('morningSlot', () => {
  test('期日は業務日付の0:00(UTCの8:00)で、送り出しの期限は期日と同じである', () => {
    expect(morningSlot(DATE)).toEqual({
      key: 'morning:2026-10-24',
      kind: 'morning',
      dueAt: new Date('2026-10-24T08:00:00.000Z'),
      settleUntil: new Date('2026-10-24T08:00:00.000Z'),
    });
  });

  test('予定時刻の業務日付で枠が決まり、23:59:59は前日の枠・0:00は当日の枠になる', () => {
    const lastSecond = toBusinessDateTime(
      new Date('2026-10-25T07:59:59.999Z'),
    ).date;
    const midnight = toBusinessDateTime(
      new Date('2026-10-25T08:00:00.000Z'),
    ).date;

    expect(morningSlot(lastSecond).key).toBe('morning:2026-10-24');
    expect(morningSlot(midnight).key).toBe('morning:2026-10-25');
    expect(morningSlot(midnight).dueAt).toEqual(
      new Date('2026-10-25T08:00:00.000Z'),
    );
  });
});

describe('awardSlot', () => {
  test('キーは通知イベントのIDから作り、期日と送り出しの期限は展開の完了の時点である', () => {
    expect(awardSlot(EVENT_ID, EXPANDED_AT)).toEqual({
      key: `award:${EVENT_ID}`,
      kind: 'award',
      dueAt: EXPANDED_AT,
      settleUntil: EXPANDED_AT,
    });
  });

  test('IDがULIDの形式でなければ例外を投げる', () => {
    expect(() => awardSlot('01m7bnn5000000000000000001', EXPANDED_AT)).toThrow(
      RangeError,
    );
    expect(() => awardSlot('award', EXPANDED_AT)).toThrow(RangeError);
  });

  test('不正な時点なら例外を投げる', () => {
    expect(() => awardSlot(EVENT_ID, new Date(Number.NaN))).toThrow(RangeError);
  });
});

describe('previewSlotFor・resultSlotFor', () => {
  test('開始予告はマッチの前日の夜の枠に入る', () => {
    expect(previewSlotFor(parseBusinessDate('2026-10-25'))).toEqual(
      eveningSlot(DATE),
    );
  });

  test('勝敗結果はマッチの当日の夜の枠に入る', () => {
    expect(resultSlotFor(DATE)).toEqual(eveningSlot(DATE));
  });

  test('当日の結果と翌日の予告は同じ夜の枠になる', () => {
    expect(previewSlotFor(parseBusinessDate('2026-10-25')).key).toBe(
      resultSlotFor(DATE).key,
    );
  });

  test('前日は月・年・閏日の境界をまたいで求まる', () => {
    expect(previewSlotFor(parseBusinessDate('2027-01-01')).key).toBe(
      'evening:2026-12-31',
    );
    expect(previewSlotFor(parseBusinessDate('2028-03-01')).key).toBe(
      'evening:2028-02-29',
    );
    expect(previewSlotFor(parseBusinessDate('2026-11-01')).key).toBe(
      'evening:2026-10-31',
    );
  });
});

describe('parseSlotKey', () => {
  test('夜と朝の枠のキーは種別と業務日付に戻り、同じ枠を作り直せる', () => {
    const evening = parseSlotKey('evening:2026-10-24');
    const morning = parseSlotKey('morning:2026-10-24');

    expect(evening).toEqual({
      key: 'evening:2026-10-24',
      kind: 'evening',
      date: DATE,
    });
    expect(morning).toEqual({
      key: 'morning:2026-10-24',
      kind: 'morning',
      date: DATE,
    });
    expect(
      evening?.kind === 'evening' ? eveningSlot(evening.date) : undefined,
    ).toEqual(eveningSlot(DATE));
  });

  test('受賞の枠のキーは種別と通知イベントのIDに戻る', () => {
    const key = awardSlot(EVENT_ID, EXPANDED_AT).key;

    expect(parseSlotKey(key)).toEqual({
      key,
      kind: 'award',
      eventId: EVENT_ID,
    });
  });

  test.each([
    [''],
    ['evening'],
    ['evening:'],
    ['evening:2026-1-24'],
    ['evening:2026-02-30'],
    ['evening:2026-10-24:extra'],
    [' evening:2026-10-24'],
    ['Evening:2026-10-24'],
    ['noon:2026-10-24'],
    ['award:'],
    ['award:01m7bnn5000000000000000001'],
    ['award:01M7BNN500000000000000000'],
    ['award:2026-10-24'],
  ])('形式違反のキー「%s」はundefinedになる', (key) => {
    expect(parseSlotKey(key)).toBeUndefined();
  });
});
