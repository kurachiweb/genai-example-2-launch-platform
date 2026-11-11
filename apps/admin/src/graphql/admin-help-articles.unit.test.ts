import { describe, expect, mock, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';

import { documentIdOf } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  type AdminHelpArticleRowView,
  adminHelpArticleQueryOptions,
  adminHelpArticlesQueryOptions,
  helpArticleHandleAvailabilityQueryOptions,
  invalidateHelpArticleQueries,
  loadAdminHelpArticlesPage,
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
