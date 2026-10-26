import { describe, expect, test } from 'vitest';

import {
  ADMIN_OPERATION,
  CLIENT_OPERATION,
} from '../../../test/fixtures/graphql/allowlist-operations.ts';
import {
  bodyOf,
  callInternal,
  callPublic,
  CLIENT_IP_CATEGORY,
  CONNECTING_IP,
  DEPLOYED_ENVIRONMENTS,
  errorCodesOf,
  graphiqlPage,
  installGraphQLModuleHooks,
  logsOf,
  OPERATION_CATEGORY,
  OPERATIONS,
  paddedDocument,
  postJson,
  relayed,
  RELAYED_IP,
  resolverCalls,
  VALID_TOKEN,
  verifyCalls,
} from '../../../test/support/graphql-module-harness.ts';
import { NOT_FOUND_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import { DEFAULT_CONTENT_SECURITY_POLICY } from '../../../lib/workers/http/security-headers.ts';
import { GATEWAY_HEADERS } from '../gateway/gateway-headers.ts';
import {
  GRAPHIQL_CONTENT_SECURITY_POLICY,
  GRAPHQL_MAX_BODY_BYTES,
} from './graphql-module.ts';

installGraphQLModuleHooks();

describe('createGraphQLModule(内部経路)', () => {
  test.each([
    { caller: 'client', operation: CLIENT_OPERATION, value: 'client' },
    { caller: 'admin', operation: ADMIN_OPERATION, value: 'admin' },
  ] as const)(
    '$callerの要求は、その呼び出し元の許可リストの操作を実行する',
    async ({ caller, operation, value }) => {
      const response = await callInternal(
        caller,
        relayed(postJson({ documentId: operation.documentId })),
      );

      expect(response.status).toBe(200);
      expect(await bodyOf(response)).toStrictEqual({
        data: { [`${caller}Value`]: value },
      });
    },
  );

  test('他方の呼び出し元の許可リストにだけある操作は実行しない', async () => {
    const before = resolverCalls;

    const response = await callInternal(
      'admin',
      relayed(postJson({ documentId: CLIENT_OPERATION.documentId })),
    );

    expect(await errorCodesOf(response)).toStrictEqual([
      'persisted_operation_not_found',
    ]);
    expect(resolverCalls).toBe(before);
  });

  test('ローカル環境でも、内部経路では本文だけの操作を受け付けない', async () => {
    const response = await callInternal(
      'client',
      relayed(postJson({ query: '{ caller }' })),
    );

    expect(response.status).toBe(400);
    expect(await errorCodesOf(response)).toStrictEqual([
      'persisted_operation_required',
    ]);
  });

  test.each(DEPLOYED_ENVIRONMENTS)(
    'デプロイ先の%sでも内部経路の操作を実行する',
    async (environment) => {
      const response = await callInternal('admin', {
        ...relayed(postJson({ documentId: OPERATIONS.caller.documentId })),
        environment,
      });

      expect(response.status).toBe(200);
      expect(await bodyOf(response)).toStrictEqual({
        data: { caller: 'admin' },
      });
    },
  );

  test('呼び出し元は内部経路のヘッダーで決まり、デバッグ用の呼び出し元のヘッダーを読まない', async () => {
    const response = await callInternal(
      'client',
      relayed(
        postJson(
          { documentId: OPERATIONS.caller.documentId },
          { [GATEWAY_HEADERS.debugCaller]: 'admin' },
        ),
      ),
    );

    expect(await bodyOf(response)).toStrictEqual({
      data: { caller: 'client' },
    });
  });

  test('引き継いだ元のクライアントIPアドレスをリゾルバへ渡す', async () => {
    const response = await callInternal(
      'client',
      relayed(postJson({ documentId: OPERATIONS.clientIp.documentId })),
    );

    expect(await bodyOf(response)).toStrictEqual({
      data: { clientIp: RELAYED_IP },
    });
    expect(logsOf(CLIENT_IP_CATEGORY)).toStrictEqual([]);
  });

  test.each<{
    readonly label: string;
    readonly headers: Record<string, string>;
    readonly reason: string;
  }>([
    { label: '無い', headers: {}, reason: 'missing' },
    {
      label: '解釈できない',
      headers: { [GATEWAY_HEADERS.clientIp]: 'not-an-ip' },
      reason: 'invalid',
    },
  ])(
    '元のクライアントIPアドレスが$labelなら、警告を出して不明として扱う',
    async ({ headers, reason }) => {
      const response = await callInternal(
        'admin',
        postJson({ documentId: OPERATIONS.clientIp.documentId }, headers),
      );

      expect(await bodyOf(response)).toStrictEqual({
        data: { clientIp: null },
      });
      expect(logsOf(CLIENT_IP_CATEGORY)).toMatchObject([
        { level: 'warning', reason, caller: 'admin' },
      ]);
    },
  );
});

describe('createGraphQLModule(外部経路)', () => {
  describe.each(DEPLOYED_ENVIRONMENTS)('デプロイ先の%s', (environment) => {
    test.each([
      { label: 'POST', options: postJson({ query: '{ caller }' }) },
      {
        label: '呼び出し元を名乗るPOST',
        options: postJson(
          { documentId: OPERATIONS.caller.documentId },
          { [GATEWAY_HEADERS.caller]: 'client' },
        ),
      },
      { label: 'GraphiQLの画面のGET', options: graphiqlPage(environment) },
    ])(
      '$labelは、未登録の経路と同じ404で応答し、リゾルバを実行しない',
      async ({ options }) => {
        const before = resolverCalls;

        const response = await callPublic({ ...options, environment });

        expect(response.status).toBe(404);
        expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(resolverCalls).toBe(before);
        expect(logsOf(OPERATION_CATEGORY)).toStrictEqual([]);
      },
    );

    test('本文が上限を超えても、本文の上限より先に404で応答する', async () => {
      const response = await callPublic({
        ...postJson({}),
        body: paddedDocument(
          OPERATIONS.caller.documentId,
          GRAPHQL_MAX_BODY_BYTES + 1,
        ),
        environment,
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toStrictEqual(NOT_FOUND_RESPONSE.body);
    });
  });

  describe('ローカル環境(GraphiQLの経路)', () => {
    test('許可リストに無い操作を、デバッグ用の呼び出し元のヘッダーで指定した呼び出し元として実行する', async () => {
      const response = await callPublic(
        postJson(
          { query: '{ caller }' },
          { [GATEWAY_HEADERS.debugCaller]: 'admin' },
        ),
      );

      expect(response.status).toBe(200);
      expect(await bodyOf(response)).toStrictEqual({
        data: { caller: 'admin' },
      });
    });

    test('デバッグ用の呼び出し元のヘッダーが無ければ、利用者側として実行する', async () => {
      const response = await callPublic(postJson({ query: '{ caller }' }));

      expect(await bodyOf(response)).toStrictEqual({
        data: { caller: 'client' },
      });
    });

    test('introspectionを実行する', async () => {
      const response = await callPublic(
        postJson({ query: '{ __schema { queryType { name } } }' }),
      );

      expect(await bodyOf(response)).toStrictEqual({
        data: { __schema: { queryType: { name: 'Query' } } },
      });
    });

    test('元のクライアントIPアドレスを名乗るヘッダーを信頼せず、接続元のIPアドレスを使う', async () => {
      const response = await callPublic(
        relayed(postJson({ query: '{ clientIp }' })),
      );

      expect(await bodyOf(response)).toStrictEqual({
        data: { clientIp: CONNECTING_IP },
      });
      expect(logsOf(CLIENT_IP_CATEGORY)).toStrictEqual([]);
    });

    test('手入力のセッション識別子を、指定した呼び出し元の種類で検証する', async () => {
      const response = await callPublic(
        postJson(
          { query: '{ viewer }' },
          {
            [GATEWAY_HEADERS.debugCaller]: 'admin',
            [GATEWAY_HEADERS.sessionToken]: VALID_TOKEN,
          },
        ),
      );

      expect(await bodyOf(response)).toStrictEqual({
        data: { viewer: 'authenticated' },
      });
      expect(verifyCalls).toStrictEqual([{ subjectKind: 'admin' }]);
    });

    test('GraphiQLの画面の応答だけ、GraphiQL用のCSPで既定のCSPを置き換え、他のセキュリティヘッダーは保つ', async () => {
      const response = await callPublic(graphiqlPage());

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');
      expect(await response.text()).toContain('<html');
      expect(response.headers.get('Content-Security-Policy')).toBe(
        GRAPHIQL_CONTENT_SECURITY_POLICY,
      );
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    test('GraphiQLの経路の操作の応答には既定のCSPを付ける', async () => {
      const response = await callPublic(postJson({ query: '{ caller }' }));

      expect(response.headers.get('Content-Security-Policy')).toBe(
        DEFAULT_CONTENT_SECURITY_POLICY,
      );
    });
  });
});

describe('GRAPHIQL_CONTENT_SECURITY_POLICY', () => {
  test('GraphiQLの配信元のスクリプト・スタイルとインラインを許し、埋め込みは禁止する', () => {
    expect(GRAPHIQL_CONTENT_SECURITY_POLICY).toContain(
      "script-src 'self' 'unsafe-inline' https://unpkg.com",
    );
    expect(GRAPHIQL_CONTENT_SECURITY_POLICY).toContain(
      "style-src 'self' 'unsafe-inline' https://unpkg.com",
    );
    expect(GRAPHIQL_CONTENT_SECURITY_POLICY).toContain(
      "frame-ancestors 'none'",
    );
  });
});
