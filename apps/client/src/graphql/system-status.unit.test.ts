import { describe, expect, test } from 'bun:test';

import {
  GraphQLClientError,
  type GraphQLResult,
} from '../../lib/utilities/graphql/graphql-result.ts';
import type { ClientSystemStatusQuery } from './generated/graphql.ts';
import {
  fromSystemStatusLoaderData,
  toSystemStatusLoaderData,
  toSystemStatusResult,
} from './system-status.ts';

const SNAPSHOT = {
  serverTime: '2026-01-15T07:40:00.000Z',
  databaseReachable: true,
} as const;

const UPSTREAM_UNAVAILABLE = new GraphQLClientError({
  code: 'upstream_unavailable',
  message: '現在ご利用いただけません。時間をおいて再度お試しください。',
  status: 503,
  retryAfterSeconds: 5,
});

describe('toSystemStatusResult', () => {
  test('成功した応答から疎通確認の結果だけを取り出す', () => {
    const result: GraphQLResult<ClientSystemStatusQuery> = {
      ok: true,
      data: { systemStatus: SNAPSHOT },
    };

    expect(toSystemStatusResult(result)).toStrictEqual({
      ok: true,
      data: SNAPSHOT,
    });
  });

  test('失敗はエラーをそのまま渡す', () => {
    const result = toSystemStatusResult({
      ok: false,
      error: UPSTREAM_UNAVAILABLE,
    });

    expect(result).toStrictEqual({ ok: false, error: UPSTREAM_UNAVAILABLE });
  });
});

describe('toSystemStatusLoaderData・fromSystemStatusLoaderData', () => {
  test.each(['server', 'browser'] as const)(
    '成功の結果は、実行した場所(%s)と組にしてそのまま往復する',
    (executedOn) => {
      const data = toSystemStatusLoaderData(
        { ok: true, data: SNAPSHOT },
        executedOn,
      );

      expect(data).toStrictEqual({
        executedOn,
        result: { ok: true, data: SNAPSHOT },
      });
      expect(fromSystemStatusLoaderData(data)).toStrictEqual({
        executedOn,
        result: { ok: true, data: SNAPSHOT },
      });
    },
  );

  test('失敗はErrorを含まない素のオブジェクトにして実行した場所と組にし、JSONを経てもエラーコードと実行した場所が残る', () => {
    const data = toSystemStatusLoaderData(
      { ok: false, error: UPSTREAM_UNAVAILABLE },
      'server',
    );

    expect(data).toStrictEqual({
      executedOn: 'server',
      result: {
        ok: false,
        error: {
          code: 'upstream_unavailable',
          message: UPSTREAM_UNAVAILABLE.message,
          status: 503,
        },
      },
    });
    expect(JSON.parse(JSON.stringify(data))).toStrictEqual(data);
  });

  test('失敗を戻すと、実行した場所と、同じコード・文言・状態のGraphQLClientErrorになる', () => {
    const restored = fromSystemStatusLoaderData(
      toSystemStatusLoaderData(
        { ok: false, error: UPSTREAM_UNAVAILABLE },
        'browser',
      ),
    );

    expect(restored.executedOn).toBe('browser');
    if (restored.result.ok) {
      throw new Error('失敗の結果が成功に変わりました。');
    }
    expect(restored.result.error).toBeInstanceOf(GraphQLClientError);
    expect(restored.result.error.code).toBe('upstream_unavailable');
    expect(restored.result.error.message).toBe(UPSTREAM_UNAVAILABLE.message);
    expect(restored.result.error.status).toBe(503);
    expect(restored.result.error.expected).toBe(false);
  });
});
