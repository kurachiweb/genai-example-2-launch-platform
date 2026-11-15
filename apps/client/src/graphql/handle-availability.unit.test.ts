import { describe, expect, test } from 'bun:test';
import type { QueryClient } from '@tanstack/react-query';

import { browserErrorQueue } from '../../lib/start/observability/browser-error-reporting.ts';
import { GraphQLClientError } from '../../lib/utilities/graphql/graphql-result.ts';
import { ClientHandleAvailabilityDocument } from './generated/graphql.ts';
import { fetchHandleAvailability } from './handle-availability.ts';
import { graphqlQueryKey } from '../../lib/utilities/graphql/persisted-document.ts';

const reported: unknown[] = [];
browserErrorQueue.flush((error) => {
  reported.push(error);
});

const succeedingQueryClient = (
  handleAvailability: 'AVAILABLE' | 'INVALID' | 'UNAVAILABLE',
) => {
  const options: unknown[] = [];
  const queryClient = {
    query: (option: unknown) => {
      options.push(option);
      return Promise.resolve({ handleAvailability });
    },
  } as unknown as QueryClient;
  return { queryClient, options };
};

const failingQueryClient = (error: Error) =>
  ({ query: () => Promise.reject(error) }) as unknown as QueryClient;

describe('fetchHandleAvailability', () => {
  test.each(['AVAILABLE', 'INVALID', 'UNAVAILABLE'] as const)(
    'サーバーの判定%sをそのまま返す',
    async (availability) => {
      const { queryClient } = succeedingQueryClient(availability);

      expect(await fetchHandleAvailability(queryClient, 'maker_ai')).toBe(
        availability,
      );
    },
  );

  test('入力したハンドルで問い合わせ、結果をキャッシュに残さない', async () => {
    const { queryClient, options } = succeedingQueryClient('AVAILABLE');

    await fetchHandleAvailability(queryClient, 'maker_ai');

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      queryKey: graphqlQueryKey(ClientHandleAvailabilityDocument, {
        handle: 'maker_ai',
      }),
      staleTime: 0,
      gcTime: 0,
    });
  });

  test('想定内の失敗は結果なしで返し、エラートラッキングへ送らない', async () => {
    const before = reported.length;
    const error = new GraphQLClientError({
      code: 'rate_limited',
      message: 'しばらくしてから再度お試しください。',
      status: 429,
    });

    expect(
      await fetchHandleAvailability(failingQueryClient(error), 'maker_ai'),
    ).toBeUndefined();
    expect(reported).toHaveLength(before);
  });

  test('想定外の失敗は結果なしで返し、例外だけをエラートラッキングへ送る', async () => {
    const before = reported.length;
    const error = new Error('予期しない失敗');

    expect(
      await fetchHandleAvailability(failingQueryClient(error), 'maker_ai'),
    ).toBeUndefined();
    expect(reported.slice(before)).toEqual([error]);
  });
});
