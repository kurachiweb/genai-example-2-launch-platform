import { describe, expect, test } from 'bun:test';

import {
  businessDateOf,
  kickoffAtOf,
  selectionCutoffsFrom,
} from './business-time.ts';

describe('businessDateOf', () => {
  test('時点を業務時刻(UTC-08:00)の暦日にする', () => {
    expect(businessDateOf(new Date('2026-11-10T07:59:59.999Z'))).toBe(
      '2026-11-09',
    );
    expect(businessDateOf(new Date('2026-11-10T08:00:00.000Z'))).toBe(
      '2026-11-10',
    );
  });

  test('年の境も業務時刻の暦日で求める', () => {
    expect(businessDateOf(new Date('2027-01-01T07:00:00.000Z'))).toBe(
      '2026-12-31',
    );
  });
});

describe('kickoffAtOf', () => {
  test('ローンチ日の業務時刻の0:00をISO 8601の日時にする', () => {
    expect(kickoffAtOf('2026-11-20')).toBe('2026-11-20T08:00:00.000Z');
  });
});

describe('selectionCutoffsFrom', () => {
  test('業務日付の当日と翌日の23:40をISO 8601の日時で返す', () => {
    expect(selectionCutoffsFrom('2026-11-30')).toEqual([
      '2026-12-01T07:40:00.000Z',
      '2026-12-02T07:40:00.000Z',
    ]);
  });
});
