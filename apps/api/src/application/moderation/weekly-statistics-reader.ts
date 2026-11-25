import { inject, injectable } from 'inversify';

import { STATISTICS_WEEKS_SHOWN } from '../../../common-lib/moderation/moderation-actions.ts';
import { MODERATION_TYPES } from './moderation-types.ts';
import type { WeeklyStatisticsRow, WeeklyStatisticsStore } from './ports.ts';

export interface WeeklyStatisticsView {
  // 週の古い順。最後の行が未確定なら集計中の週である
  readonly weeks: readonly WeeklyStatisticsRow[];
  readonly lastComputedAt: Date | null;
}

// 権限の確認は呼び出し側のリゾルバが行う。表示のたびに集計し直さず、ジョブが保存した行を読む
export interface WeeklyStatisticsReader {
  read(): Promise<WeeklyStatisticsView>;
}

@injectable()
export class DefaultWeeklyStatisticsReader implements WeeklyStatisticsReader {
  constructor(
    @inject(MODERATION_TYPES.WeeklyStatisticsStore)
    private readonly store: WeeklyStatisticsStore,
  ) {}

  async read(): Promise<WeeklyStatisticsView> {
    const rows = await this.store.listRecent(STATISTICS_WEEKS_SHOWN + 1);
    // ストアは最新の行が確定済みでも件数まで確定した週を返すため、その場合は確定した週を表示の週数に切る
    const weeks =
      rows.at(-1)?.finalized === false
        ? rows
        : rows.slice(-STATISTICS_WEEKS_SHOWN);
    return { weeks, lastComputedAt: latestComputedAt(weeks) };
  }
}

function latestComputedAt(weeks: readonly WeeklyStatisticsRow[]): Date | null {
  return weeks.reduce<Date | null>(
    (latest, { computedAt }) =>
      latest === null || computedAt.getTime() > latest.getTime()
        ? computedAt
        : latest,
    null,
  );
}
