import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
} from '@tanstack/react-query';

import { DATA_EXPORT_LIST_PAGE_SIZE } from '../../common-lib/data-export/data-export-rules.ts';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { graphqlMutationOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  ClientMyDataExportsDocument,
  type ClientMyDataExportsQuery,
  type ClientMyDataExportsQueryVariables,
  ClientRequestDataExportDocument,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

export type MyDataExportsData = InfiniteData<
  ClientMyDataExportsQuery,
  string | null
>;

const FIRST_PAGE_VARIABLES: ClientMyDataExportsQueryVariables = Object.freeze({
  first: DATA_EXPORT_LIST_PAGE_SIZE,
});

// 自分の要求の一覧はセッションの利用者のものであるため、共通の取得の補助のキーの後に閲覧者のIDを加える。続きのページは最後のカーソルから読む
export const myDataExportsQueryOptions = (viewerId: string) =>
  infiniteQueryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientMyDataExportsDocument, FIRST_PAGE_VARIABLES),
      viewerId,
    ],
    queryFn: async ({ pageParam, signal }) =>
      requireData(
        await executeGraphQL(
          ClientMyDataExportsDocument,
          pageParam === null
            ? FIRST_PAGE_VARIABLES
            : { ...FIRST_PAGE_VARIABLES, after: pageParam },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({
      myDataExports: { pageInfo },
    }: ClientMyDataExportsQuery): string | undefined =>
      pageInfo.hasNextPage && pageInfo.endCursor !== null
        ? pageInfo.endCursor
        : undefined,
  });

// 取得の失敗は設定のナビゲーションを残したまま区画の中で再試行できるよう、例外にせずキャッシュに残す。続きのページはここで読み足さず、画面の「さらに表示」で読む
export async function loadMyDataExports({
  context,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer;
  };
}): Promise<void> {
  await context.queryClient
    .infiniteQuery(myDataExportsQueryOptions(context.viewer.id))
    .catch(() => undefined);
}

export async function invalidateMyDataExports(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: [documentIdOf(ClientMyDataExportsDocument)],
  });
}

export const requestDataExportMutationOptions = () =>
  graphqlMutationOptions(ClientRequestDataExportDocument);
