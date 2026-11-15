import { describe, expect, test } from 'bun:test';

import { HELP_SEARCH_RESULT_LIMIT } from '../../../common-lib/help/help-input-rules.ts';
import type { HelpAuthorLookup, HelpAuthorView } from './help-authors.ts';
import type {
  PublicHelpArticleDetailRecord,
  PublicHelpResolution,
  PublicHelpSearchHitRecord,
  PublicHelpStore,
  PublishedHelpArticleRecord,
  PublishedHelpCategoryRecord,
} from './ports.ts';
import {
  type HelpCenterCategoryView,
  type HelpSearchHitView,
  type PublicHelpArticleResult,
  StorePublicHelpReader,
} from './public-help-reader.ts';

const T0 = new Date('2026-11-01T00:00:00.000Z');
const UPDATED_AT = new Date('2026-11-10T12:34:56.000Z');
const AUTHOR_ADMIN_ID = '01JBX8Y4Z5AUTHOR000000000A';

const USAGE_ID = '01JD0HCAT00000000000000001';
const BILLING_ID = '01JD0HCAT00000000000000002';
const EMPTY_ID = '01JD0HCAT00000000000000003';

const AUTHOR: HelpAuthorView = Object.freeze({
  nickname: 'サポートの山田',
  title: 'カスタマーサポート',
  avatarFileId: '01JBX8Y4Z5AVATAR000000000A',
});

const categoryOf = (
  id: string,
  name: string,
  sortOrder: number,
): PublishedHelpCategoryRecord =>
  Object.freeze({ id, name, sortOrder, createdAt: T0 });

const articleOf = (
  index: number,
  overrides: Partial<PublishedHelpArticleRecord> = {},
): PublishedHelpArticleRecord =>
  Object.freeze({
    id: `01JD0HART${String(index).padStart(17, '0')}`,
    handle: `article-${String(index)}`,
    title: `記事${String(index)}`,
    subtitle: `記事${String(index)}の説明`,
    pinned: false,
    categoryId: USAGE_ID,
    sortOrder: index,
    createdAt: T0,
    ...overrides,
  });

// 並び順の値と取得の順が逆になるように並べる
const CATEGORIES: readonly PublishedHelpCategoryRecord[] = [
  categoryOf(USAGE_ID, '使い方', 3),
  categoryOf(EMPTY_ID, '公開の記事が無いカテゴリ', 1),
  categoryOf(BILLING_ID, '料金', 2),
];

const USAGE_OTHER_LATE = articleOf(1, { sortOrder: 4 });
const USAGE_PINNED_LATE = articleOf(2, { pinned: true, sortOrder: 3 });
const USAGE_OTHER_EARLY = articleOf(3, { sortOrder: 1 });
const USAGE_PINNED_EARLY = articleOf(4, { pinned: true, sortOrder: 2 });
const BILLING_OTHER = articleOf(5, { categoryId: BILLING_ID, sortOrder: 2 });
const BILLING_PINNED = articleOf(6, {
  categoryId: BILLING_ID,
  pinned: true,
  sortOrder: 1,
});

const ARTICLES: readonly PublishedHelpArticleRecord[] = [
  USAGE_OTHER_LATE,
  USAGE_PINNED_LATE,
  USAGE_OTHER_EARLY,
  USAGE_PINNED_EARLY,
  BILLING_OTHER,
  BILLING_PINNED,
];

const summaryOf = (article: PublishedHelpArticleRecord) => ({
  handle: article.handle,
  title: article.title,
  subtitle: article.subtitle,
  pinned: article.pinned,
});

const DETAIL: PublicHelpArticleDetailRecord = Object.freeze({
  ...articleOf(10, {
    handle: 'Reset-Password',
    title: 'パスワードを再設定する',
  }),
  bodyMarkdown: '## 手順\n\n設定画面から再設定のメールを送ります。',
  categoryName: '使い方',
  createdByAdminId: AUTHOR_ADMIN_ID,
  updatedAt: UPDATED_AT,
  sameCategory: [
    USAGE_OTHER_LATE,
    USAGE_PINNED_LATE,
    USAGE_OTHER_EARLY,
    USAGE_PINNED_EARLY,
  ],
});

interface ReaderFakeOptions {
  readonly categories?: readonly PublishedHelpCategoryRecord[];
  readonly articles?: readonly PublishedHelpArticleRecord[];
  // 大文字小文字を区別しないハンドルの解決の結果
  readonly resolutions?: Readonly<Record<string, PublicHelpResolution>>;
  readonly details?: readonly PublicHelpArticleDetailRecord[];
  // 公開の記事のIDと現在のハンドル
  readonly publishedHandles?: Readonly<Record<string, string>>;
  readonly searchHits?: readonly PublicHelpSearchHitRecord[];
  readonly authors?: ReadonlyMap<string, HelpAuthorView>;
}

