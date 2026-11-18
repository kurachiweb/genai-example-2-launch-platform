import { describe, expect, test } from 'bun:test';

import {
  BRACKET_COPY,
  BRACKET_PERIOD_LABEL,
} from './tournament-bracket-fixtures.ts';

describe('ブラケットのテストの文言', () => {
  test('ページの題は、期間のラベルにトーナメントの名前を続ける', () => {
    expect(BRACKET_COPY.pageTitle(BRACKET_PERIOD_LABEL)).toBe(
      '2026年第45週(11/2〜11/8) Product of the Testトーナメント',
    );
  });

  test('参加数とシード数の文は、両方の数を含む', () => {
    expect(BRACKET_COPY.counts(6, 2)).toBe('テストの参加6・シード2');
  });
});
