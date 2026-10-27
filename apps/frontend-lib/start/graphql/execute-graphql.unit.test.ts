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
import { reportUnexpectedError } from '../observability/report-error.ts';
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

describe('executeGraphQL(想定外の失敗の送信)', () => {
  const executeInPage = async (
    respond: () => Promise<Response>,
  ): Promise<{
    readonly result: GraphQLResult<LaunchQuery> | undefined;
    readonly reported: readonly unknown[];
  }> => {
    const reported: unknown[] = [];
    let result: GraphQLResult<LaunchQuery> | undefined;
    await runInStartRequest({
      context: renderContextOf({ api: recordingApi(respond), reported }),
      render: async () => {
        result = await executeGraphQL(LAUNCH_DOCUMENT, { id: 'launch-1' });
        return htmlResponse();
      },
    });
    return { result, reported };
  };

  test('想定外の失敗の結果を送る', async () => {
    const { result, reported } = await executeInPage(() =>
      Promise.resolve(
        graphqlResponse({
          errors: [
            {
              message: 'internal',
              extensions: { code: 'internal_error' },
            },
          ],
        }),
      ),
    );

    if (result === undefined || result.ok) {
      throw new Error('失敗の結果を期待した');
    }
    expect(result.error.code).toBe('internal_error');
    expect(reported).toEqual([result.error]);
  });

  test('想定内の失敗の結果は送らない', async () => {
    const { result, reported } = await executeInPage(() =>
      Promise.resolve(
        graphqlResponse({
          errors: [{ message: 'not found', extensions: { code: 'not_found' } }],
        }),
      ),
    );

    expect(result?.ok).toBe(false);
    expect(reported).toEqual([]);
  });

  test('APIへ到達できない失敗は中継が送った元の例外の1件だけにする', async () => {
    const failure = new Error('service binding unavailable');

    const { result, reported } = await executeInPage(() =>
      Promise.reject(failure),
    );

    expect(result?.ok === false ? result.error.code : undefined).toBe(
      'upstream_unavailable',
    );
    expect(reported).toEqual([failure]);
  });

  test('送った失敗をloaderの例外として再び渡しても送らない', async () => {
    const reported: unknown[] = [];

    await runInStartRequest({
      context: renderContextOf({
        api: recordingApi(() =>
          Promise.resolve(
            graphqlResponse({
              errors: [
                { message: 'internal', extensions: { code: 'internal_error' } },
              ],
            }),
          ),
        ),
        reported,
      }),
      render: async () => {
        const result = await executeGraphQL(LAUNCH_DOCUMENT, {
          id: 'launch-1',
        });
        if (!result.ok) {
          reportUnexpectedError(result.error, 'loader');
        }
        return htmlResponse();
      },
    });

    expect(reported).toHaveLength(1);
  });
});
