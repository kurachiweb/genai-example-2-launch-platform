import { createSchema, createYoga, type Plugin } from 'graphql-yoga';
import { describe, expect, test } from 'vitest';

import {
  ADMIN_OPERATION,
  ALLOWLIST_TYPE_DEFS,
  CLIENT_OPERATION,
  UNREGISTERED_DOCUMENT_ID,
} from '../../../test/fixtures/graphql/allowlist-operations.ts';
import allowlistFixture from '../../../test/fixtures/graphql/allowlist.json';
import { GATEWAY_HEADERS } from '../gateway/gateway-headers.ts';
import { readInternalCaller } from '../gateway/internal-request.ts';
import type { GatewayErrorCode } from './error-codes.ts';
import {
  createOperationAllowlist,
  createPersistedOperationsPlugin,
} from './operation-allowlist.ts';

interface OperationResponse {
  readonly status: number;
  readonly body: {
    readonly data?: Record<string, unknown> | null;
    readonly errors?: readonly {
      readonly message: string;
      readonly extensions?: { readonly code?: string };
    }[];
  };
  readonly resolverCalls: number;
}

const allowGraphiqlOnly = (request: Request) =>
  readInternalCaller(request) === undefined;

interface RunOptions {
  readonly allowArbitrary?: (request: Request) => boolean;
  readonly plugins?: readonly Plugin[];
}

async function runOperation(
  payload: Record<string, unknown>,
  headers: Record<string, string>,
  options: RunOptions = {},
): Promise<OperationResponse> {
  let resolverCalls = 0;
  const resolve = (value: string) => () => {
    resolverCalls += 1;
    return value;
  };
  const yoga = createYoga({
    schema: createSchema({
      typeDefs: ALLOWLIST_TYPE_DEFS,
      resolvers: {
        Query: {
          clientValue: resolve('client'),
          adminValue: resolve('admin'),
        },
      },
    }),
    plugins: [
      createPersistedOperationsPlugin(
        createOperationAllowlist(allowlistFixture),
        { allowArbitrary: options.allowArbitrary ?? allowGraphiqlOnly },
      ),
      ...(options.plugins ?? []),
    ],
    extraParamNames: ['documentId'],
    logging: false,
  });
  const response = await yoga.fetch('http://localhost/graphql', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: await response.json(),
    resolverCalls,
  };
}

const CLIENT_HEADERS = { [GATEWAY_HEADERS.caller]: 'client' };
const ADMIN_HEADERS = { [GATEWAY_HEADERS.caller]: 'admin' };

function expectRejected(
  result: OperationResponse,
  code: GatewayErrorCode,
): void {
  expect(result.status).toBe(400);
  expect(result.body.errors?.map((error) => error.extensions?.code)).toEqual([
    code,
  ]);
  expect(result.body.data).toBeUndefined();
  expect(result.resolverCalls).toBe(0);
}

function withProperty(
  base: Record<string, unknown>,
  key: string,
  value: unknown,
): Record<string, unknown> {
  return { ...base, [key]: value };
}

describe('許可リストの形の検証', () => {
  const validOperations = allowlistFixture.operations;

  test.each([
    ['オブジェクトでない', 'allowlist'],
    ['versionが1でない', { version: 2, operations: validOperations }],
    ['operationsが無い', { version: 1 }],
    [
      '呼び出し元の一覧が欠けている',
      { version: 1, operations: { client: validOperations.client } },
    ],
    [
      '未知の呼び出し元を持つ',
      {
        version: 1,
        operations: withProperty(validOperations, 'public', {}),
      },
    ],
    [
      '未知の項目を持つ',
      withProperty(allowlistFixture, 'generatedAt', '2026-10-26'),
    ],
    [
      '識別子にsha256:の接頭辞が無い',
      {
        version: 1,
        operations: { admin: {}, client: { ['a'.repeat(64)]: 'query { a }' } },
      },
    ],
    [
      '識別子の16進が63桁',
      {
        version: 1,
        operations: {
          admin: {},
          client: { [`sha256:${'a'.repeat(63)}`]: 'query { a }' },
        },
      },
    ],
    [
      '識別子の16進が大文字',
      {
        version: 1,
        operations: {
          admin: {},
          client: { [`sha256:${'A'.repeat(64)}`]: 'query { a }' },
        },
      },
    ],
    [
      '本文が文字列でない',
      {
        version: 1,
        operations: { admin: {}, client: { [UNREGISTERED_DOCUMENT_ID]: 1 } },
      },
    ],
    [
      '本文が空',
      {
        version: 1,
        operations: { admin: {}, client: { [UNREGISTERED_DOCUMENT_ID]: '' } },
      },
    ],
  ])('不正な許可リスト(%s)は照会で例外になる', (_label, data) => {
    const allowlist = createOperationAllowlist(data);

    expect(() =>
      allowlist.find('client', CLIENT_OPERATION.documentId),
    ).toThrow();
  });

  test('空の一覧だけの許可リストは受け付け、どの識別子も未登録になる', () => {
    const allowlist = createOperationAllowlist({
      version: 1,
      operations: { admin: {}, client: {} },
    });

    expect(
      allowlist.find('client', CLIENT_OPERATION.documentId),
    ).toBeUndefined();
    expect(allowlist.find('admin', ADMIN_OPERATION.documentId)).toBeUndefined();
  });
});

