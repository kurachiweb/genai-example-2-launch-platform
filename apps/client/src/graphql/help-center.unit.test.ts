import { describe, expect, mock, test } from 'bun:test';
import type { QueryClient } from '@tanstack/react-query';

import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientHelpArticleDocument,
  ClientHelpArticleSearchDocument,
  ClientHelpCenterDocument,
  ClientPinnedHelpArticlesDocument,
} from './generated/graphql.ts';
import {
  helpArticleQueryOptions,
  helpArticleSearchQueryOptions,
  helpCenterQueryOptions,
  loadHelpTopPage,
  pinnedHelpArticlesQueryOptions,
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
