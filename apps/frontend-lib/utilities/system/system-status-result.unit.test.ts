import { describe, expect, test } from 'bun:test';

import {
  createNetworkError,
  GraphQLClientError,
} from '../graphql/graphql-result.ts';
import { isApiUnreachable } from './system-status-result.ts';

const errorOf = (code: string, status: number): GraphQLClientError =>
  new GraphQLClientError({ code, message: 'エラーです。', status });

describe('isApiUnreachable', () => {
  test.each([
    ['upstream_unavailable', 502],
    ['upstream_timeout', 504],
  ])(
    'フロントエンドサーバーがAPIサーバーへ中継できなかった失敗(%s)は、APIサーバーへ到達できなかったとみなす',
    (code, status) => {
      expect(isApiUnreachable(errorOf(code, status))).toBe(true);
    },
  );

  test('ブラウザの通信の失敗は、APIサーバーへ到達できなかったとみなす', () => {
    expect(isApiUnreachable(createNetworkError(new TypeError('failed')))).toBe(
      true,
    );
  });

  test.each([
    ['internal_error', 500],
    ['invalid_response', 200],
    ['graphql_validation_failed', 400],
    ['rate_limit_exceeded', 429],
    ['csrf_rejected', 403],
  ])(
    'APIサーバーや中継の経路が応答した失敗(%s)は、APIサーバーへ到達できなかったとみなさない',
    (code, status) => {
      expect(isApiUnreachable(errorOf(code, status))).toBe(false);
    },
  );
});
