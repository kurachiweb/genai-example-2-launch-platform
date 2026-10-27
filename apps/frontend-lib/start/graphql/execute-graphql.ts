import { createIsomorphicFn } from '@tanstack/react-start';

import type { GraphQLResult } from '../../utilities/graphql/graphql-result.ts';
import type { PersistedDocument } from '../../utilities/graphql/persisted-document.ts';
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

export function executeGraphQL<TResult, TVariables>(
  document: PersistedDocument<TResult, TVariables>,
  variables: TVariables,
  options?: ExecuteOptions,
): Promise<GraphQLResult<TResult>> {
  // 同型の関数は型引数を持てないため、型を外した形で分岐し、結果の型は文書の型に戻す
  return executeIsomorphic(document, variables, options) as Promise<
    GraphQLResult<TResult>
  >;
}
