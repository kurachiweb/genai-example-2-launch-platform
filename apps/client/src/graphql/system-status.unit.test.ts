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
  test('成功の結果はそのまま往復する', () => {
    const data = toSystemStatusLoaderData({ ok: true, data: SNAPSHOT });

    expect(fromSystemStatusLoaderData(data)).toStrictEqual({
      ok: true,
      data: SNAPSHOT,
    });
  });

  test('失敗はErrorを含まない素のオブジェクトにし、JSONを経てもエラーコードが残る', () => {
    const data = toSystemStatusLoaderData({
      ok: false,
      error: UPSTREAM_UNAVAILABLE,
    });

    expect(data).toStrictEqual({
      ok: false,
      error: {
        code: 'upstream_unavailable',
        message: UPSTREAM_UNAVAILABLE.message,
        status: 503,
      },
    });
    expect(JSON.parse(JSON.stringify(data))).toStrictEqual(data);
  });

  test('失敗を戻すと、同じコード・文言・状態のGraphQLClientErrorになる', () => {
    const restored = fromSystemStatusLoaderData(
      toSystemStatusLoaderData({ ok: false, error: UPSTREAM_UNAVAILABLE }),
    );

    if (restored.ok) {
      throw new Error('失敗の結果が成功に変わりました。');
    }
    expect(restored.error).toBeInstanceOf(GraphQLClientError);
    expect(restored.error.code).toBe('upstream_unavailable');
    expect(restored.error.message).toBe(UPSTREAM_UNAVAILABLE.message);
    expect(restored.error.status).toBe(503);
    expect(restored.error.expected).toBe(false);
  });
});