function setup(options: ReaderFakeOptions = {}) {
  const calls: string[] = [];
  const searches: (readonly [string, number])[] = [];
  const authorLookups: (readonly string[])[] = [];
  const store: PublicHelpStore = {
    listPublished: () => {
      calls.push('listPublished');
      return Promise.resolve({
        categories: options.categories ?? CATEGORIES,
        articles: options.articles ?? ARTICLES,
      });
    },
    resolve: (handle) => {
      calls.push('resolve');
      return Promise.resolve(
        options.resolutions?.[handle.toLowerCase()] ?? { kind: 'none' },
      );
    },
    findPublishedDetail: (articleId) => {
      calls.push('findPublishedDetail');
      return Promise.resolve(
        (options.details ?? [DETAIL]).find(({ id }) => id === articleId),
      );
    },
    findPublishedHandle: (articleId) => {
      calls.push('findPublishedHandle');
      return Promise.resolve(options.publishedHandles?.[articleId]);
    },
    search: (matchExpression, limit) => {
      calls.push('search');
      searches.push([matchExpression, limit]);
      return Promise.resolve(options.searchHits ?? []);
    },
  };
  const authors: HelpAuthorLookup = {
    find: (adminIds) => {
      authorLookups.push(adminIds);
      return Promise.resolve(
        options.authors ?? new Map([[AUTHOR_ADMIN_ID, AUTHOR]]),
      );
    },
  };
  return {
    reader: new StorePublicHelpReader(store, authors),
    calls,
    searches,
    authorLookups,
  };
}

const NOT_FOUND: PublicHelpArticleResult = { kind: 'not-found' };

