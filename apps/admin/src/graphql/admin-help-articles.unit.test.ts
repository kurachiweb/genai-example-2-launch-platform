import { describe, expect, mock, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { isNotFound } from '@tanstack/react-router';

import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  type AdminHelpArticleRowView,
  adminHelpArticleQueryOptions,
  adminHelpArticlesQueryOptions,
  helpArticleHandleAvailabilityQueryOptions,
  invalidateHelpArticleQueries,
  loadAdminHelpArticleNewPage,
  loadAdminHelpArticlePage,
  loadAdminHelpArticlesPage,
  mergeReorderedHelpArticles,
  refreshHelpArticleQueriesAfterDelete,
  toAdminHelpArticle,
  toAdminHelpArticleDetail,
  toAdminHelpArticleRows,
  toGraphQLHelpArticleStatus,
  toHelpArticleHandleAvailability,
  toHelpArticleOrderGroups,
} from './admin-help-articles.ts';
import { adminHelpCategoriesQueryOptions } from './admin-help-categories.ts';
import {
  type AdminHelpArticleFragment,
  AdminHelpArticleDocument,
  AdminHelpArticleHandleAvailabilityDocument,
  type AdminHelpArticleRowFragment,
  AdminHelpArticlesDocument,
  AdminHelpCategoriesDocument,
  AdminViewerDocument,
} from './generated/graphql.ts';

const USAGE_ID = '01JD0HCAT00000000000000001';
const PRICING_ID = '01JD0HCAT00000000000000002';
const AUTHOR_ID = '01JD0ADMIN0000000000000001';
const DELETED_AUTHOR_ID = '01JD0ADMIN0000000000000002';
const T0 = '2026-11-01T00:00:00.000Z';
const T1 = '2026-11-02T00:00:00.000Z';
const T2 = '2026-11-03T00:00:00.000Z';

const AVATAR = {
  id: '01JD0MEDIA0000000000000001',
  objectKey: 'avatars/01JD0MEDIA0000000000000001',
  fallbackFormat: 'PNG',
  width: 256,
  height: 256,
} as const;

const rowOf = (
  overrides: Partial<AdminHelpArticleRowFragment> &
    Pick<AdminHelpArticleRowFragment, 'id' | 'title'>,
): AdminHelpArticleRowFragment => ({
  handle: `handle-${overrides.id}`,
  categoryId: USAGE_ID,
  categoryName: '使い方',
  status: 'PUBLISHED',
  pinned: false,
  sortOrder: 1,
  creatorAdminId: AUTHOR_ID,
  creator: { nickname: '運営 太郎', title: 'サポート', avatar: AVATAR },
  createdAt: T0,
  updatedAt: T1,
  ...overrides,
});

const viewsOf = (
  rows: readonly AdminHelpArticleRowFragment[],
): readonly AdminHelpArticleRowView[] =>
  toAdminHelpArticleRows({ adminHelpArticles: [...rows] });

const ARTICLE: AdminHelpArticleFragment = {
  id: '01JD0HART00000000000000001',
  handle: 'Getting-Started',
  previousHandle: 'start',
  title: 'はじめに',
  subtitle: '最初に読む記事',
  body: '# 見出し\n\n本文',
  categoryId: USAGE_ID,
  categoryName: '使い方',
  status: 'DRAFT',
  pinned: true,
  creator: null,
  revision: 3,
  createdAt: T0,
  updatedAt: T2,
};

describe('toAdminHelpArticleRows', () => {
  test('APIが返した更新日時の新しい順のまま、ステータスを共有の値にし作成者と画像を表示用の値にする', () => {
    const rows = toAdminHelpArticleRows({
      adminHelpArticles: [
        rowOf({ id: 'a', title: '記事A', updatedAt: T2 }),
        rowOf({
          id: 'b',
          title: '記事B',
          status: 'DRAFT',
          pinned: true,
          creatorAdminId: DELETED_AUTHOR_ID,
          creator: null,
        }),
        rowOf({
          id: 'c',
          title: '記事C',
          creator: { nickname: '運営 花子', title: null, avatar: null },
        }),
      ],
    });

    expect(rows).toStrictEqual([
      {
        id: 'a',
        handle: 'handle-a',
        title: '記事A',
        categoryId: USAGE_ID,
        categoryName: '使い方',
        status: 'published',
        pinned: false,
        sortOrder: 1,
        creatorAdminId: AUTHOR_ID,
        creator: {
          nickname: '運営 太郎',
          title: 'サポート',
          avatar: {
            objectKey: AVATAR.objectKey,
            fallbackFormat: 'PNG',
            width: 256,
            height: 256,
          },
        },
        createdAt: T0,
        updatedAt: T2,
      },
      {
        id: 'b',
        handle: 'handle-b',
        title: '記事B',
        categoryId: USAGE_ID,
        categoryName: '使い方',
        status: 'draft',
        pinned: true,
        sortOrder: 1,
        creatorAdminId: DELETED_AUTHOR_ID,
        creator: null,
        createdAt: T0,
        updatedAt: T1,
      },
      {
        id: 'c',
        handle: 'handle-c',
        title: '記事C',
        categoryId: USAGE_ID,
        categoryName: '使い方',
        status: 'published',
        pinned: false,
        sortOrder: 1,
        creatorAdminId: AUTHOR_ID,
        creator: { nickname: '運営 花子', title: null, avatar: null },
        createdAt: T0,
        updatedAt: T1,
      },
    ]);
  });
});

