import { describe, expect, test } from 'bun:test';

import {
  formatUpvoteHistoryDate,
  upvoteHistoryDayCountLabel,
} from './upvote-history-date.ts';

describe('formatUpvoteHistoryDate', () => {
  test.each([
    ['2026-10-02', '2026年10月2日(金)'],
    ['2026-01-01', '2026年1月1日(木)'],
    ['2025-12-31', '2025年12月31日(水)'],
    ['2028-02-29', '2028年2月29日(火)'],
  ])('業務日付%sを年・月・日と曜日で示す', (date, expected) => {
    expect(formatUpvoteHistoryDate(date)).toBe(expected);
  });

  test('業務日付の形でない値は受け付けない', () => {
    expect(() => formatUpvoteHistoryDate('2026/10/02')).toThrow(RangeError);
  });
});

describe('upvoteHistoryDayCountLabel', () => {
  test.each([
    [3, '3件'],
    [1234, '1,234件'],
  ])('%iを3桁区切りの件数にする', (count, expected) => {
    expect(upvoteHistoryDayCountLabel(count)).toBe(expected);
  });
});
