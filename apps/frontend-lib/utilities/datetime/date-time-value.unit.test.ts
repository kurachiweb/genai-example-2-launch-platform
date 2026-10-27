import { describe, expect, test } from 'bun:test';

import { toDateTimeValue } from './date-time-value.ts';

const KICKOFF_ISO = '2026-01-15T07:40:00.000Z';

describe('toDateTimeValue', () => {
  test('有効なDateはそのまま返す', () => {
    const value = new Date(KICKOFF_ISO);

    expect(toDateTimeValue(value)).toBe(value);
  });

  test('タイムゾーンを含むISO形式の文字列を同じ時点のDateにする', () => {
    const inputs = [
      KICKOFF_ISO,
      '2026-01-15T07:40:00Z',
      '2026-01-15T07:40Z',
      '2026-01-15T16:40:00+09:00',
      '2026-01-14T23:40:00.000-08:00',
    ];

    for (const input of inputs) {
      expect(toDateTimeValue(input).toISOString()).toBe(KICKOFF_ISO);
    }
  });

  test('解釈できない文字列や、実行環境のタイムゾーンで解釈が変わる文字列は例外を投げる', () => {
    const inputs = [
      '',
      'not a date',
      '2026-01-15',
      '2026-01-15T16:40:00',
      '2026/01/15 16:40 +09:00',
      'Thu, 15 Jan 2026 07:40:00 GMT',
      '2026-13-15T07:40:00Z',
      ` ${KICKOFF_ISO}`,
    ];

    for (const input of inputs) {
      expect(() => toDateTimeValue(input)).toThrow(RangeError);
    }
  });

  test('不正なDateは例外を投げる', () => {
    expect(() => toDateTimeValue(new Date(Number.NaN))).toThrow(RangeError);
  });
});