describe('toAdminHelpArticle・toAdminHelpArticleDetail', () => {
  test('記事の全項目を表示用の値にし、旧ハンドルと版をそのまま持つ', () => {
    expect(toAdminHelpArticle(ARTICLE)).toStrictEqual({
      id: ARTICLE.id,
      handle: 'Getting-Started',
      previousHandle: 'start',
      title: 'はじめに',
      subtitle: '最初に読む記事',
      body: '# 見出し\n\n本文',
      categoryId: USAGE_ID,
      categoryName: '使い方',
      status: 'draft',
      pinned: true,
      creator: null,
      revision: 3,
      createdAt: T0,
      updatedAt: T2,
    });
  });

  test('照会の結果がnullなら記事が無いことをnullで返す', () => {
    expect(toAdminHelpArticleDetail({ adminHelpArticle: null })).toBeNull();
    expect(
      toAdminHelpArticleDetail({ adminHelpArticle: ARTICLE })?.handle,
    ).toBe('Getting-Started');
  });
});

describe('toGraphQLHelpArticleStatus', () => {
  test('共有のステータスの値をGraphQLの列挙の値にする', () => {
    expect(toGraphQLHelpArticleStatus('draft')).toBe('DRAFT');
    expect(toGraphQLHelpArticleStatus('published')).toBe('PUBLISHED');
  });
});

describe('toHelpArticleHandleAvailability', () => {
  test('GraphQLの列挙の値を画面の判定の値にする', () => {
    const of = (
      value:
        'AVAILABLE' | 'AVAILABLE_RELEASES_PREVIOUS' | 'UNAVAILABLE' | 'INVALID',
    ) =>
      toHelpArticleHandleAvailability({ helpArticleHandleAvailability: value });

    expect(of('AVAILABLE')).toBe('available');
    expect(of('AVAILABLE_RELEASES_PREVIOUS')).toBe(
      'available-releases-previous',
    );
    expect(of('UNAVAILABLE')).toBe('unavailable');
    expect(of('INVALID')).toBe('invalid');
  });
});

describe('toHelpArticleOrderGroups', () => {
  test('選んだカテゴリの記事だけを、ピン留めの群とそれ以外の群に分けて並び順の値の順に並べる', () => {
    const rows = viewsOf([
      rowOf({ id: 'd', title: 'D', sortOrder: 4, status: 'DRAFT' }),
      rowOf({ id: 'p2', title: 'P2', sortOrder: 2, pinned: true }),
      rowOf({ id: 'x', title: 'X', sortOrder: 1, categoryId: PRICING_ID }),
      rowOf({ id: 'c', title: 'C', sortOrder: 3 }),
      rowOf({ id: 'p1', title: 'P1', sortOrder: 5, pinned: true }),
    ]);

    const groups = toHelpArticleOrderGroups(rows, USAGE_ID);

    expect(groups.pinned.map(({ id }) => id)).toStrictEqual(['p2', 'p1']);
    expect(groups.others.map(({ id }) => id)).toStrictEqual(['c', 'd']);
    expect(groups.others[1]).toBe(rows[0]);
  });

  test('並び順の値が同じなら作成の古い順、作成日時も同じならIDの順に並べる', () => {
    const rows = viewsOf([
      rowOf({ id: 'b', title: 'B', sortOrder: 1, createdAt: T0 }),
      rowOf({ id: 'n', title: 'N', sortOrder: 1, createdAt: T1 }),
      rowOf({ id: 'a', title: 'A', sortOrder: 1, createdAt: T0 }),
    ]);

    expect(
      toHelpArticleOrderGroups(rows, USAGE_ID).others.map(({ id }) => id),
    ).toStrictEqual(['a', 'b', 'n']);
  });

  test('記事の無いカテゴリでは両方の群が空になる', () => {
    expect(toHelpArticleOrderGroups([], USAGE_ID)).toStrictEqual({
      pinned: [],
      others: [],
    });
  });
});