describe('StorePublicHelpReader', () => {
  describe('helpCenter', () => {
    test('カテゴリの並び順に並べ、各カテゴリでピン留めの群を先頭にして記事の並び順で並べ、公開の記事の無いカテゴリを除く', async () => {
      const { reader } = setup();

      const groups = await reader.helpCenter();

      expect(groups).toEqual<readonly HelpCenterCategoryView[]>([
        {
          name: '料金',
          articles: [BILLING_PINNED, BILLING_OTHER].map(summaryOf),
        },
        {
          name: '使い方',
          articles: [
            USAGE_PINNED_EARLY,
            USAGE_PINNED_LATE,
            USAGE_OTHER_EARLY,
            USAGE_OTHER_LATE,
          ].map(summaryOf),
        },
      ]);
    });

    test('公開の記事が無ければ空の一覧を返す', async () => {
      const { reader } = setup({ articles: [] });

      expect(await reader.helpCenter()).toEqual([]);
    });
  });

  describe('findArticle', () => {
    test.each([
      ['空', ''],
      ['記号で始まる', '-reset'],
      ['許されない文字を含む', 'reset password'],
      ['日本語を含む', 'パスワード'],
      ['51文字の', 'a'.repeat(51)],
    ])(
      '%sハンドルは照会せずに存在しない記事と同じ結果にする',
      async (_label, handle) => {
        const { reader, calls } = setup();

        expect(await reader.findArticle(handle)).toEqual(NOT_FOUND);
        expect(calls).toEqual([]);
      },
    );

    test('解決できないハンドルは存在しない記事にする', async () => {
      const { reader, calls } = setup();

      expect(await reader.findArticle('missing')).toEqual(NOT_FOUND);
      expect(calls).toEqual(['resolve']);
    });

    test('現在のハンドルの公開の記事を、作成者と同カテゴリの記事を付けて返す', async () => {
      const { reader, authorLookups } = setup({
        resolutions: {
          'reset-password': { kind: 'current', articleId: DETAIL.id },
        },
      });

      const result = await reader.findArticle('RESET-PASSWORD');

      expect(result).toEqual<PublicHelpArticleResult>({
        kind: 'article',
        article: {
          handle: 'Reset-Password',
          title: 'パスワードを再設定する',
          subtitle: DETAIL.subtitle,
          bodyMarkdown: DETAIL.bodyMarkdown,
          categoryName: '使い方',
          author: AUTHOR,
          updatedAt: UPDATED_AT,
          relatedArticles: [
            USAGE_PINNED_EARLY,
            USAGE_PINNED_LATE,
            USAGE_OTHER_EARLY,
            USAGE_OTHER_LATE,
          ].map(summaryOf),
        },
      });
      expect(authorLookups).toEqual([[AUTHOR_ADMIN_ID]]);
    });

    test('作成者の管理者が照会の結果に無ければ削除済みとして作成者を空にする', async () => {
      const { reader } = setup({
        resolutions: {
          'reset-password': { kind: 'current', articleId: DETAIL.id },
        },
        authors: new Map(),
      });

      const result = await reader.findArticle('reset-password');

      expect(result).toMatchObject({
        kind: 'article',
        article: { author: null },
      });
    });

    test('同じカテゴリに他の公開の記事が無ければ同カテゴリの記事を空にする', async () => {
      const { reader } = setup({
        resolutions: {
          'reset-password': { kind: 'current', articleId: DETAIL.id },
        },
        details: [{ ...DETAIL, sameCategory: [] }],
      });

      expect(await reader.findArticle('reset-password')).toMatchObject({
        kind: 'article',
        article: { relatedArticles: [] },
      });
    });

    test('解決の後に公開の記事でなくなっていれば存在しない記事にし、作成者を照会しない', async () => {
      const { reader, authorLookups } = setup({
        resolutions: {
          'reset-password': { kind: 'current', articleId: DETAIL.id },
        },
        details: [],
      });

      expect(await reader.findArticle('reset-password')).toEqual(NOT_FOUND);
      expect(authorLookups).toEqual([]);
    });

    test('公開の記事の旧ハンドルは現在のハンドルへの転送にする', async () => {
      const { reader, calls } = setup({
        resolutions: {
          'old-reset': { kind: 'previous', articleId: DETAIL.id },
        },
        publishedHandles: { [DETAIL.id]: 'Reset-Password' },
      });

      expect(
        await reader.findArticle('Old-Reset'),
      ).toEqual<PublicHelpArticleResult>({
        kind: 'redirect',
        handle: 'Reset-Password',
      });
      expect(calls).toEqual(['resolve', 'findPublishedHandle']);
    });

    test('旧ハンドルの保持者が下書きなら転送せずに存在しない記事にする', async () => {
      const { reader } = setup({
        resolutions: {
          'old-reset': { kind: 'previous', articleId: DETAIL.id },
        },
        publishedHandles: {},
      });

      expect(await reader.findArticle('old-reset')).toEqual(NOT_FOUND);
    });
  });

  describe('pinned', () => {
    test('ピン留めの記事だけを、カテゴリの並び順と記事の並び順でタイトルとハンドルにして返す', async () => {
      const { reader } = setup();

      expect(await reader.pinned()).toEqual(
        [BILLING_PINNED, USAGE_PINNED_EARLY, USAGE_PINNED_LATE].map(
          ({ handle, title }) => ({ handle, title }),
        ),
      );
    });

    test('ピン留めの公開の記事が無ければ空の一覧を返す', async () => {
      const { reader } = setup({
        articles: [USAGE_OTHER_EARLY, BILLING_OTHER],
      });

      expect(await reader.pinned()).toEqual([]);
    });
  });

  describe('search', () => {
    const hitOf = (
      article: PublishedHelpArticleRecord,
      categoryName: string,
    ): PublicHelpSearchHitRecord => ({ ...article, categoryName });

    test('検索語から前方一致の検索式を作り、上限件数で照会した結果をストアの順のまま返す', async () => {
      const { reader, searches } = setup({
        searchHits: [
          hitOf(BILLING_OTHER, '料金'),
          hitOf(USAGE_PINNED_LATE, '使い方'),
        ],
      });

      const hits = await reader.search('ログイン　メール');

      expect(hits).toEqual<readonly HelpSearchHitView[]>([
        { ...summaryOf(BILLING_OTHER), categoryName: '料金' },
        { ...summaryOf(USAGE_PINNED_LATE), categoryName: '使い方' },
      ]);
      expect(searches).toEqual([
        ['"ログイン"* "メール"*', HELP_SEARCH_RESULT_LIMIT],
      ]);
    });

    test('検索語をNFKC正規化し、検索式の構文や記号を文字列として渡す', async () => {
      const { reader, searches } = setup();

      await reader.search('ＲＯＣＫＥＴ "or NEAR(a b) title:*');

      expect(searches).toEqual([
        [
          '"ROCKET"* """or"* "NEAR(a"* "b)"* "title:*"*',
          HELP_SEARCH_RESULT_LIMIT,
        ],
      ]);
    });

    test.each([
      ['空', ''],
      ['空白だけの', ' 　\t'],
    ])('%s検索語は照会せずに空の結果を返す', async (_label, query) => {
      const { reader, calls } = setup();

      expect(await reader.search(query)).toEqual([]);
      expect(calls).toEqual([]);
    });
  });
});
