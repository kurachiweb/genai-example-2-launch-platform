import { type QueryClient, queryOptions } from '@tanstack/react-query';

import {
  type DirectoryQuery,
  type DirectorySort,
  normalizeDirectoryQuery,
} from '../../common-lib/directory/directory-query-rules.ts';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientDirectoryCategoriesDocument,
  ClientDirectoryDocument,
  type ClientDirectoryQuery,
  type DirectoryInput,
  type DirectorySort as AppliedSort,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

const GUEST_SCOPE = 'guest';

// 同じ条件が既定の項目の有無で別のキーにならないよう、指定された項目だけを入力にする
export const directoryInputOf = ({
  q,
  category,
  from,
  to,
  sort,
  page,
}: DirectoryQuery): DirectoryInput => ({
  ...(q === undefined ? {} : { q }),
  ...(category === undefined ? {} : { category }),
  ...(from === undefined ? {} : { from }),
  ...(to === undefined ? {} : { to }),
  ...(sort === undefined ? {} : { sort }),
  ...(page === undefined ? {} : { page: String(page) }),
});

// 項目の「あなたのプロダクト」は閲覧者で変わるため、同じタブでログイン・ログアウトした後に前の閲覧者の値を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const directoryQueryOptions = (
  query: DirectoryQuery,
  viewer: ClientViewer | null,
) => {
  const variables = { input: directoryInputOf(query) };
  return queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientDirectoryDocument, variables),
      viewer === null ? GUEST_SCOPE : viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientDirectoryDocument, variables, { signal }),
      ),
  });
};

export const directoryCategoriesQueryOptions = () =>
  graphqlQueryOptions(ClientDirectoryCategoriesDocument, {});

const SORT_OF_APPLIED: Readonly<Record<AppliedSort, DirectorySort>> =
  Object.freeze({
    RELEVANCE: 'relevance',
    NEWEST: 'newest',
    OLDEST: 'oldest',
    UPVOTES: 'upvotes',
  });

// サーバーが解決した条件(存在しないカテゴリを外し、ハンドルを保存済みの表記にしたもの)を、URLの条件と同じ形にする
export const directoryQueryOfApplied = ({
  q,
  category,
  from,
  to,
  sort,
  page,
}: ClientDirectoryQuery['directory']['applied']): DirectoryQuery =>
  normalizeDirectoryQuery({
    q,
    category,
    from,
    to,
    sort: sort === null ? undefined : SORT_OF_APPLIED[sort],
    page,
  });

export interface DirectoryLoaderArgs {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer | null;
  };
  readonly deps: DirectoryQuery;
  readonly cause: 'preload' | 'enter' | 'stay';
}

// 最初の表示(サーバーでの描画を含む)は一覧とカテゴリの選択肢を待って描く。取得の失敗は検索欄と絞り込み欄を残して一覧の位置で再試行できるよう、例外にせずキャッシュに残す。
// 同じ画面の中の条件の変更で待つと、ルーターが前の条件の画面を保ったまま待ち、画面が直前の一覧を残して読み込み中を示せないため、取得を始めるだけにする
export async function loadDirectory({
  context: { queryClient, viewer },
  deps,
  cause,
}: DirectoryLoaderArgs): Promise<void> {
  const loading = Promise.all([
    queryClient
      .query({ ...directoryQueryOptions(deps, viewer), staleTime: 'static' })
      .catch(() => undefined),
    queryClient
      .query({ ...directoryCategoriesQueryOptions(), staleTime: 'static' })
      .catch(() => undefined),
  ]);
  if (cause !== 'stay') {
    await loading;
  }
}