describe('mergeReorderedHelpArticles', () => {
  test('並べ替えの応答の記事だけを置き換え、全件の更新日時の新しい順と他のカテゴリの記事を保つ', () => {
    const others = rowOf({ id: 'x', title: 'X', categoryId: PRICING_ID });
    const first = rowOf({ id: 'a', title: 'A', sortOrder: 1 });
    const second = rowOf({ id: 'b', title: 'B', sortOrder: 2 });
    const data = { adminHelpArticles: [second, others, first] };

    const merged = mergeReorderedHelpArticles(data, [
      { ...second, sortOrder: 1 },
      { ...first, sortOrder: 2 },
    ]);

    expect(
      merged.adminHelpArticles.map(({ id, sortOrder }) => [id, sortOrder]),
    ).toStrictEqual([
      ['b', 1],
      ['x', 1],
      ['a', 2],
    ]);
    expect(merged.adminHelpArticles[1]).toBe(others);
    expect(data.adminHelpArticles[0]).toBe(second);
  });
});

describe('取得の設定', () => {
  test('取得のキーは操作の識別子と変数で、作成中のハンドルの確認は記事のIDをnullにする', () => {
    expect([...adminHelpArticlesQueryOptions().queryKey]).toStrictEqual([
      documentIdOf(AdminHelpArticlesDocument),
      {},
    ]);
    expect([
      ...adminHelpArticleQueryOptions(ARTICLE.id).queryKey,
    ]).toStrictEqual([
      documentIdOf(AdminHelpArticleDocument),
      { id: ARTICLE.id },
    ]);
    expect([
      ...helpArticleHandleAvailabilityQueryOptions('guide', ARTICLE.id)
        .queryKey,
    ]).toStrictEqual([
      documentIdOf(AdminHelpArticleHandleAvailabilityDocument),
      { handle: 'guide', articleId: ARTICLE.id },
    ]);
    expect([
      ...helpArticleHandleAvailabilityQueryOptions('guide').queryKey,
    ]).toStrictEqual([
      documentIdOf(AdminHelpArticleHandleAvailabilityDocument),
      { handle: 'guide', articleId: null },
    ]);
  });
});

describe('invalidateHelpArticleQueries', () => {
  test('記事の一覧・1件・ハンドルの使用可否と、記事の件数を持つカテゴリの一覧の取得を無効にし、他の取得は残す', async () => {
    const queryClient = new QueryClient();
    const keys = [
      adminHelpArticlesQueryOptions().queryKey,
      adminHelpArticleQueryOptions(ARTICLE.id).queryKey,
      helpArticleHandleAvailabilityQueryOptions('guide').queryKey,
      [documentIdOf(AdminHelpCategoriesDocument), {}],
    ];
    const viewerKey = [documentIdOf(AdminViewerDocument), {}];
    for (const key of [...keys, viewerKey]) {
      queryClient.setQueryData(key, {});
    }

    await invalidateHelpArticleQueries(queryClient);

    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(queryClient.getQueryState(viewerKey)?.isInvalidated).toBe(false);
  });
});

describe('loadAdminHelpArticlesPage', () => {
  test('記事の全件とカテゴリの一覧を同時に、鮮度を問わずキャッシュから読んで待つ', async () => {
    const pending: (() => void)[] = [];
    const query = mock(
      () =>
        new Promise<void>((resolve) => {
          pending.push(resolve);
        }),
    );
    let settled = false;

    const loading = loadAdminHelpArticlesPage({
      context: { queryClient: { query } as unknown as QueryClient },
    }).then(() => {
      settled = true;
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: adminHelpArticlesQueryOptions().queryKey,
        staleTime: 'static',
      }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: adminHelpCategoriesQueryOptions().queryKey,
        staleTime: 'static',
      }),
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    for (const resolve of pending) {
      resolve();
    }
    await loading;
    expect(settled).toBe(true);
  });

  test('取得の失敗は例外にせず、一覧の位置に示すためキャッシュに残す', async () => {
    const query = mock(() => Promise.reject(new Error('取得の失敗')));

    await loadAdminHelpArticlesPage({
      context: { queryClient: { query } as unknown as QueryClient },
    });

    expect(query).toHaveBeenCalledTimes(2);
  });
});

const ARTICLE_QUERY_KEY = adminHelpArticleQueryOptions(ARTICLE.id).queryKey;

const CATEGORIES_QUERY_KEY = adminHelpCategoriesQueryOptions().queryKey;

const isArticleQuery = (options: unknown): boolean =>
  JSON.stringify((options as { readonly queryKey: unknown }).queryKey) ===
  JSON.stringify(ARTICLE_QUERY_KEY);

const malformedIdError = () =>
  new GraphQLClientError({
    code: 'validation_error',
    message: '入力内容に誤りがあります。',
    status: 400,
    details: [
      {
        field: 'id',
        code: 'too_big',
        message: 'このヘルプ記事は削除されています。',
      },
    ],
  });

