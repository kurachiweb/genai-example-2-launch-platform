import { describe, expect, test } from 'bun:test';

import {
  graphqlResponse,
  htmlResponse,
  recordingApi,
  renderContextOf,
  runInStartRequest,
  TEST_DOCUMENT_ID,
} from '../../test/start-request-fixtures.ts';
import type { GraphQLResult } from '../../utilities/graphql/graphql-result.ts';
import type { PersistedDocument } from '../../utilities/graphql/persisted-document.ts';
import { executeGraphQL } from './execute-graphql.ts';

interface LaunchQuery {
  readonly launch: { readonly id: string } | null;
}

const LAUNCH_DOCUMENT = {
  __meta__: { hash: TEST_DOCUMENT_ID },
} as unknown as PersistedDocument<LaunchQuery, { readonly id: string }>;

// TanStackのViteプラグインが無いBunでは、同型の関数はサーバーの分岐を実行する
describe('executeGraphQL(サーバーの分岐)', () => {
  test('描画の文脈のAPIへ識別子・変数・トークンを渡し、応答を解析した結果を返す', async () => {
    const api = recordingApi(() =>
      Promise.resolve(graphqlResponse({ data: { launch: null } })),
    );
    let result: GraphQLResult<LaunchQuery> | undefined;

    await runInStartRequest({
      context: renderContextOf({ api }),
      render: async () => {
        result = await executeGraphQL(
          LAUNCH_DOCUMENT,
          { id: 'launch-1' },
          { turnstileToken: 'turnstile-token' },
        );
        return htmlResponse();
      },
    });

    expect(result).toEqual({ ok: true, data: { launch: null } });
    const [upstream] = api.requests;
    expect(upstream?.headers.get('cf-turnstile-response')).toBe(
      'turnstile-token',
    );
    expect(await upstream?.json()).toEqual({
      documentId: TEST_DOCUMENT_ID,
      variables: { id: 'launch-1' },
    });
  });
});
