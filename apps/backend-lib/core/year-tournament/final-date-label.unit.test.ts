import { describe, expect, test } from 'bun:test';

import { parseBusinessDate } from '../time/business-time.ts';
import { formatFinalDateLabel } from './final-date-label.ts';

describe('formatFinalDateLabel', () => {
  test.each([
    { date: '2027-05-30', expected: '2027年5月30日(日)' },
    { date: '2026-05-31', expected: '2026年5月31日(日)' },
    { date: '2028-01-03', expected: '2028年1月3日(月)' },
    { date: '2027-12-25', expected: '2027年12月25日(土)' },
    { date: '2027-03-02', expected: '2027年3月2日(火)' },
  ])('$dateを年・月日・曜日つきで示す', ({ date, expected }) => {
    expect(formatFinalDateLabel(parseBusinessDate(date))).toBe(expected);
  });

  test('月と日の0埋めを外す', () => {
    expect(formatFinalDateLabel(parseBusinessDate('2029-01-07'))).toBe(
      '2029年1月7日(日)',
    );
  });
});
