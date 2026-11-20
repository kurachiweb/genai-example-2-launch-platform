import { describe, expect, test } from 'bun:test';

import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  dataResponse,
  runThroughApi,
} from '../../test/moderation-graphql-api.ts';
import {
  adminWeeklyStatisticsQueryOptions,
  toAdminWeeklyStatistics,
} from './admin-weekly-statistics.ts';
import {
  AdminWeeklyStatisticsDocument,
  type AdminWeeklyStatisticsQuery,
} from './generated/graphql.ts';

type StatisticsWeekNode =
  AdminWeeklyStatisticsQuery['adminWeeklyStatistics']['weeks'][number];

const FINALIZED_WEEK: StatisticsWeekNode = {
  weekStart: '2026-11-09',
  finalized: true,
  netRevenue: { amount: 123_400, currency: 'usd' },
  users: 1_200,
  products: 340,
  qualifierMatches: 12,
  upvotes: 5_600,
};

const REFUNDED_WEEK: StatisticsWeekNode = {
  weekStart: '2026-11-02',
  finalized: true,
  netRevenue: { amount: -900, currency: 'usd' },
  users: 1_150,
  products: 330,
  qualifierMatches: 0,
  upvotes: 0,
};

const CURRENT_WEEK: StatisticsWeekNode = {
  weekStart: '2026-11-16',
  finalized: false,
  netRevenue: { amount: 0, currency: 'usd' },
  users: 1_210,
  products: 341,
  qualifierMatches: 3,
  upvotes: 700,
};

const LAST_COMPUTED_AT = '2026-11-19T19:21:00.000Z';

const statisticsResponse = (
  weeks: readonly StatisticsWeekNode[],
  lastComputedAt: string | null,
): AdminWeeklyStatisticsQuery => ({
  adminWeeklyStatistics: { weeks: [...weeks], lastComputedAt },
});

describe('adminWeeklyStatisticsQueryOptions', () => {
  test('統計の照会の操作と空の変数をキーにする', () => {
    expect([...adminWeeklyStatisticsQueryOptions().queryKey]).toStrictEqual([
      ...graphqlQueryKey(AdminWeeklyStatisticsDocument, {}),
    ]);
  });

  test('統計の照会の識別子だけを変数なしでAPIへ送り、応答のデータを返す', async () => {
    const response = statisticsResponse([FINALIZED_WEEK], LAST_COMPUTED_AT);

    const { result, sent } = await runThroughApi(
      (queryClient) => queryClient.query(adminWeeklyStatisticsQueryOptions()),
      dataResponse(response),
    );

    expect(sent).toStrictEqual([
      {
        documentId: documentIdOf(AdminWeeklyStatisticsDocument),
        variables: {},
      },
    ]);
    expect(result).toStrictEqual(response);
  });
});

describe('toAdminWeeklyStatistics', () => {
  test('週を古い順のまま写し、合計収益を最小通貨単位の整数と通貨のまま持ち、確定の有無と最後の集計日時を残す', () => {
    expect(
      toAdminWeeklyStatistics(
        statisticsResponse(
          [REFUNDED_WEEK, FINALIZED_WEEK, CURRENT_WEEK],
          LAST_COMPUTED_AT,
        ),
      ),
    ).toStrictEqual({
      weeks: [
        {
          weekStart: '2026-11-02',
          finalized: true,
          netRevenue: { amount: -900, currency: 'usd' },
          users: 1_150,
          products: 330,
          qualifierMatches: 0,
          upvotes: 0,
        },
        {
          weekStart: '2026-11-09',
          finalized: true,
          netRevenue: { amount: 123_400, currency: 'usd' },
          users: 1_200,
          products: 340,
          qualifierMatches: 12,
          upvotes: 5_600,
        },
        {
          weekStart: '2026-11-16',
          finalized: false,
          netRevenue: { amount: 0, currency: 'usd' },
          users: 1_210,
          products: 341,
          qualifierMatches: 3,
          upvotes: 700,
        },
      ],
      lastComputedAt: LAST_COMPUTED_AT,
    });
  });

  test('一度も集計していなければ、週の無い統計と最後の集計日時のnullにする', () => {
    expect(toAdminWeeklyStatistics(statisticsResponse([], null))).toStrictEqual(
      { weeks: [], lastComputedAt: null },
    );
  });
});
