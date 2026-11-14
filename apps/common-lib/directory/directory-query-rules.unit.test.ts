import { describe, expect, test } from 'bun:test';

import { countGraphemes } from '../text/graphemes.ts';
import {
  DIRECTORY_PAGE_SIZE,
  DIRECTORY_SEARCH_COUNTER_FROM,
  DIRECTORY_SEARCH_MAX_GRAPHEMES,
  DIRECTORY_SORTS,
  type DirectoryQuery,
  changedConditionCount,
  effectiveSort,
  normalizeDirectoryQuery,
  withConditions,
} from './directory-query-rules.ts';

const FAMILY = '👨‍👩‍👧‍👦';

describe('ディレクトリの定数', () => {
  test('1ページの件数・検索語の上限・カウンターを示し始める文字数を定める', () => {
    expect(DIRECTORY_PAGE_SIZE).toBe(20);
    expect(DIRECTORY_SEARCH_MAX_GRAPHEMES).toBe(50);
    expect(DIRECTORY_SEARCH_COUNTER_FROM).toBe(40);
  });

  test('並び順は関連度・新しい順・古い順・Upvote数が多い順の4つで、少ない順を持たない', () => {
    expect(DIRECTORY_SORTS).toEqual([
      'relevance',
      'newest',
      'oldest',
      'upvotes',
    ]);
    expect(Object.isFrozen(DIRECTORY_SORTS)).toBe(true);
  });
});

