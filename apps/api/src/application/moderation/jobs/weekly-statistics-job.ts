import { inject, injectable } from 'inversify';

import { IDENTITY_PLATFORM_TYPES } from '../../../../lib/core/identity/identifiers.ts';
import type { AdminUserDirectory } from '../../../../lib/core/identity/ports.ts';
import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { MATCH_PLATFORM_TYPES } from '../../../../lib/core/match/identifiers.ts';
import type {
  DailyMatchSummary,
  MatchDirectory,
} from '../../../../lib/core/match/ports.ts';
import {
  isWeekFinished,
  type StatisticsWeekRange,
  weeksToCompute,
} from '../../../../lib/core/moderation/statistics-week.ts';
import { PAYMENTS_TYPES } from '../../../../lib/core/payments/identifiers.ts';
import type { PaymentRevenueReport } from '../../../../lib/core/payments/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../../lib/core/product/identifiers.ts';
import type { AdminProductDirectory } from '../../../../lib/core/product/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import {
  type BusinessDate,
  toBusinessDateTime,
} from '../../../../lib/core/time/business-time.ts';
import { MODERATION_TYPES } from '../moderation-types.ts';
import type {
  ModerationIncidentReporter,
  WeeklyStatisticsRow,
  WeeklyStatisticsStore,
} from '../ports.ts';

export const WEEKLY_STATISTICS_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'ugc-moderation.weekly-statistics',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 1900,
    handler: MODERATION_TYPES.WeeklyStatisticsJob,
  });

const logger = getAppLogger(['api', 'application', 'moderation']);

// 終わった週は週の終わり、集計中の今週は実行時刻の時点の値を求める
interface WeekToCompute {
  readonly week: StatisticsWeekRange;
  readonly asOf: Date;
  readonly finalized: boolean;
}

interface MatchTotals {
  readonly qualifierMatches: number;
  readonly upvotes: number;
}

@injectable()
export class WeeklyStatisticsJob implements ScheduledJobHandler {
  constructor(
    @inject(MODERATION_TYPES.WeeklyStatisticsStore)
    private readonly store: WeeklyStatisticsStore,
    @inject(IDENTITY_PLATFORM_TYPES.AdminUserDirectory)
    private readonly users: AdminUserDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.AdminProductDirectory)
    private readonly products: AdminProductDirectory,
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(PAYMENTS_TYPES.PaymentRevenueReport)
    private readonly revenue: PaymentRevenueReport,
    @inject(MODERATION_TYPES.ModerationIncidentReporter)
    private readonly reporter: ModerationIncidentReporter,
  ) {}

  // 確定した週はストアが書き換えず、未確定の週は上書きするため、2回実行しても週の行は増えない
  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const { current, previous } = weeksToCompute(scheduledTime);
    const currentTarget: WeekToCompute = {
      week: current,
      asOf: scheduledTime,
      finalized: false,
    };
    const targets: readonly WeekToCompute[] = (await this.store.findFinalized(
      previous.weekStart,
    ))
      ? [currentTarget]
      : [
          {
            week: previous,
            asOf: previous.to,
            finalized: isWeekFinished(previous, scheduledTime),
          },
          currentTarget,
        ];
    let rows: readonly WeeklyStatisticsRow[];
    try {
      rows = await this.#compute(targets, scheduledTime);
    } catch (error: unknown) {
      // 何も保存しないため前週は未確定のまま残り、次の実行が週の終わりの時点で集計し直す。投げ直すと同じ失敗を二重に通知するため、ジョブは成功で終える
      logger.warning('週ごとの統計を集計できませんでした', { error });
      this.reporter.report('statistics-failed', {
        job: WEEKLY_STATISTICS_JOB_DEFINITION.name,
      });
      return;
    }
    await this.store.upsert(rows);
    logger.info('週ごとの統計を集計しました', {
      computed: rows.length,
      finalized: rows.filter(({ finalized }) => finalized).length,
    });
  }

  // 週の数によらず照会の回数を一定に保つため、収益と日ごとの集計は全ての週を1回の照会でまとめて引く
  async #compute(
    targets: readonly WeekToCompute[],
    now: Date,
  ): Promise<readonly WeeklyStatisticsRow[]> {
    const [netRevenues, usersTotals, productsTotals, days] = await Promise.all([
      this.revenue.netRevenue(
        targets.map(({ week, asOf }) => ({ from: week.from, to: asOf })),
      ),
      Promise.all(
        targets.map(({ asOf }) => this.users.countRegisteredAt(asOf)),
      ),
      Promise.all(
        targets.map(({ asOf }) => this.products.countRegisteredAt(asOf)),
      ),
      this.matches.summarizeDaily({
        from: earliestWeekStart(targets),
        to: toBusinessDateTime(now).date,
      }),
    ]);
    return targets.map(({ week, finalized }, index) => ({
      weekStart: week.weekStart,
      netRevenue: valueAt(netRevenues, index),
      usersTotal: valueAt(usersTotals, index),
      productsTotal: valueAt(productsTotals, index),
      ...matchTotalsOf(days, week),
      finalized,
      computedAt: now,
    }));
  }
}

function earliestWeekStart(targets: readonly WeekToCompute[]): BusinessDate {
  return valueAt(targets, 0).week.weekStart;
}

function matchTotalsOf(
  days: readonly DailyMatchSummary[],
  week: StatisticsWeekRange,
): MatchTotals {
  const end = toBusinessDateTime(week.to).date;
  // 業務日付はYYYY-MM-DDのため、文字列の比較が日付の前後と一致する
  return days
    .filter(({ date }) => date >= week.weekStart && date < end)
    .reduce<MatchTotals>(
      (total, day) => ({
        qualifierMatches: total.qualifierMatches + day.qualifierMatches,
        upvotes: total.upvotes + day.upvotes,
      }),
      { qualifierMatches: 0, upvotes: 0 },
    );
}

function valueAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(
      `週ごとの統計の照会の結果に${String(index)}番目の値がありません`,
    );
  }
  return value;
}
