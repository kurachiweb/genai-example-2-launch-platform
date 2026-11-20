import type { MinorUnitAmount } from '../../common-lib/payments/money.ts';
import { graphqlQueryOptions } from '../../lib/start/graphql/graphql-query-options.ts';
import {
  AdminWeeklyStatisticsDocument,
  type AdminWeeklyStatisticsQuery,
} from './generated/graphql.ts';

export interface StatisticsMoneyView {
  readonly amount: MinorUnitAmount;
  // ISO 4217の小文字の通貨コード
  readonly currency: string;
}

export interface AdminStatisticsWeekView {
  // 週の開始日(月曜日の業務日付)
  readonly weekStart: string;
  // 偽は集計中の今週か、集計が止まって確定していない週
  readonly finalized: boolean;
  readonly netRevenue: StatisticsMoneyView;
  readonly users: number;
  readonly products: number;
  readonly qualifierMatches: number;
  readonly upvotes: number;
}

export interface AdminWeeklyStatisticsView {
  // 週の古い順
  readonly weeks: readonly AdminStatisticsWeekView[];
  // nullは一度も集計していない
  readonly lastComputedAt: string | null;
}

type StatisticsWeekNode =
  AdminWeeklyStatisticsQuery['adminWeeklyStatistics']['weeks'][number];

export const adminWeeklyStatisticsQueryOptions = () =>
  graphqlQueryOptions(AdminWeeklyStatisticsDocument, {});

const toStatisticsWeek = (
  week: StatisticsWeekNode,
): AdminStatisticsWeekView => ({
  weekStart: week.weekStart,
  finalized: week.finalized,
  netRevenue: {
    amount: week.netRevenue.amount,
    currency: week.netRevenue.currency,
  },
  users: week.users,
  products: week.products,
  qualifierMatches: week.qualifierMatches,
  upvotes: week.upvotes,
});

export const toAdminWeeklyStatistics = ({
  adminWeeklyStatistics,
}: AdminWeeklyStatisticsQuery): AdminWeeklyStatisticsView => ({
  weeks: adminWeeklyStatistics.weeks.map(toStatisticsWeek),
  lastComputedAt: adminWeeklyStatistics.lastComputedAt,
});
