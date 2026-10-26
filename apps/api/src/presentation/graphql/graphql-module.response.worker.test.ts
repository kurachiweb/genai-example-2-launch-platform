import { describe, expect, test } from 'vitest';

import {
  bodyOf,
  callInternal,
  callPublic,
  documentIdOf,
  installGraphQLModuleHooks,
  INVALID_TOKEN,
  logsOf,
  OPERATION_CATEGORY,
  OPERATIONS,
  paddedDocument,
  postJson,
  relayed,
  RENEWED_MAX_AGE_SECONDS,
  RENEWED_TOKEN,
  resolverCalls,
  streamOf,
  VALID_TOKEN,
  verifyCalls,
} from '../../../test/support/graphql-module-harness.ts';
import { DEFAULT_CONTENT_SECURITY_POLICY } from '../../../lib/workers/http/security-headers.ts';
import {
  GATEWAY_HEADERS,
  SESSION_RESPONSE_HEADERS,
} from '../gateway/gateway-headers.ts';
import { GRAPHQL_MAX_BODY_BYTES } from './graphql-module.ts';

installGraphQLModuleHooks();

describe('createGraphQLModule(本文の上限)', () => {
  test('本文がちょうど上限の大きさなら実行する', async () => {
    const response = await callInternal(
      'client',
      relayed({
        ...postJson({}),
        body: paddedDocument(
          OPERATIONS.caller.documentId,
          GRAPHQL_MAX_BODY_BYTES,
        ),
      }),
    );

    expect(response.status).toBe(200);
    expect(await bodyOf(response)).toStrictEqual({
      data: { caller: 'client' },
    });
  });

  test.each([
    {
      label: '本文の長さのヘッダーがある',
      body: () =>
        paddedDocument(
          OPERATIONS.caller.documentId,
          GRAPHQL_MAX_BODY_BYTES + 1,
        ),
    },
    {
      label: '本文の長さのヘッダーが無いストリームの',
      body: () => streamOf(GRAPHQL_MAX_BODY_BYTES + 1),
    },
  ])(
    '$label本文が上限を超えたら、413と共通のエラー形式で応答し、操作を実行しない',
    async ({ body }) => {
      const before = resolverCalls;

      const response = await callInternal(
        'client',
        relayed({ ...postJson({}), body: body() }),
      );

      expect(response.status).toBe(413);
      expect(await response.json()).toStrictEqual({
        error: {
          code: 'payload_too_large',
          message: expect.any(String) as string,
        },
      });
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(resolverCalls).toBe(before);
      expect(logsOf(OPERATION_CATEGORY)).toMatchObject([
        { caller: 'client', outcome: 'error', status: 413, errorCodes: [] },
      ]);
    },
  );
});