describe('許可リストの照会', () => {
  const allowlist = createOperationAllowlist(allowlistFixture);

  test('呼び出し元の一覧にある識別子は本文を返す', () => {
    expect(allowlist.find('client', CLIENT_OPERATION.documentId)).toBe(
      CLIENT_OPERATION.body,
    );
    expect(allowlist.find('admin', ADMIN_OPERATION.documentId)).toBe(
      ADMIN_OPERATION.body,
    );
  });

  test('他方の呼び出し元の一覧にだけある識別子は未登録になる', () => {
    expect(
      allowlist.find('client', ADMIN_OPERATION.documentId),
    ).toBeUndefined();
    expect(
      allowlist.find('admin', CLIENT_OPERATION.documentId),
    ).toBeUndefined();
  });

  test.each([
    ['未登録の識別子', UNREGISTERED_DOCUMENT_ID],
    ['接頭辞の無い識別子', CLIENT_OPERATION.documentId.slice('sha256:'.length)],
    ['Objectの組み込みの名前', 'constructor'],
    ['__proto__', '__proto__'],
  ])('%sは未登録になる', (_label, documentId) => {
    expect(allowlist.find('client', documentId)).toBeUndefined();
  });

  test('検証は作成時ではなく最初の照会で1回だけ行われる', () => {
    let versionReads = 0;
    const data = {
      get version() {
        versionReads += 1;
        return allowlistFixture.version;
      },
      operations: allowlistFixture.operations,
    };

    const counted = createOperationAllowlist(data);
    expect(versionReads).toBe(0);

    counted.find('client', CLIENT_OPERATION.documentId);
    expect(versionReads).toBe(1);

    counted.find('admin', ADMIN_OPERATION.documentId);
    counted.find('client', UNREGISTERED_DOCUMENT_ID);
    expect(versionReads).toBe(1);
  });
});

