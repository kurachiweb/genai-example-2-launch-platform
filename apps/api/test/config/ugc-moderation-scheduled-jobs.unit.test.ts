import { describe, expect, test } from 'bun:test';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { createRunBudgetTable } from '../../lib/core/scheduling/run-budget.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import { MODERATION_MAINTENANCE_JOB_DEFINITION } from '../../src/application/moderation/jobs/moderation-maintenance-job.ts';
import { WEEKLY_STATISTICS_JOB_DEFINITION } from '../../src/application/moderation/jobs/weekly-statistics-job.ts';
import {
  SCHEDULED_JOBS,
  SCHEDULED_RUN_BUDGETS,
} from '../../src/composition/scheduled-jobs.ts';

const DAILY_CRON = toUtcCronExpression({ hour: 4, minute: 21 });

const ALL_JOBS = [
  WEEKLY_STATISTICS_JOB_DEFINITION,
  MODERATION_MAINTENANCE_JOB_DEFINITION,
] as const;

describe('UGC管理のジョブの定期実行の一覧への登録', () => {
  test('4:21の統計の集計と保守のジョブの定義を、そのまま定期実行の一覧に1つずつ載せる', () => {
    const registered = SCHEDULED_JOBS.filter(({ name }) =>
      name.startsWith('ugc-moderation.'),
    );

    expect(registered).toHaveLength(ALL_JOBS.length);
    for (const definition of ALL_JOBS) {
      expect(registered).toContain(definition);
    }
  });

  test('定期実行の一覧はジョブの定義の検証(名前・時刻・同じ時刻の順序の重複の拒否)を通る', () => {
    expect(() => createCronRegistry(SCHEDULED_JOBS)).not.toThrow();
  });

  test('4:21の起動(21 12 * * *)では、他の機能のジョブとorderが重ならず、Yearトーナメントの再処理(1700)の後・通報の通知の送り直し(2000)の前に統計の集計(1900)・保守(1910)の順で動く', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(DAILY_CRON)
      .map(({ name, order }) => ({ name, order }));
    const index = jobs.findIndex(
      ({ name }) => name === 'ugc-moderation.weekly-statistics',
    );

    expect(DAILY_CRON).toBe('21 12 * * *');
    expect(new Set(jobs.map(({ order }) => order)).size).toBe(jobs.length);
    expect(jobs.slice(index - 1, index + 3)).toEqual([
      { name: 'tournament-year.entry-follow-up', order: 1700 },
      { name: 'ugc-moderation.weekly-statistics', order: 1900 },
      { name: 'ugc-moderation.maintenance', order: 1910 },
      { name: 'content-reporting.notice-redispatch', order: 2000 },
    ]);
  });

  test('4:21の起動は合計の所要時間の予算(300秒)を他の機能のジョブと共有する', () => {
    const budgets = createRunBudgetTable(SCHEDULED_RUN_BUDGETS);

    expect(budgets.budgetFor(DAILY_CRON)?.maxTotalDurationMs).toBe(300_000);
  });

  test('本機能のジョブの順は、割り当てられた1900番台の帯に収まる', () => {
    for (const { order } of ALL_JOBS) {
      expect(order).toBeGreaterThanOrEqual(1900);
      expect(order).toBeLessThan(2000);
    }
  });
});
