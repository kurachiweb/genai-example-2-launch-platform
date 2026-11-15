import { describe, expect, test } from 'bun:test';

import {
  parseHelpArticleOrderSearch,
  selectHelpOrderCategory,
} from './help-article-order-search.ts';

const PRICING = Object.freeze({ id: '01JD0HCAT00000000000000002' });
const USAGE = Object.freeze({ id: '01JD0HCAT00000000000000001' });

describe('parseHelpArticleOrderSearch', () => {
  test('カテゴリのIDを受け、他の項目を残さない', () => {
    expect(
      parseHelpArticleOrderSearch({ category: USAGE.id, status: 'draft' }),
    ).toStrictEqual({ category: USAGE.id });
  });

  test('指定が無ければカテゴリを未指定として返す', () => {
    expect(parseHelpArticleOrderSearch({})).toStrictEqual({
      category: undefined,
    });
  });

  test('空・65文字以上・文字列でない値は未指定として扱う', () => {
    for (const category of ['', 'c'.repeat(65), 123, true, null, ['a']]) {
      expect(parseHelpArticleOrderSearch({ category })).toStrictEqual({
        category: undefined,
      });
    }
    expect(
      parseHelpArticleOrderSearch({ category: 'c'.repeat(64) }),
    ).toStrictEqual({ category: 'c'.repeat(64) });
  });
});

describe('selectHelpOrderCategory', () => {
  test('指定したカテゴリがあればそのカテゴリを選ぶ', () => {
    expect(selectHelpOrderCategory([PRICING, USAGE], USAGE.id)).toBe(USAGE);
  });

  test('指定が無い、または指定したカテゴリが無ければ並び順の先頭のカテゴリを選ぶ', () => {
    expect(selectHelpOrderCategory([PRICING, USAGE], undefined)).toBe(PRICING);
    expect(
      selectHelpOrderCategory([PRICING, USAGE], '01JD0HCAT00000000000000009'),
    ).toBe(PRICING);
  });

  test('カテゴリが1件も無ければ選ばない', () => {
    const none: readonly (typeof USAGE)[] = [];
    expect(selectHelpOrderCategory(none, USAGE.id)).toBeUndefined();
  });
});
