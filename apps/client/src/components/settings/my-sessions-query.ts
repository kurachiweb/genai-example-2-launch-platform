import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { executeGraphQL } from '../../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../../lib/utilities/graphql/persisted-document.ts';
import { ClientMySessionsDocument } from '../../graphql/generated/graphql.ts';

// 同じタブでログインし直した別の利用者に前の利用者の取得結果を見せないよう、共通の取得の補助のキーの後に利用者のIDを加える
export const mySessionsQueryOptions = (viewerId: string) =>
  queryOptions({
    queryKey: [...graphqlQueryKey(ClientMySessionsDocument, {}), viewerId],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientMySessionsDocument, {}, { signal }),
      ),
  });

// 利用者を問わず、ログイン中の端末のすべての取得結果に当たるキーの接頭辞
export const MY_SESSIONS_QUERY_PREFIX = Object.freeze([
  documentIdOf(ClientMySessionsDocument),
] as const);

// セッションの一覧と多要素認証の状態が無ければページを表示できないため、取得の失敗はエラーの画面にする。キャッシュにあれば取得し直さない(導入済みのTanStack Queryで非推奨のensureQueryDataと同じ振る舞い)
export async function loadMySessions({
  context,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: { readonly id: string };
  };
}): Promise<void> {
  await context.queryClient.query({
    ...mySessionsQueryOptions(context.viewer.id),
    staleTime: 'static',
  });
}
