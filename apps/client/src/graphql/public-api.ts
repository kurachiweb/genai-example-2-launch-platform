import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
} from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { graphqlMutationOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import type {
  ApiKeyReadLevel,
  ApiKeyScopes,
  ApiKeyWriteLevel,
} from '../../common-lib/public-api/api-key-rules.ts';
import {
  type ApiKeyReadLevel as GraphQLApiKeyReadLevel,
  type ApiKeyScopesInput,
  type ApiKeyWriteLevel as GraphQLApiKeyWriteLevel,
  ClientDeleteApiKeyDocument,
  ClientIssueApiKeyDocument,
  ClientMyApiKeysDocument,
  type ClientMyApiKeysQuery,
  type ClientMyApiKeysQueryVariables,
  ClientReissueApiKeyDocument,
  ClientUpdateApiKeyDocument,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

const READ_LEVEL_OF: Readonly<Record<GraphQLApiKeyReadLevel, ApiKeyReadLevel>> =
  Object.freeze({ NONE: 'none', READ: 'read' });

const WRITE_LEVEL_OF: Readonly<
  Record<GraphQLApiKeyWriteLevel, ApiKeyWriteLevel>
> = Object.freeze({ NONE: 'none', READ: 'read', READ_WRITE: 'read_write' });

const GRAPHQL_READ_LEVEL_OF: Readonly<
  Record<ApiKeyReadLevel, GraphQLApiKeyReadLevel>
> = Object.freeze({ none: 'NONE', read: 'READ' });

const GRAPHQL_WRITE_LEVEL_OF: Readonly<
  Record<ApiKeyWriteLevel, GraphQLApiKeyWriteLevel>
> = Object.freeze({ none: 'NONE', read: 'READ', read_write: 'READ_WRITE' });

// GraphQLの列挙は大文字のため、表示名と検証規則を引く共用部品の値と相互に写す。応答のscopesも入力と同じ形のためこの型で受け取る
export const toApiKeyScopes = (scopes: ApiKeyScopesInput): ApiKeyScopes => ({
  products: READ_LEVEL_OF[scopes.products],
  launches: READ_LEVEL_OF[scopes.launches],
  upvotes: READ_LEVEL_OF[scopes.upvotes],
  comments: READ_LEVEL_OF[scopes.comments],
  ratings: READ_LEVEL_OF[scopes.ratings],
  profile: WRITE_LEVEL_OF[scopes.profile],
  productDescriptions: WRITE_LEVEL_OF[scopes.productDescriptions],
});

export const toApiKeyScopesInput = (
  scopes: ApiKeyScopes,
): ApiKeyScopesInput => ({
  products: GRAPHQL_READ_LEVEL_OF[scopes.products],
  launches: GRAPHQL_READ_LEVEL_OF[scopes.launches],
  upvotes: GRAPHQL_READ_LEVEL_OF[scopes.upvotes],
  comments: GRAPHQL_READ_LEVEL_OF[scopes.comments],
  ratings: GRAPHQL_READ_LEVEL_OF[scopes.ratings],
  profile: GRAPHQL_WRITE_LEVEL_OF[scopes.profile],
  productDescriptions: GRAPHQL_WRITE_LEVEL_OF[scopes.productDescriptions],
});

export const MY_API_KEYS_PAGE_SIZE = 50;

export type MyApiKeysData = InfiniteData<ClientMyApiKeysQuery, string | null>;

// 一覧の件数の引数は省略できないため、最初のページも件数を明示する
const FIRST_PAGE_VARIABLES: ClientMyApiKeysQueryVariables = Object.freeze({
  first: MY_API_KEYS_PAGE_SIZE,
});

// 自分のAPIキーの一覧はセッションの利用者のものであるため、共通の取得の補助のキーの後に閲覧者のIDを加える。続きのページは最後のキーのカーソルから読む
export const myApiKeysQueryOptions = (viewerId: string) =>
  infiniteQueryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientMyApiKeysDocument, FIRST_PAGE_VARIABLES),
      viewerId,
    ],
    queryFn: async ({ pageParam, signal }) =>
      requireData(
        await executeGraphQL(
          ClientMyApiKeysDocument,
          pageParam === null
            ? FIRST_PAGE_VARIABLES
            : { ...FIRST_PAGE_VARIABLES, after: pageParam },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({
      myApiKeys: { pageInfo },
    }: ClientMyApiKeysQuery): string | undefined =>
      pageInfo.hasNextPage && pageInfo.endCursor !== null
        ? pageInfo.endCursor
        : undefined,
  });

// 取得の失敗は設定のナビゲーションを残したまま一覧の中で再試行できるよう、例外にせずキャッシュに残す。続きのページはここで読み足さず、画面の「さらに表示」で読む
export async function loadMyApiKeys({
  context,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer;
  };
}): Promise<void> {
  await context.queryClient
    .infiniteQuery(myApiKeysQueryOptions(context.viewer.id))
    .catch(() => undefined);
}

export async function invalidateMyApiKeys(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: [documentIdOf(ClientMyApiKeysDocument)],
  });
}

// 平文は応答でだけ受け取り再び表示しないため、画面が結果を捨てたら変更の記録を既定の5分を待たずに消す
const PLAIN_KEY_RESULT_GC_TIME_MS = 0;

export const issueApiKeyMutationOptions = () => ({
  ...graphqlMutationOptions(ClientIssueApiKeyDocument),
  gcTime: PLAIN_KEY_RESULT_GC_TIME_MS,
});

export const reissueApiKeyMutationOptions = () => ({
  ...graphqlMutationOptions(ClientReissueApiKeyDocument),
  gcTime: PLAIN_KEY_RESULT_GC_TIME_MS,
});

export const updateApiKeyMutationOptions = () =>
  graphqlMutationOptions(ClientUpdateApiKeyDocument);

export const deleteApiKeyMutationOptions = () =>
  graphqlMutationOptions(ClientDeleteApiKeyDocument);