describe('persisted operationsのプラグイン', () => {
  test('内部経路の呼び出し元の一覧にあるdocumentIdの操作を実行する', async () => {
    const result = await runOperation(
      { documentId: CLIENT_OPERATION.documentId },
      CLIENT_HEADERS,
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { clientValue: 'client' } });
    expect(result.resolverCalls).toBe(1);
  });

  test('管理者側の呼び出し元は管理者側の一覧の操作を実行する', async () => {
    const result = await runOperation(
      { documentId: ADMIN_OPERATION.documentId, operationName: 'AdminValue' },
      ADMIN_HEADERS,
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: { adminValue: 'admin' } });
  });

  test.each([
    ['利用者側から管理者側の操作', ADMIN_OPERATION.documentId, CLIENT_HEADERS],
    ['管理者側から利用者側の操作', CLIENT_OPERATION.documentId, ADMIN_HEADERS],
  ])(
    '%sはpersisted_operation_not_foundと400で拒否する',
    async (_label, documentId, headers) => {
      const result = await runOperation({ documentId }, headers);

      expectRejected(result, 'persisted_operation_not_found');
    },
  );

  test('未登録のdocumentIdはpersisted_operation_not_foundと400で拒否する', async () => {
    const result = await runOperation(
      { documentId: UNREGISTERED_DOCUMENT_ID },
      CLIENT_HEADERS,
    );

    expectRejected(result, 'persisted_operation_not_found');
  });

  test.each([
    ['documentIdも本文も無い', {}],
    ['documentIdが文字列でない', { documentId: 1 }],
    [
      'APQ形式の識別子だけを持つ',
      {
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: CLIENT_OPERATION.documentId.slice('sha256:'.length),
          },
        },
      },
    ],
  ])(
    '%s要求はpersisted_operation_not_foundと400で拒否する',
    async (_label, payload) => {
      const result = await runOperation(payload, CLIENT_HEADERS);

      expectRejected(result, 'persisted_operation_not_found');
    },
  );

  test.each([
    ['本文だけの要求', { query: CLIENT_OPERATION.body }],
    [
      '本文とdocumentIdを持つ要求',
      { query: CLIENT_OPERATION.body, documentId: CLIENT_OPERATION.documentId },
    ],
  ])(
    '内部経路の%sはpersisted_operation_requiredと400で拒否する',
    async (_label, payload) => {
      const result = await runOperation(payload, CLIENT_HEADERS);

      expectRejected(result, 'persisted_operation_required');
    },
  );

  test('任意の操作を許す判定が真の要求は本文の操作を実行する', async () => {
    const result = await runOperation(
      { query: '{ adminValue clientValue }' },
      {},
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      data: { adminValue: 'admin', clientValue: 'client' },
    });
  });

  test('任意の操作を許す判定が真の要求のdocumentIdは既定で利用者側の一覧から照会する', async () => {
    const registered = await runOperation(
      { documentId: CLIENT_OPERATION.documentId },
      {},
    );
    const otherCaller = await runOperation(
      { documentId: ADMIN_OPERATION.documentId },
      {},
    );

    expect(registered.body).toEqual({ data: { clientValue: 'client' } });
    expectRejected(otherCaller, 'persisted_operation_not_found');
  });

  test('任意の操作を許す判定が真の要求のdocumentIdはデバッグ用の呼び出し元の一覧から照会する', async () => {
    const debugAdmin = { [GATEWAY_HEADERS.debugCaller]: 'admin' };

    const registered = await runOperation(
      { documentId: ADMIN_OPERATION.documentId },
      debugAdmin,
    );
    const otherCaller = await runOperation(
      { documentId: CLIENT_OPERATION.documentId },
      debugAdmin,
    );

    expect(registered.body).toEqual({ data: { adminValue: 'admin' } });
    expectRejected(otherCaller, 'persisted_operation_not_found');
  });

  test('内部経路ではデバッグ用の呼び出し元のヘッダーを無視する', async () => {
    const result = await runOperation(
      { documentId: ADMIN_OPERATION.documentId },
      { ...CLIENT_HEADERS, [GATEWAY_HEADERS.debugCaller]: 'admin' },
    );

    expectRejected(result, 'persisted_operation_not_found');
  });

  test('未知のデバッグ用の呼び出し元は利用者側の一覧から照会する', async () => {
    const result = await runOperation(
      { documentId: CLIENT_OPERATION.documentId },
      { [GATEWAY_HEADERS.debugCaller]: 'public' },
    );

    expect(result.body).toEqual({ data: { clientValue: 'client' } });
  });

  test.each([
    [
      'デバッグ用の呼び出し元を指定した',
      { [GATEWAY_HEADERS.debugCaller]: 'admin' },
      ADMIN_OPERATION.documentId,
    ],
    ['呼び出し元を持たない', {}, CLIENT_OPERATION.documentId],
  ])(
    '任意の操作を許さない場合、内部経路でない%s要求はどの一覧も照会せずに拒否する',
    async (_label, headers, documentId) => {
      const result = await runOperation({ documentId }, headers, {
        allowArbitrary: () => false,
      });

      expectRejected(result, 'persisted_operation_not_found');
    },
  );
});

describe('拒否のエラーの独立性', () => {
  const tamperErrorExtensions: Plugin = {
    onResultProcess({ result }) {
      if (!('errors' in result) || result.errors === undefined) {
        return;
      }
      for (const error of result.errors) {
        const extensions = error.extensions as Record<string, unknown> & {
          http?: { status?: number };
        };
        extensions['code'] = 'tampered';
        if (extensions.http !== undefined) {
          extensions.http.status = 500;
        }
      }
    },
  };

  test.each([
    ['persisted_operation_required', { query: CLIENT_OPERATION.body }],
    ['persisted_operation_not_found', { documentId: UNREGISTERED_DOCUMENT_ID }],
  ] as const)(
    '後続のプラグインが%sのエラーを書き換えても、他の要求のエラーは変わらない',
    async (code, payload) => {
      await runOperation(payload, CLIENT_HEADERS, {
        plugins: [tamperErrorExtensions],
      });

      const result = await runOperation(payload, CLIENT_HEADERS);

      expectRejected(result, code);
    },
  );
});
