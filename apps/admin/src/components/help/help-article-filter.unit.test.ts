import { describe, expect, test } from 'bun:test';

import {
  buildCreatorOptions,
  DELETED_CREATOR_VALUE,
  filterHelpArticles,
  helpArticleFilterScopeOf,
  parseHelpArticleFilter,
} from './help-article-filter.ts';

const AUTHOR_A = '01JD0ADMIN0000000000000001';
const AUTHOR_B = '01JD0ADMIN0000000000000002';
const DELETED_A = '01JD0ADMIN0000000000000003';
const DELETED_B = '01JD0ADMIN0000000000000004';
const USAGE_ID = '01JD0HCAT00000000000000001';
const PRICING_ID = '01JD0HCAT00000000000000002';

describe('parseHelpArticleFilter', () => {
  test('作成者・カテゴリ・ステータスの正しい値をそのまま条件にする', () => {
    expect(
      parseHelpArticleFilter({
        creator: AUTHOR_A,
        category: USAGE_ID,
        status: 'draft',
      }),
    ).toStrictEqual({ creator: AUTHOR_A, category: USAGE_ID, status: 'draft' });
    expect(
      parseHelpArticleFilter({ creator: 'deleted', status: 'published' }),
    ).toStrictEqual({
      creator: DELETED_CREATOR_VALUE,
      category: undefined,
      status: 'published',
    });
  });

  test('不正な値は捨てて未指定にし、元の値を残さないよう全ての項目を返す', () => {
    expect(
      parseHelpArticleFilter({
        creator: '',
        category: 'c'.repeat(65),
        status: 'PUBLISHED',
      }),
    ).toStrictEqual({
      creator: undefined,
      category: undefined,
      status: undefined,
    });
    expect(
      parseHelpArticleFilter({ creator: 123, category: true, status: null }),
    ).toStrictEqual({
      creator: undefined,
      category: undefined,
      status: undefined,
    });
  });

  test('64文字までのIDは受け、条件に無い項目は捨てる', () => {
    expect(
      parseHelpArticleFilter({ category: 'c'.repeat(64), page: '2' }),
    ).toStrictEqual({
      creator: undefined,
      category: 'c'.repeat(64),
      status: undefined,
    });
  });
});

describe('helpArticleFilterScopeOf', () => {
  test('項目の順や未指定の書き方によらず、同じ条件を同じ値にする', () => {
    expect(
      helpArticleFilterScopeOf({ status: 'draft', creator: AUTHOR_A }),
    ).toBe(
      helpArticleFilterScopeOf({
        creator: AUTHOR_A,
        category: undefined,
        status: 'draft',
      }),
    );
    expect(helpArticleFilterScopeOf({ status: 'draft' })).not.toBe(
      helpArticleFilterScopeOf({ status: 'published' }),
    );
  });
});

const authorOf = (nickname: string) => ({ nickname });

describe('buildCreatorOptions', () => {
  test('記事の作成者を重ねずにニックネームの順に並べ、削除済みの管理者は末尾の1つにまとめる', () => {
    expect(
      buildCreatorOptions([
        { creatorAdminId: DELETED_A, creator: null },
        { creatorAdminId: AUTHOR_B, creator: authorOf('山田') },
        { creatorAdminId: AUTHOR_A, creator: authorOf('伊藤') },
        { creatorAdminId: DELETED_B, creator: null },
        { creatorAdminId: AUTHOR_B, creator: authorOf('山田') },
      ]),
    ).toStrictEqual([
      { value: AUTHOR_A, label: '伊藤' },
      { value: AUTHOR_B, label: '山田' },
      { value: DELETED_CREATOR_VALUE, label: '削除済みの管理者' },
    ]);
  });

  test('削除済みの管理者の記事が無ければその選択肢を作らず、記事が無ければ空にする', () => {
    expect(
      buildCreatorOptions([
        { creatorAdminId: AUTHOR_A, creator: authorOf('伊藤') },
      ]),
    ).toStrictEqual([{ value: AUTHOR_A, label: '伊藤' }]);
    expect(buildCreatorOptions([])).toStrictEqual([]);
  });

  test('同じニックネームの管理者は管理者ごとの選択肢にし、IDの順に並べる', () => {
    expect(
      buildCreatorOptions([
        { creatorAdminId: AUTHOR_B, creator: authorOf('運営') },
        { creatorAdminId: AUTHOR_A, creator: authorOf('運営') },
      ]),
    ).toStrictEqual([
      { value: AUTHOR_A, label: '運営' },
      { value: AUTHOR_B, label: '運営' },
    ]);
  });
});

describe('filterHelpArticles', () => {
  const rows = [
    {
      id: 'a',
      creatorAdminId: AUTHOR_A,
      creator: authorOf('伊藤'),
      categoryId: USAGE_ID,
      status: 'published',
    },
    {
      id: 'b',
      creatorAdminId: AUTHOR_A,
      creator: authorOf('伊藤'),
      categoryId: PRICING_ID,
      status: 'draft',
    },
    {
      id: 'c',
      creatorAdminId: AUTHOR_B,
      creator: authorOf('山田'),
      categoryId: USAGE_ID,
      status: 'draft',
    },
    {
      id: 'd',
      creatorAdminId: DELETED_A,
      creator: null,
      categoryId: USAGE_ID,
      status: 'draft',
    },
    {
      id: 'e',
      creatorAdminId: DELETED_B,
      creator: null,
      categoryId: PRICING_ID,
      status: 'published',
    },
  ] as const;

  const idsOf = (filter: Parameters<typeof filterHelpArticles>[1]) =>
    filterHelpArticles(rows, filter).map(({ id }) => id);

  test('条件が無ければ全ての行を元の順のまま返す', () => {
    expect(idsOf({})).toStrictEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('作成者・カテゴリ・ステータスのそれぞれで絞り込む', () => {
    expect(idsOf({ creator: AUTHOR_A })).toStrictEqual(['a', 'b']);
    expect(idsOf({ category: PRICING_ID })).toStrictEqual(['b', 'e']);
    expect(idsOf({ status: 'published' })).toStrictEqual(['a', 'e']);
  });

  test('削除済みの作成者の条件は、作成者が削除された全ての管理者の記事を返す', () => {
    expect(idsOf({ creator: DELETED_CREATOR_VALUE })).toStrictEqual(['d', 'e']);
  });

  test('複数の条件は全てを満たす行だけを返す', () => {
    expect(idsOf({ creator: AUTHOR_A, status: 'draft' })).toStrictEqual(['b']);
    expect(idsOf({ category: USAGE_ID, status: 'draft' })).toStrictEqual([
      'c',
      'd',
    ]);
    expect(
      idsOf({
        creator: DELETED_CREATOR_VALUE,
        category: USAGE_ID,
        status: 'draft',
      }),
    ).toStrictEqual(['d']);
    expect(
      idsOf({ creator: AUTHOR_B, category: PRICING_ID, status: 'draft' }),
    ).toStrictEqual([]);
  });
});
