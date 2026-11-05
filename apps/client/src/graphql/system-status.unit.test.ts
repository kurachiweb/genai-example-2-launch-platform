import { describe, expect, test } from 'bun:test';

import {
  GraphQLClientError,
  type GraphQLResult,
} from '../../lib/utilities/graphql/graphql-result.ts';
import type { ClientSystemStatusQuery } from './generated/graphql.ts';
import { toSystemStatusResult } from './system-status.ts';

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
