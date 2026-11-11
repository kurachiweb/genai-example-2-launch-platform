import { describe, expect, mock, test } from 'bun:test';
import type { QueryClient } from '@tanstack/react-query';
import { isNotFound, isRedirect } from '@tanstack/react-router';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientHelpArticleDocument,
  type ClientHelpArticleQuery,
  ClientHelpArticleSearchDocument,
  ClientHelpCenterDocument,
  ClientPinnedHelpArticlesDocument,
} from './generated/graphql.ts';
import {
  helpArticleQueryOptions,
  helpArticleSearchQueryOptions,
  type HelpArticleView,
  helpCenterQueryOptions,
  loadHelpArticlePage,
  loadHelpTopPage,
  pinnedHelpArticlesQueryOptions,
  toHelpArticleView,
} from './help-center.ts';

describe('helpCenterQueryOptions', () => {
  test('ヘルプトップの操作と空の変数をキーにする', () => {
    expect([...helpCenterQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientHelpCenterDocument, {}),
    ]);
  });
});

describe('helpArticleQueryOptions', () => {
  test('記事詳細の操作と、URLのハンドルの変数をキーにする', () => {
    expect([
      ...helpArticleQueryOptions('how-upvote-works').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientHelpArticleDocument, {
        handle: 'how-upvote-works',
      }),
    ]);
  });

  test('ハンドルが違えば別のキーにする', () => {
    expect([
      ...helpArticleQueryOptions('week-tournament').queryKey,
    ]).not.toStrictEqual([
      ...helpArticleQueryOptions('how-upvote-works').queryKey,
    ]);
  });
});

describe('helpArticleSearchQueryOptions', () => {
  test('検索の操作と、検索語の変数をキーにする', () => {
    expect([
      ...helpArticleSearchQueryOptions('ピン留め').queryKey,
    ]).toStrictEqual([
      ...graphqlQueryKey(ClientHelpArticleSearchDocument, {
        query: 'ピン留め',
      }),
    ]);
  });
});

describe('pinnedHelpArticlesQueryOptions', () => {
  test('フッターのピン留め記事の操作と空の変数をキーにする', () => {
    expect([...pinnedHelpArticlesQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(ClientPinnedHelpArticlesDocument, {}),
    ]);
  });
});

// 取得の結果か失敗を返すキャッシュの取得
const queryClientWith = (result: unknown) => {
  const query = mock(() =>
    result instanceof Error ? Promise.reject(result) : Promise.resolve(result),
  );
  return { query, queryClient: { query } as unknown as QueryClient };
};

