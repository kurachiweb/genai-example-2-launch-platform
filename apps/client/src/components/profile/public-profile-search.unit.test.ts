import { describe, expect, test } from 'bun:test';

import { toPublicProfileSearch } from './public-profile-search.ts';

describe('toPublicProfileSearch', () => {
  test.each(['launches', 'upvotes', 'a', 'tab-1'])(
    'タブの識別子の形(%p)はそのまま返す',
    (tab) => {
      expect(toPublicProfileSearch({ tab })).toStrictEqual({ tab });
    },
  );

  test('tabが無ければundefinedの項目を返す', () => {
    expect(toPublicProfileSearch({})).toStrictEqual({ tab: undefined });
  });

  test.each([
    ['空文字', ''],
    ['大文字を含む', 'Launches'],
    ['数字で始まる', '1tab'],
    ['記号を含む', 'a_b'],
    ['長すぎる', 'a'.repeat(65)],
    ['文字列でない', 3],
    ['配列', ['a', 'b']],
    ['null', null],
  ])('不正な値(%s)は欠落と同じに扱う', (_label, tab) => {
    expect(toPublicProfileSearch({ tab })).toStrictEqual({ tab: undefined });
  });

  test('他のクエリはこの検証の結果に含めない', () => {
    expect(toPublicProfileSearch({ tab: 'a', utm_source: 'x' })).toStrictEqual({
      tab: 'a',
    });
  });
});