describe('loadAdminHelpArticleNewPage', () => {
  test('カテゴリの一覧を鮮度を問わずキャッシュから読んで待ち、失敗はエラーの画面に任せる', async () => {
    const failure = new Error('取得の失敗');
    const query = mock(() => Promise.reject(failure));

    const error: unknown = await loadAdminHelpArticleNewPage({
      context: { queryClient: { query } as unknown as QueryClient },
    }).catch((caught: unknown) => caught);

    expect(error).toBe(failure);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: CATEGORIES_QUERY_KEY,
        staleTime: 'static',
      }),
    );
  });
});

describe('loadAdminHelpArticlePage', () => {
  test('記事は開くたびに最新を取得し、カテゴリの一覧はキャッシュから読み、両方を同時に待つ', async () => {
    const pending: (() => void)[] = [];
    const query = mock(
      () =>
        new Promise<unknown>((resolve) => {
          pending.push(() => {
            resolve({ adminHelpArticle: ARTICLE });
          });
        }),
    );
    let settled = false;

    const loading = loadAdminHelpArticlePage({
      context: { queryClient: { query } as unknown as QueryClient },
      params: { articleId: ARTICLE.id },
    }).then(() => {
      settled = true;
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ARTICLE_QUERY_KEY, staleTime: 0 }),
    );
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: CATEGORIES_QUERY_KEY,
        staleTime: 'static',
      }),
    );
    await Promise.resolve();
    expect(settled).toBe(false);
    for (const resolve of pending) {
      resolve();
    }
    await loading;
    expect(settled).toBe(true);
  });

  test('削除された記事(null)は例外にせず、画面に削除の案内を出させる', async () => {
    const query = mock((options: unknown) =>
      Promise.resolve(
        isArticleQuery(options) ? { adminHelpArticle: null } : {},
      ),
    );

    await loadAdminHelpArticlePage({
      context: { queryClient: { query } as unknown as QueryClient },
      params: { articleId: ARTICLE.id },
    });

    expect(query).toHaveBeenCalledTimes(2);
  });

  test('IDの形式の違反は存在しないページにし、それ以外の失敗はエラーの画面に任せる', async () => {
    const failure = new GraphQLClientError({
      code: 'internal_error',
      message: '処理中に問題が発生しました。',
      status: 500,
    });
    const cases = [
      { rejection: malformedIdError(), expectNotFound: true },
      { rejection: failure, expectNotFound: false },
    ];

    for (const { rejection, expectNotFound } of cases) {
      const query = mock((options: unknown) =>
        isArticleQuery(options)
          ? Promise.reject(rejection)
          : Promise.resolve({}),
      );
      const error: unknown = await loadAdminHelpArticlePage({
        context: { queryClient: { query } as unknown as QueryClient },
        params: { articleId: ARTICLE.id },
      }).catch((caught: unknown) => caught);
      if (expectNotFound) {
        expect(isNotFound(error)).toBe(true);
      } else {
        expect(error).toBe(failure);
      }
    }
  });
});

describe('refreshHelpArticleQueriesAfterDelete', () => {
  test('表示していない記事の一覧とカテゴリの一覧も取得し直して待ち、記事の1件とハンドルの使用可否は取得し直さず古いものとする', async () => {
    const queryClient = new QueryClient();
    const listKey = adminHelpArticlesQueryOptions().queryKey;
    const availabilityKey =
      helpArticleHandleAvailabilityQueryOptions('guide').queryKey;
    const viewerKey = [documentIdOf(AdminViewerDocument), {}];
    const fetched: unknown[] = [];
    queryClient.setQueryDefaults([documentIdOf(AdminHelpArticlesDocument)], {
      queryFn: () => {
        fetched.push('articles');
        return Promise.resolve({ adminHelpArticles: [] });
      },
    });
    queryClient.setQueryDefaults([documentIdOf(AdminHelpCategoriesDocument)], {
      queryFn: () => {
        fetched.push('categories');
        return Promise.resolve({ adminHelpCategories: [] });
      },
    });
    queryClient.setQueryDefaults([documentIdOf(AdminHelpArticleDocument)], {
      queryFn: () => {
        fetched.push('article');
        return Promise.resolve({ adminHelpArticle: null });
      },
    });
    for (const key of [
      listKey,
      CATEGORIES_QUERY_KEY,
      ARTICLE_QUERY_KEY,
      availabilityKey,
      viewerKey,
    ]) {
      queryClient.setQueryData(key, {});
    }

    await refreshHelpArticleQueriesAfterDelete(queryClient);

    expect(fetched.toSorted()).toStrictEqual(['articles', 'categories']);
    expect(queryClient.getQueryData(listKey)).toStrictEqual({
      adminHelpArticles: [],
    });
    expect(queryClient.getQueryState(ARTICLE_QUERY_KEY)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(availabilityKey)?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(viewerKey)?.isInvalidated).toBe(false);
  });
});