describe('loadHelpTopPage', () => {
  test('検索語が無ければ、カテゴリ別の一覧を鮮度を問わずキャッシュから読んで待つ', async () => {
    const { query, queryClient } = queryClientWith({ helpCenter: [] });

    await loadHelpTopPage({
      context: { queryClient },
      deps: { q: undefined },
      cause: 'enter',
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: helpCenterQueryOptions().queryKey,
        staleTime: 'static',
      }),
    );
  });

  test('検索語があれば、その検索語の検索結果だけを鮮度を問わずキャッシュから読んで待つ', async () => {
    const { query, queryClient } = queryClientWith({ helpArticleSearch: [] });

    await loadHelpTopPage({
      context: { queryClient },
      deps: { q: 'Upvote' },
      cause: 'enter',
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: helpArticleSearchQueryOptions('Upvote').queryKey,
        staleTime: 'static',
      }),
    );
  });

  test.each(['enter', 'preload'] as const)(
    '最初の表示(%s)の取得の失敗は、ルートのエラーの表示へ渡すため例外のまま投げる',
    async (cause) => {
      const failure = new Error('取得の失敗');
      const { queryClient } = queryClientWith(failure);

      const load = loadHelpTopPage({
        context: { queryClient },
        deps: { q: undefined },
        cause,
      });

      expect(await load.catch((error: unknown) => error)).toBe(failure);
    },
  );

  test('同じページ内の遷移(stay)では、取得を始めるだけで応答を待たない', async () => {
    const query = mock(() => new Promise<never>(() => undefined));
    const queryClient = { query } as unknown as QueryClient;

    const result = await Promise.race([
      loadHelpTopPage({
        context: { queryClient },
        deps: { q: 'Upvote' },
        cause: 'stay',
      }).then(() => 'returned'),
      new Promise((resolve) => setTimeout(resolve, 50, 'waiting')),
    ]);

    expect(result).toBe('returned');
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: helpArticleSearchQueryOptions('Upvote').queryKey,
        staleTime: 'static',
      }),
    );
  });

  test('同じページ内の遷移(stay)の取得の失敗は、画面の中で示すため例外にしない', async () => {
    const { queryClient } = queryClientWith(new Error('取得の失敗'));

    const load = loadHelpTopPage({
      context: { queryClient },
      deps: { q: 'Upvote' },
      cause: 'stay',
    });

    expect(await load.then(() => 'resolved')).toBe('resolved');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

const ARTICLE: HelpArticleView = {
  __typename: 'HelpArticle',
  handle: 'Upvote-Rules',
  title: 'Upvoteのルール',
  subtitle: '1日に何回Upvoteできるか',
  body: '## はじめに',
  categoryName: '使い方',
  author: null,
  updatedAt: '2026-11-10T09:30:00.000Z',
  relatedArticles: [],
};

const FOUND: ClientHelpArticleQuery = { helpArticle: ARTICLE };

const MISSING: ClientHelpArticleQuery = { helpArticle: null };

const MOVED: ClientHelpArticleQuery = {
  helpArticle: { __typename: 'HelpArticleRedirect', handle: 'Upvote-Rules' },
};

const NO_SEARCH = { search: {} };

const caught = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

describe('toHelpArticleView', () => {
  test('記事の結果だけを返し、転送とnullは返さない', () => {
    expect(toHelpArticleView(FOUND)).toBe(ARTICLE);
    expect(toHelpArticleView(MOVED)).toBeUndefined();
    expect(toHelpArticleView(MISSING)).toBeUndefined();
  });
});

describe('loadHelpArticlePage', () => {
  test('URLのハンドルの記事を鮮度を問わずキャッシュから読み、タイトルと現在のハンドルの表記を返す', async () => {
    const { query, queryClient } = queryClientWith(FOUND);

    const data = await loadHelpArticlePage({
      context: { queryClient },
      params: { handle: 'upvote-rules' },
      location: NO_SEARCH,
    });

    expect(data).toStrictEqual({
      handle: 'Upvote-Rules',
      title: 'Upvoteのルール',
    });
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: helpArticleQueryOptions('upvote-rules').queryKey,
        staleTime: 'static',
      }),
    );
  });

  test.each(['', 'a b', 'ヘルプ', 'a.b', '-leading', 'a'.repeat(51)])(
    'ハンドルの形式違反(%p)は照会せずに存在しないページにする',
    async (handle) => {
      const { query, queryClient } = queryClientWith(FOUND);

      const error = await caught(
        loadHelpArticlePage({
          context: { queryClient },
          params: { handle },
          location: NO_SEARCH,
        }),
      );

      expect(isNotFound(error)).toBe(true);
      expect(query).not.toHaveBeenCalled();
    },
  );

  test('照会の結果がnull(存在しない・下書き)なら存在しないページにする', async () => {
    const { queryClient } = queryClientWith(MISSING);

    const error = await caught(
      loadHelpArticlePage({
        context: { queryClient },
        params: { handle: 'draft-article' },
        location: NO_SEARCH,
      }),
    );

    expect(isNotFound(error)).toBe(true);
  });

  test('旧ハンドルは現在のハンドルの記事の経路へ、状態コード302と検索パラメーターを引き継いで転送する', async () => {
    const { queryClient } = queryClientWith(MOVED);

    const error = await caught(
      loadHelpArticlePage({
        context: { queryClient },
        params: { handle: 'old-rules' },
        location: { search: { utm_source: 'share', ref: 'mail' } },
      }),
    );

    expect(isRedirect(error)).toBe(true);
    if (!isRedirect(error)) {
      throw new Error('転送が投げられていない');
    }
    expect(error.status).toBe(302);
    expect(error.options).toMatchObject({
      to: '/help/$handle',
      params: { handle: 'Upvote-Rules' },
      search: { utm_source: 'share', ref: 'mail' },
      statusCode: 302,
    });
  });

  test('取得の失敗はエラーの画面にするため、そのまま投げる', async () => {
    const failure = new Error('取得の失敗');
    const { queryClient } = queryClientWith(failure);

    const error = await caught(
      loadHelpArticlePage({
        context: { queryClient },
        params: { handle: 'upvote-rules' },
        location: NO_SEARCH,
      }),
    );

    expect(error).toBe(failure);
  });
});