describe('normalizeDirectoryQuery', () => {
  test('クエリが無ければ全ての項目を既定(無し)にする', () => {
    expect(normalizeDirectoryQuery({})).toStrictEqual({
      q: undefined,
      category: undefined,
      from: undefined,
      to: undefined,
      sort: undefined,
      page: undefined,
    });
  });

  test('正しいクエリはそのまま受け取り、検索語の前後の空白を除く', () => {
    expect(
      normalizeDirectoryQuery({
        q: '  ai tool　',
        category: 'developer-tools',
        from: '2026-09-01',
        to: '2026-09-30',
        sort: 'upvotes',
        page: 3,
      }),
    ).toStrictEqual({
      q: 'ai tool',
      category: 'developer-tools',
      from: '2026-09-01',
      to: '2026-09-30',
      sort: 'upvotes',
      page: 3,
    });
  });

  test('クエリに無い項目は元の値に関わらず結果に含める', () => {
    expect(Object.keys(normalizeDirectoryQuery({ extra: 'x' }))).toEqual([
      'q',
      'category',
      'from',
      'to',
      'sort',
      'page',
    ]);
  });

  describe('検索語', () => {
    test.each([
      ['空文字列', ''],
      ['半角の空白だけ', '   '],
      ['全角の空白と改行だけ', '　\n\t'],
    ])('%sは検索語が無いものとする', (_, q) => {
      expect(normalizeDirectoryQuery({ q }).q).toBeUndefined();
    });

    test('上限ちょうどの検索語はそのまま受け取る', () => {
      const q = 'あ'.repeat(DIRECTORY_SEARCH_MAX_GRAPHEMES);

      expect(normalizeDirectoryQuery({ q }).q).toBe(q);
    });

    test('上限を超える検索語を50書記素へ切り詰める', () => {
      const q = 'あ'.repeat(DIRECTORY_SEARCH_MAX_GRAPHEMES + 10);

      expect(normalizeDirectoryQuery({ q }).q).toBe(
        'あ'.repeat(DIRECTORY_SEARCH_MAX_GRAPHEMES),
      );
    });

    test('結合文字を含む絵文字を分割せずに書記素の単位で切り詰める', () => {
      const q = `${'a'.repeat(49)}${FAMILY}${FAMILY}`;

      const normalized = normalizeDirectoryQuery({ q }).q ?? '';

      expect(normalized).toBe(`${'a'.repeat(49)}${FAMILY}`);
      expect(countGraphemes(normalized)).toBe(50);
    });

    test('絵文字だけの長い検索語も50個の絵文字へ切り詰める', () => {
      const normalized =
        normalizeDirectoryQuery({ q: FAMILY.repeat(60) }).q ?? '';

      expect(normalized).toBe(FAMILY.repeat(50));
      expect(normalized.isWellFormed()).toBe(true);
    });

    test('切り詰めた末尾に残る空白を除く', () => {
      const q = `${'a'.repeat(49)} bcd`;

      expect(normalizeDirectoryQuery({ q }).q).toBe('a'.repeat(49));
    });

    test('数として読み取られた検索語は文字列に戻す', () => {
      expect(normalizeDirectoryQuery({ q: 2048 }).q).toBe('2048');
    });

    test.each([
      ['null', null],
      ['配列', ['ai']],
      ['オブジェクト', { q: 'ai' }],
      ['有限でない数', Number.NaN],
    ])('文字列でない検索語(%s)は無いものとする', (_, q) => {
      expect(normalizeDirectoryQuery({ q }).q).toBeUndefined();
    });
  });

  describe('カテゴリ', () => {
    test('大文字を含むハンドルも形を変えずに受け取る(存在の確認と同一視はAPIサーバー)', () => {
      expect(
        normalizeDirectoryQuery({ category: 'Developer-Tools' }).category,
      ).toBe('Developer-Tools');
    });

    test.each([
      ['空文字列', ''],
      ['空白を含む', 'developer tools'],
      ['記号で始まる', '-tools'],
      ['ASCII以外の文字', '開発ツール'],
      ['51文字', 'a'.repeat(51)],
      ['数でも文字列でもない', ['other']],
    ])('ハンドルの形でないカテゴリ(%s)は「全て」にする', (_, category) => {
      expect(normalizeDirectoryQuery({ category }).category).toBeUndefined();
    });

    test('数として読み取られたハンドルは文字列に戻す', () => {
      expect(normalizeDirectoryQuery({ category: 123 }).category).toBe('123');
    });
  });

  describe('期間', () => {
    test.each([
      ['存在しない日', '2026-02-30'],
      ['平年の2月29日', '2026-02-29'],
      ['13月', '2026-13-01'],
      ['0月', '2026-00-10'],
      ['0日', '2026-09-00'],
      ['桁の足りない月日', '2026-9-1'],
      ['時刻付き', '2026-09-01T00:00:00Z'],
      ['年が0', '0000-01-01'],
      ['日付でない文字列', 'yesterday'],
      ['数', 20260901],
    ])('実在しない日付(%s)の開始日と終了日を既定にする', (_, value) => {
      expect(normalizeDirectoryQuery({ from: value, to: value })).toMatchObject(
        { from: undefined, to: undefined },
      );
    });

    test('閏年の2月29日と月末を受け取る', () => {
      expect(
        normalizeDirectoryQuery({ from: '2028-02-29', to: '2028-12-31' }),
      ).toMatchObject({ from: '2028-02-29', to: '2028-12-31' });
    });

    test('片方だけの指定を受け取り、不正な側だけを既定にする', () => {
      expect(
        normalizeDirectoryQuery({ from: '2026-02-30', to: '2026-09-20' }),
      ).toMatchObject({ from: undefined, to: '2026-09-20' });
      expect(normalizeDirectoryQuery({ from: '2026-09-01' })).toMatchObject({
        from: '2026-09-01',
        to: undefined,
      });
    });

    test('開始日と終了日が同じ日の期間を受け取る', () => {
      expect(
        normalizeDirectoryQuery({ from: '2026-09-14', to: '2026-09-14' }),
      ).toMatchObject({ from: '2026-09-14', to: '2026-09-14' });
    });

    test('開始日が終了日より後なら両方を既定にする', () => {
      expect(
        normalizeDirectoryQuery({ from: '2026-09-21', to: '2026-09-20' }),
      ).toMatchObject({ from: undefined, to: undefined });
    });

    test('未来の日付は画面の検証に任せ、そのまま受け取る', () => {
      expect(normalizeDirectoryQuery({ from: '2999-01-01' }).from).toBe(
        '2999-01-01',
      );
    });
  });

  describe('並び順', () => {
    test('検索語が無いときの関連度を既定(新しい順)にする', () => {
      expect(normalizeDirectoryQuery({ sort: 'relevance' }).sort).toBe(
        undefined,
      );
    });

    test('既定と同じ並び順を省く', () => {
      expect(normalizeDirectoryQuery({ sort: 'newest' }).sort).toBeUndefined();
      expect(
        normalizeDirectoryQuery({ q: 'ai', sort: 'relevance' }).sort,
      ).toBeUndefined();
    });

    test('既定と違う並び順を受け取る', () => {
      expect(normalizeDirectoryQuery({ q: 'ai', sort: 'newest' }).sort).toBe(
        'newest',
      );
      expect(normalizeDirectoryQuery({ sort: 'oldest' }).sort).toBe('oldest');
      expect(normalizeDirectoryQuery({ sort: 'upvotes' }).sort).toBe('upvotes');
    });

    test('空白だけの検索語では関連度を既定にする', () => {
      expect(
        normalizeDirectoryQuery({ q: '   ', sort: 'relevance' }).sort,
      ).toBeUndefined();
    });

    test.each([
      ['少ない順', 'upvotes_asc'],
      ['大文字', 'NEWEST'],
      ['数', 1],
    ])('定めていない並び順(%s)を既定にする', (_, sort) => {
      expect(normalizeDirectoryQuery({ sort }).sort).toBeUndefined();
    });
  });

  describe('ページ', () => {
    test.each([
      ['0', 0],
      ['1', 1],
      ['負の数', -3],
      ['小数', 1.5],
      ['小数の2ページ目', 2.5],
      ['NaN', Number.NaN],
      ['無限大', Number.POSITIVE_INFINITY],
      ['安全な整数を超える数', Number.MAX_SAFE_INTEGER + 1],
      ['数でない文字列', 'abc'],
      ['文字列の1', '1'],
      ['文字列の0', '0'],
      ['小数の形の文字列', '1.5'],
      ['負の数の形の文字列', '-3'],
      ['前に空白のある文字列', ' 2'],
      ['先頭が0の文字列', '02'],
      ['指数の形の文字列', '2e1'],
      ['安全な整数を超える数字列', '9007199254740993'],
      ['空文字列', ''],
    ])('2以上の整数でないページ(%s)を1ページ目にする', (_, page) => {
      expect(normalizeDirectoryQuery({ page }).page).toBeUndefined();
    });

    test('2以上の整数のページを受け取る', () => {
      expect(normalizeDirectoryQuery({ page: 2 }).page).toBe(2);
      expect(normalizeDirectoryQuery({ page: 62 }).page).toBe(62);
    });

    test('10進の整数の形の文字列のページを数にして受け取る', () => {
      expect(normalizeDirectoryQuery({ page: '2' }).page).toBe(2);
      expect(normalizeDirectoryQuery({ page: '62' }).page).toBe(62);
    });
  });
});

