import { describe, expect, test } from 'bun:test';

import { upvoteHistoryDayCountLabel } from './upvote-history-date.ts';

describe('upvoteHistoryDayCountLabel', () => {
  test.each([
    [3, '3件'],
    [1234, '1,234件'],
  ])('%iを3桁区切りの件数にする', (count, expected) => {
    expect(upvoteHistoryDayCountLabel(count)).toBe(expected);
  });
});
