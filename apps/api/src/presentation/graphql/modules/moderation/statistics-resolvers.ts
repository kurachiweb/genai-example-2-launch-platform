import { PAYMENT_CURRENCY } from '../../../../../common-lib/payments/money.ts';
import { MODERATION_TYPES } from '../../../../application/moderation/moderation-types.ts';
import type { WeeklyStatisticsRow } from '../../../../application/moderation/ports.ts';
import type {
  WeeklyStatisticsReader,
  WeeklyStatisticsView,
} from '../../../../application/moderation/weekly-statistics-reader.ts';
import type {
  AdminStatisticsWeek,
  AdminWeeklyStatistics,
  Resolvers,
} from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { adminOnly, moderationOperatorOf } from './resolver-support.ts';

const statisticsReaderOf = (context: GraphQLContext): WeeklyStatisticsReader =>
  context.resolve<WeeklyStatisticsReader>(
    MODERATION_TYPES.WeeklyStatisticsReader,
  );

const toAdminStatisticsWeek = (
  row: WeeklyStatisticsRow,
): AdminStatisticsWeek => ({
  weekStart: row.weekStart,
  finalized: row.finalized,
  netRevenue: { amount: row.netRevenue, currency: PAYMENT_CURRENCY },
  users: row.usersTotal,
  products: row.productsTotal,
  qualifierMatches: row.qualifierMatches,
  upvotes: row.upvotes,
});

const toAdminWeeklyStatistics = ({
  weeks,
  lastComputedAt,
}: WeeklyStatisticsView): AdminWeeklyStatistics => ({
  weeks: weeks.map(toAdminStatisticsWeek),
  lastComputedAt,
});

// 統計は全ロールの管理者に見せる。adminOnlyで包み、管理者側以外の呼び出しをロールの確認より前に拒否する
export const statisticsResolvers = {
  Query: {
    adminWeeklyStatistics: adminOnly(
      async (_parent: unknown, _args: unknown, context) => {
        await moderationOperatorOf(context, 'viewer');
        return toAdminWeeklyStatistics(
          await statisticsReaderOf(context).read(),
        );
      },
    ),
  },
} satisfies Resolvers;
