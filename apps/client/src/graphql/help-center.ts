import type { QueryClient } from '@tanstack/react-query';
import { notFound, redirect } from '@tanstack/react-router';

import { checkHandleFormat } from '../../common-lib/handles/handle-rules.ts';
import { HELP_ARTICLE_HANDLE_RULE } from '../../common-lib/help/help-input-rules.ts';
import type { HelpTopQuery } from '../../common-lib/help/help-query-rules.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  ClientHelpArticleDocument,
  type ClientHelpArticleQuery,
  ClientHelpArticleSearchDocument,
  ClientHelpCenterDocument,
  ClientPinnedHelpArticlesDocument,
} from './generated/graphql.ts';

export type HelpArticleView = Extract<
  NonNullable<ClientHelpArticleQuery['helpArticle']>,
  { readonly __typename: 'HelpArticle' }
>;

// nullは削除済みの管理者
export type HelpArticleAuthorView = HelpArticleView['author'];

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

export interface HelpArticleLoaderData {
  // 現在のハンドルの表記
  readonly handle: string;
  readonly title: string;
}

export interface HelpArticleLoaderArgs {
  readonly context: { readonly queryClient: QueryClient };
  readonly params: { readonly handle: string };
  // 経路に検索パラメーターの検証が無いため、URLのクエリを解析したままの値
  readonly location: { readonly search: Readonly<Record<string, unknown>> };
}

export const toHelpArticleView = ({
  helpArticle,
}: ClientHelpArticleQuery): HelpArticleView | undefined =>
  helpArticle?.__typename === 'HelpArticle' ? helpArticle : undefined;

// 形式に合わないハンドルは存在し得ないため照会しない。存在しない・下書きの記事は同じ404にし、旧ハンドルは現在のハンドルへ302で転送する。
// 取得の失敗はエラーの画面にするため、そのまま投げる
export async function loadHelpArticlePage({
  context: { queryClient },
  params: { handle },
  location,
}: HelpArticleLoaderArgs): Promise<HelpArticleLoaderData> {
  if (checkHandleFormat(handle, HELP_ARTICLE_HANDLE_RULE) !== 'ok') {
    throw notFound();
  }
  const { helpArticle } = await queryClient.query({
    ...helpArticleQueryOptions(handle),
    staleTime: 'static',
  });
  if (helpArticle === null) {
    throw notFound();
  }
  if (helpArticle.__typename === 'HelpArticleRedirect') {
    throw redirect({
      to: '/help/$handle',
      params: { handle: helpArticle.handle },
      search: location.search,
      statusCode: 302,
    });
  }
  return { handle: helpArticle.handle, title: helpArticle.title };
}
