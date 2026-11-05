import { describe, expect, test } from 'bun:test';

import { GraphQLClientError } from '../utilities/graphql/graphql-result.ts';
import { graphqlClientErrorAdapter } from './graphql-client-error-adapter.ts';

const RATE_LIMITED = new GraphQLClientError(
  {
    code: 'rate_limited',
    message: 'リクエストが多すぎます。しばらくしてから再度お試しください。',
    status: 429,
    retryAfterSeconds: 30,
  },
  { cause: new Error('内部の詳細') },
);

const INVALID_INPUT = new GraphQLClientError({
  code: 'validation_failed',
  message: '入力内容を確認してください。',
  status: 400,
  details: [
    { field: 'body', message: '本文を入力してください。', code: 'required' },
  ],
});

const roundTrip = (error: GraphQLClientError): GraphQLClientError =>
  graphqlClientErrorAdapter.fromSerializable(
    graphqlClientErrorAdapter.toSerializable(error),
  );

describe('graphqlClientErrorAdapter', () => {
  test('GraphQLClientErrorだけを対象にし、他の例外は既定の受け渡しに任せる', () => {
    expect(graphqlClientErrorAdapter.test(RATE_LIMITED)).toBe(true);
    expect(graphqlClientErrorAdapter.test(new Error('想定外'))).toBe(false);
    expect(graphqlClientErrorAdapter.test({ code: 'rate_limited' })).toBe(
      false,
    );
  });

  test('受け渡した後もGraphQLClientErrorとして、コード・文言・状態コード・再試行までの秒数・想定内かどうかを保つ', () => {
    const restored = roundTrip(RATE_LIMITED);

    expect(restored).toBeInstanceOf(GraphQLClientError);
    expect(restored.code).toBe('rate_limited');
    expect(restored.message).toBe(RATE_LIMITED.message);
    expect(restored.status).toBe(429);
    expect(restored.retryAfterSeconds).toBe(30);
    expect(restored.details).toBeUndefined();
    expect(restored.expected).toBe(true);
  });

  test('項目ごとの検証の違反を保つ', () => {
    expect(roundTrip(INVALID_INPUT).details).toEqual(INVALID_INPUT.details);
  });

  test('想定外のコードは受け渡した後も想定外として扱う', () => {
    const internal = new GraphQLClientError({
      code: 'internal_error',
      message: 'サーバーでエラーが発生しました。',
      status: 500,
    });

    expect(roundTrip(internal).expected).toBe(false);
  });

  test('原因の例外とスタックはブラウザへ渡さない', () => {
    const serialized = graphqlClientErrorAdapter.toSerializable(RATE_LIMITED);

    expect(Object.keys(serialized).toSorted()).toEqual(
      ['code', 'details', 'message', 'retryAfterSeconds', 'status'].toSorted(),
    );
    expect(roundTrip(RATE_LIMITED).cause).toBeUndefined();
  });
});
