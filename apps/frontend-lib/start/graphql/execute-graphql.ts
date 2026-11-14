import { createIsomorphicFn } from '@tanstack/react-start';

import type { GraphQLResult } from '../../utilities/graphql/graphql-result.ts';
import type { PersistedDocument } from '../../utilities/graphql/persisted-document.ts';
import { reportUnexpectedError } from '../observability/report-error.ts';
import {
  type AnyPersistedDocument,
  type ExecuteOptions,
  executeGraphQLWithGlobalFetch,
} from './browser-transport.ts';
import { executeGraphQLOnServer } from './execute-graphql.server.ts';

export type { ExecuteOptions };

// サーバーの分岐は、ブラウザ向けのビルドで分岐ごと消えてサーバー専用のファイルのimportも消えるよう、その場の関数で書く
const executeIsomorphic = createIsomorphicFn()
  .server(
    (
      document: AnyPersistedDocument<unknown>,
      variables: unknown,
      options: ExecuteOptions | undefined,
    ): Promise<GraphQLResult<unknown>> =>
      executeGraphQLOnServer(document, variables, options),
  )
  .client(executeGraphQLWithGlobalFetch);

// 区画の中で表示する失敗はloaderや描画の例外として届かないため、想定外の失敗はここで送る。loaderが同じ失敗を再び投げても送信の側で2回目を除く
export async function executeGraphQL<TResult, TVariables>(
  document: PersistedDocument<TResult, TVariables>,
  variables: TVariables,
  options?: ExecuteOptions,
): Promise<GraphQLResult<TResult>> {
  // 同型の関数は型引数を持てないため、型を外した形で分岐し、結果の型は文書の型に戻す
  const result = (await executeIsomorphic(
    document,
    variables,
    options,
  )) as GraphQLResult<TResult>;
  if (!result.ok) {
    reportUnexpectedError(result.error, 'graphql');
  }
  return result;
}