describe('createGraphQLModule(応答の後処理)', () => {
  test.each([
    {
      label: '成功',
      options: relayed(postJson({ documentId: OPERATIONS.caller.documentId })),
    },
    {
      label: '実行前の拒否',
      options: relayed(postJson({ documentId: documentIdOf('9') })),
    },
  ])('$labelの応答のキャッシュを禁止する', async ({ options }) => {
    const response = await callInternal('client', options);

    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  test('セッションの更新の指示を、応答のヘッダーへ反映する', async () => {
    const response = await callInternal(
      'client',
      relayed(
        postJson(
          { documentId: OPERATIONS.viewer.documentId },
          { [GATEWAY_HEADERS.sessionToken]: VALID_TOKEN },
        ),
      ),
    );

    expect(await bodyOf(response)).toStrictEqual({
      data: { viewer: 'authenticated' },
    });
    expect(verifyCalls).toStrictEqual([{ subjectKind: 'user' }]);
    expect(response.headers.get(SESSION_RESPONSE_HEADERS.issue)).toBe(
      RENEWED_TOKEN,
    );
    expect(response.headers.get(SESSION_RESPONSE_HEADERS.maxAge)).toBe(
      String(RENEWED_MAX_AGE_SECONDS),
    );
    expect(response.headers.has(SESSION_RESPONSE_HEADERS.clear)).toBe(false);
  });

  test('無効なセッションの削除の指示を、応答のヘッダーへ反映する', async () => {
    const response = await callInternal(
      'admin',
      relayed(
        postJson(
          { documentId: OPERATIONS.viewer.documentId },
          { [GATEWAY_HEADERS.sessionToken]: INVALID_TOKEN },
        ),
      ),
    );

    expect(await bodyOf(response)).toStrictEqual({
      data: { viewer: 'anonymous' },
    });
    expect(response.headers.get(SESSION_RESPONSE_HEADERS.clear)).toBe('1');
    expect(response.headers.has(SESSION_RESPONSE_HEADERS.issue)).toBe(false);
  });

  test('セッションの指示が無ければ、指示のヘッダーを付けない', async () => {
    const response = await callInternal(
      'client',
      relayed(postJson({ documentId: OPERATIONS.viewer.documentId })),
    );

    expect(await bodyOf(response)).toStrictEqual({
      data: { viewer: 'anonymous' },
    });
    for (const name of Object.values(SESSION_RESPONSE_HEADERS)) {
      expect(response.headers.has(name)).toBe(false);
    }
  });

  test('操作ログに操作名・種類・呼び出し元・結果・状態コード・処理時間を出し、セッション識別子を含めない', async () => {
    await callInternal(
      'admin',
      relayed(
        postJson(
          { documentId: OPERATIONS.viewer.documentId },
          { [GATEWAY_HEADERS.sessionToken]: VALID_TOKEN },
        ),
      ),
    );

    const operationLogs = logsOf(OPERATION_CATEGORY);
    expect(operationLogs).toStrictEqual([
      expect.objectContaining({
        level: 'info',
        operationName: 'Viewer',
        operationType: 'query',
        caller: 'admin',
        outcome: 'ok',
        errorCodes: [],
        status: 200,
        durationMs: expect.any(Number) as number,
      }),
    ]);
    expect(JSON.stringify(operationLogs)).not.toContain(VALID_TOKEN);
    expect(JSON.stringify(operationLogs)).not.toContain(RENEWED_TOKEN);
  });

  test('実行前に拒否した操作は、エラーコードとともに結果をerrorとして記録する', async () => {
    await callInternal(
      'client',
      relayed(postJson({ documentId: documentIdOf('9') })),
    );

    expect(logsOf(OPERATION_CATEGORY)).toMatchObject([
      {
        level: 'warning',
        caller: 'client',
        outcome: 'error',
        errorCodes: ['persisted_operation_not_found'],
        status: 400,
      },
    ]);
  });

  test('GraphiQLの経路の操作も、デバッグ用の呼び出し元で記録する', async () => {
    await callPublic(
      postJson(
        { query: 'query Caller { caller }' },
        { [GATEWAY_HEADERS.debugCaller]: 'admin' },
      ),
    );

    expect(logsOf(OPERATION_CATEGORY)).toMatchObject([
      { operationName: 'Caller', caller: 'admin', outcome: 'ok', status: 200 },
    ]);
  });
});

describe('createGraphQLModule(イベントストリームの応答)', () => {
  // Yogaはイベントストリームの応答にCache-Control: no-cacheを付けるため、後処理の値が残ることを確かめる
  test.each([
    {
      label: '内部経路',
      call: () =>
        callInternal(
          'client',
          relayed(
            postJson(
              { documentId: OPERATIONS.viewer.documentId },
              {
                accept: 'text/event-stream',
                [GATEWAY_HEADERS.sessionToken]: VALID_TOKEN,
              },
            ),
          ),
        ),
    },
    {
      label: 'ローカルのGraphiQLの経路',
      call: () =>
        callPublic(
          postJson(
            { query: 'query Viewer { viewer }' },
            {
              accept: 'text/event-stream',
              [GATEWAY_HEADERS.sessionToken]: VALID_TOKEN,
            },
          ),
        ),
    },
  ])(
    '$labelでも、キャッシュを禁止しセッションの指示を反映し、既定のCSPを付ける',
    async ({ call }) => {
      const response = await call();

      expect(response.headers.get('content-type')).toContain(
        'text/event-stream',
      );
      expect(await response.text()).toContain('"viewer":"authenticated"');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get(SESSION_RESPONSE_HEADERS.issue)).toBe(
        RENEWED_TOKEN,
      );
      expect(response.headers.get('Content-Security-Policy')).toBe(
        DEFAULT_CONTENT_SECURITY_POLICY,
      );
    },
  );
});
