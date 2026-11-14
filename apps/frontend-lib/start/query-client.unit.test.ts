import { afterEach, describe, expect, test } from 'bun:test';
import { environmentManager } from '@tanstack/react-query';

import { GraphQLClientError } from '../utilities/graphql/graphql-result.ts';
import { createAppQueryClient, shouldRetryQuery } from './query-client.ts';

const clientErrorOf = (code: string, status: number): GraphQLClientError =>
  new GraphQLClientError({ code, status, message: 'テスト用の失敗' });

const TRANSIENT_ERRORS = [
  ['network_error', 0],
  ['upstream_unavailable', 503],
  ['upstream_timeout', 503],
] as const;

const NOT_RETRIED_ERRORS = [
  ['rate_limit_exceeded', 429],
  ['csrf_rejected', 403],
  ['not_found', 404],
  ['validation_failed', 200],
  ['unauthenticated', 200],
  ['internal_error', 500],
  ['invalid_response', 502],
  ['persisted_operation_not_found', 400],
] as const;

describe('shouldRetryQuery', () => {
  test.each(TRANSIENT_ERRORS)(
    '%sは失敗の回数が2回未満なら再試行し、2回目の再試行の後は再試行しない',
    (code, status) => {
      const error = clientErrorOf(code, status);

      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(1, error)).toBe(true);
      expect(shouldRetryQuery(2, error)).toBe(false);
      expect(shouldRetryQuery(3, error)).toBe(false);
    },
  );

  test.each(NOT_RETRIED_ERRORS)(
    '%s(状態%d)は1回目の失敗でも再試行しない',
    (code, status) => {
      expect(shouldRetryQuery(0, clientErrorOf(code, status))).toBe(false);
    },
  );

  test('GraphQLClientError以外の例外は再試行しない', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(false);
    expect(shouldRetryQuery(0, new Error('network_error'))).toBe(false);
    expect(
      shouldRetryQuery(0, { code: 'network_error', expected: false }),
    ).toBe(false);
    expect(shouldRetryQuery(0, undefined)).toBe(false);
  });
});

describe('createAppQueryClient', () => {
  const browserDefaultsOf = () =>
    createAppQueryClient({ isServer: false }).getDefaultOptions();

  test('ブラウザでは鮮度を30秒保ち、ウィンドウのフォーカスで取得し直さず、再試行の方針を使い、変更は再試行しない', () => {
    const { queries, mutations } = browserDefaultsOf();

    expect(queries?.staleTime).toBe(30_000);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(queries?.retry).toBe(shouldRetryQuery);
    expect(mutations?.retry).toBe(false);
  });

  test('サーバーでは鮮度とフォーカスの既定値はブラウザと同じで、取得も変更も再試行しない', () => {
    const { queries, mutations } = createAppQueryClient({
      isServer: true,
    }).getDefaultOptions();

    expect(queries?.staleTime).toBe(30_000);
    expect(queries?.refetchOnWindowFocus).toBe(false);
    expect(queries?.retry).toBe(false);
    expect(mutations?.retry).toBe(false);
  });

  describe('サーバーかどうかを渡さない場合', () => {
    const detectedIsServer = environmentManager.isServer();

    afterEach(() => {
      environmentManager.setIsServer(() => detectedIsServer);
    });

    test('TanStack Queryがサーバーと判定する実行環境では再試行しない', () => {
      environmentManager.setIsServer(() => true);

      expect(createAppQueryClient().getDefaultOptions().queries?.retry).toBe(
        false,
      );
    });

    test('TanStack Queryがブラウザと判定する実行環境では再試行の方針を使う', () => {
      environmentManager.setIsServer(() => false);

      expect(createAppQueryClient().getDefaultOptions().queries?.retry).toBe(
        shouldRetryQuery,
      );
    });
  });

  test('呼ぶたびに別のQueryClientを返す', () => {
    expect(createAppQueryClient()).not.toBe(createAppQueryClient());
  });

  test('ブラウザでは通信の失敗の取得を最初の1回と再試行の2回で合わせて3回だけ呼ぶ', async () => {
    const queryClient = createAppQueryClient({ isServer: false });
    let calls = 0;

    const fetching = queryClient.query({
      queryKey: ['network'],
      queryFn: () => {
        calls += 1;
        return Promise.reject(clientErrorOf('network_error', 0));
      },
      retryDelay: 0,
    });

    expect(await fetching.catch((error: unknown) => error)).toMatchObject({
      code: 'network_error',
    });
    expect(calls).toBe(3);
  });

  test('サーバーでは上流の時間切れの取得を再試行せず1回だけ呼ぶ', async () => {
    const queryClient = createAppQueryClient({ isServer: true });
    let calls = 0;

    const fetching = queryClient.query({
      queryKey: ['timeout'],
      queryFn: () => {
        calls += 1;
        return Promise.reject(clientErrorOf('upstream_timeout', 503));
      },
      retryDelay: 0,
    });

    expect(await fetching.catch((error: unknown) => error)).toMatchObject({
      code: 'upstream_timeout',
    });
    expect(calls).toBe(1);
  });

  test('ブラウザでも429の取得は再試行せず1回だけ呼ぶ', async () => {
    const queryClient = createAppQueryClient({ isServer: false });
    let calls = 0;

    const fetching = queryClient.query({
      queryKey: ['rate-limited'],
      queryFn: () => {
        calls += 1;
        return Promise.reject(clientErrorOf('rate_limit_exceeded', 429));
      },
      retryDelay: 0,
    });

    expect(await fetching.catch((error: unknown) => error)).toMatchObject({
      code: 'rate_limit_exceeded',
    });
    expect(calls).toBe(1);
  });

  test('ブラウザでも変更は通信の失敗で再試行せず1回だけ呼ぶ', async () => {
    const queryClient = createAppQueryClient({ isServer: false });
    let calls = 0;
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => {
        calls += 1;
        return Promise.reject(clientErrorOf('network_error', 0));
      },
      retryDelay: 0,
    });

    expect(
      await mutation.execute(undefined).catch((error: unknown) => error),
    ).toMatchObject({
      code: 'network_error',
    });
    expect(calls).toBe(1);
  });
});
