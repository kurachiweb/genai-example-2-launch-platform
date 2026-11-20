import type { Mock } from 'vitest';

import type { AdminStatisticsWeekView } from '../src/graphql/admin-weekly-statistics.ts';
import {
  type AdminWeeklyStatisticsQuery,
  AdminWeeklyStatisticsDocument,
} from '../src/graphql/generated/graphql.ts';
import { success } from './admin-accounts-fixtures.ts';

type StatisticsWeekNode =
  AdminWeeklyStatisticsQuery['adminWeeklyStatistics']['weeks'][number];

export const STATISTICS_LAST_COMPUTED_AT = '2026-11-19T19:21:00.000Z';

// 2週前の確定した週
export const OLDER_FINALIZED_WEEK: StatisticsWeekNode = Object.freeze({
  weekStart: '2026-11-02',
  finalized: true,
  netRevenue: Object.freeze({ amount: 122_216, currency: 'usd' }),
  users: 1_222,
  products: 343,
  qualifierMatches: 12,
  upvotes: 5_400,
});

// 直近の確定した週。前の週から合計収益+$12.34・ユーザー数+12・プロダクト数-3・予選実施数±0・Upvote数+200
export const LATEST_FINALIZED_WEEK: StatisticsWeekNode = Object.freeze({
  weekStart: '2026-11-09',
  finalized: true,
  netRevenue: Object.freeze({ amount: 123_450, currency: 'usd' }),
  users: 1_234,
  products: 340,
  qualifierMatches: 12,
  upvotes: 5_600,
});

export const CURRENT_WEEK: StatisticsWeekNode = Object.freeze({
  weekStart: '2026-11-16',
  finalized: false,
  netRevenue: Object.freeze({ amount: 900, currency: 'usd' }),
  users: 1_240,
  products: 341,
  qualifierMatches: 3,
  upvotes: 1_250,
});

export const STATISTICS_WEEKS: readonly StatisticsWeekNode[] = Object.freeze([
  OLDER_FINALIZED_WEEK,
  LATEST_FINALIZED_WEEK,
  CURRENT_WEEK,
]);

export const weeklyStatisticsQueryOf = (
  weeks: readonly StatisticsWeekNode[],
  lastComputedAt: string | null = weeks.length === 0
    ? null
    : STATISTICS_LAST_COMPUTED_AT,
): AdminWeeklyStatisticsQuery => ({
  adminWeeklyStatistics: { weeks: [...weeks], lastComputedAt },
});

export const statisticsWeekViewOf = (
  week: StatisticsWeekNode,
): AdminStatisticsWeekView => ({
  weekStart: week.weekStart,
  finalized: week.finalized,
  netRevenue: { ...week.netRevenue },
  users: week.users,
  products: week.products,
  qualifierMatches: week.qualifierMatches,
  upvotes: week.upvotes,
});

// ダッシュボードを描く他のテストの既定の応答に、統計の照会の応答を足す
export function respondWeeklyStatistics(
  executeGraphQL: Mock,
  respond: () => Promise<unknown> = () =>
    success(weeklyStatisticsQueryOf(STATISTICS_WEEKS)),
): void {
  const fallback = executeGraphQL.getMockImplementation();
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === AdminWeeklyStatisticsDocument) {
      return respond();
    }
    if (fallback === undefined) {
      throw new Error('想定していない操作が実行されました。');
    }
    return fallback(document, variables) as unknown;
  });
}
