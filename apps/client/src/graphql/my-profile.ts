import { type QueryClient, queryOptions } from '@tanstack/react-query';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';
import { ClientMyProfileDocument } from './generated/graphql.ts';

// 同じタブでログインし直した別の利用者に前の利用者の取得結果を見せないよう、共通の取得の補助のキーの後に利用者のIDを加える
export const myProfileQueryOptions = (viewerId: string) =>
  queryOptions({
    queryKey: [...graphqlQueryKey(ClientMyProfileDocument, {}), viewerId],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(ClientMyProfileDocument, {}, { signal }),
      ),
  });

// 編集の画面を開くたびに最新の値を読み、保存の時に送る読み込んだ時点のハンドルを実際の値と合わせる。取得の失敗は設定のナビゲーションを残したままページの中で再試行できるよう、例外にせずキャッシュに残す
export async function loadMyProfile({
  context,
}: {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: { readonly id: string };
  };
}): Promise<void> {
  await context.queryClient
    .query({ ...myProfileQueryOptions(context.viewer.id), staleTime: 0 })
    .catch(() => undefined);
}