describe('effectiveSort', () => {
  test('検索語が無く並び順も無ければ新しい順にする', () => {
    expect(effectiveSort({})).toBe('newest');
  });

  test('検索語があり並び順が無ければ関連度にする', () => {
    expect(effectiveSort({ q: 'ai' })).toBe('relevance');
  });

  test('指定した並び順を優先する', () => {
    expect(effectiveSort({ q: 'ai', sort: 'upvotes' })).toBe('upvotes');
    expect(effectiveSort({ sort: 'oldest' })).toBe('oldest');
  });
});

describe('withConditions', () => {
  test('条件を変えると1ページ目に戻す', () => {
    const query: DirectoryQuery = { category: 'developer-tools', page: 5 };

    expect(withConditions(query, { sort: 'upvotes' })).toStrictEqual({
      q: undefined,
      category: 'developer-tools',
      from: undefined,
      to: undefined,
      sort: 'upvotes',
      page: undefined,
    });
  });

  test.each<[string, Partial<Omit<DirectoryQuery, 'page'>>]>([
    ['検索語', { q: 'ai' }],
    ['カテゴリ', { category: 'other' }],
    ['期間', { from: '2026-09-01', to: '2026-09-30' }],
    ['並び順', { sort: 'oldest' }],
  ])('%sの変更でpageを外す', (_, patch) => {
    expect(withConditions({ page: 3 }, patch).page).toBeUndefined();
  });

  test('値を無しにした項目を外す', () => {
    expect(
      withConditions(
        { category: 'other', from: '2026-09-01', page: 2 },
        { category: undefined, from: undefined },
      ),
    ).toMatchObject({ category: undefined, from: undefined, page: undefined });
  });

  test('検索語を消すと既定になった並び順を省く', () => {
    expect(
      withConditions({ q: 'ai', sort: 'newest' }, { q: undefined }).sort,
    ).toBeUndefined();
  });

  test('変えた後の条件も正規化する', () => {
    expect(
      withConditions({}, { q: `  ${'あ'.repeat(60)}`, sort: 'relevance' }),
    ).toMatchObject({
      q: 'あ'.repeat(DIRECTORY_SEARCH_MAX_GRAPHEMES),
      sort: undefined,
    });
  });

  test('元の条件を書き換えない', () => {
    const query: DirectoryQuery = Object.freeze({ q: 'ai', page: 4 });

    withConditions(query, { q: 'tool' });

    expect(query).toStrictEqual({ q: 'ai', page: 4 });
  });
});

describe('changedConditionCount', () => {
  test('既定のままなら0にする', () => {
    expect(changedConditionCount({})).toBe(0);
  });

  test('検索語とページは数えない', () => {
    expect(changedConditionCount({ q: 'ai', page: 3 })).toBe(0);
  });

  test.each<[string, DirectoryQuery]>([
    ['カテゴリ', { category: 'other' }],
    ['開始日だけの期間', { from: '2026-09-01' }],
    ['終了日だけの期間', { to: '2026-09-20' }],
    ['開始日と終了日の期間', { from: '2026-09-14', to: '2026-09-20' }],
    ['並び順', { sort: 'oldest' }],
    ['検索語がある場合の新しい順', { q: 'ai', sort: 'newest' }],
  ])('%sを1つと数える', (_, query) => {
    expect(changedConditionCount(query)).toBe(1);
  });

  test('カテゴリ・期間・並び順を全て変えれば3にする', () => {
    expect(
      changedConditionCount({
        category: 'other',
        from: '2026-09-14',
        to: '2026-09-20',
        sort: 'upvotes',
      }),
    ).toBe(3);
  });
});
