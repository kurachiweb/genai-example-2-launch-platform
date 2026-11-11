import type { QueryClient } from '@tanstack/react-query';

import type { HelpTopQuery } from '../../common-lib/help/help-query-rules.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  ClientHelpArticleDocument,
  ClientHelpArticleSearchDocument,
  ClientHelpCenterDocument,
  ClientPinnedHelpArticlesDocument,
} from './generated/graphql.ts';

export const helpCenterQueryOptions = () =>
  graphqlQueryOptions(ClientHelpCenterDocument, {});

export const helpArticleQueryOptions = (handle: string) =>
  graphqlQueryOptions(ClientHelpArticleDocument, { handle });

export const helpArticleSearchQueryOptions = (query: string) =>
  graphqlQueryOptions(ClientHelpArticleSearchDocument, { query });

export const pinnedHelpArticlesQueryOptions = () =>
  graphqlQueryOptions(ClientPinnedHelpArticlesDocument, {});

export interface HelpTopLoaderArgs {
  readonly context: { readonly queryClient: QueryClient };
  readonly deps: HelpTopQuery;
  readonly cause: 'preload' | 'enter' | 'stay';
}

// 検索語の有無でカテゴリ別の一覧か検索結果の一方を取得する。
// 最初の表示(サーバーでの描画を含む)は取得を待ち、失敗はルートのエラーの表示で再試行させるため例外のまま投げる。
// 同じページの中の検索で待つと、ルーターが読み込み中・失敗の画面へ切り替えて検索欄を作り直しフォーカスを失うため、取得を始めるだけにし、失敗は画面が一覧の位置に示す
export async function loadHelpTopPage({
  context: { queryClient },
  deps: { q },
  cause,
}: HelpTopLoaderArgs): Promise<void> {
  const loading =
    q === undefined
      ? queryClient.query({ ...helpCenterQueryOptions(), staleTime: 'static' })
      : queryClient.query({
          ...helpArticleSearchQueryOptions(q),
          staleTime: 'static',
        });
  if (cause === 'stay') {
    void loading.catch(() => undefined);
    return;
  }
  await loading;
}
