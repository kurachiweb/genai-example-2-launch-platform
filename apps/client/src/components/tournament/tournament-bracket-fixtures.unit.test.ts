import { describe, expect, test } from 'bun:test';

import { BRACKET_COPY } from './tournament-bracket-fixtures.ts';

describe('ブラケットのテストの文言', () => {
  test('参加数とシード数の文は、両方の数を含む', () => {
    expect(BRACKET_COPY.counts(6, 2)).toBe('テストの参加6・シード2');
  });
});
