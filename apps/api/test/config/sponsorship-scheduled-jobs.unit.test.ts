import { describe, expect, test } from 'bun:test';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { createRunBudgetTable } from '../../lib/core/scheduling/run-budget.ts';
import { SPONSORSHIP_DAILY_NOTICES_TIME } from '../../lib/core/sponsorship/notice-schedule.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import { SPONSORSHIP_DAILY_NOTICES_JOB_DEFINITION } from '../../src/application/sponsorship/jobs/daily-notices-job.ts';
import { SPONSORSHIP_MAINTENANCE_JOB_DEFINITION } from '../../src/application/sponsorship/jobs/maintenance-job.ts';
import {
  SCHEDULED_JOBS,
  SCHEDULED_RUN_BUDGETS,
} from '../../src/composition/scheduled-jobs.ts';

const DAILY_NOTICES_CRON = toUtcCronExpression({ hour: 0, minute: 7 });
const MAINTENANCE_CRON = toUtcCronExpression({ hour: 4, minute: 21 });

const ALL_JOBS = [
  SPONSORSHIP_DAILY_NOTICES_JOB_DEFINITION,
  SPONSORSHIP_MAINTENANCE_JOB_DEFINITION,
] as const;

describe('スポンサー広告のジョブの定期実行の一覧への登録', () => {
  test('0:07の通知のジョブと4:21の日次の処理の定義を、そのまま定期実行の一覧に1つずつ載せる', () => {
    const registered = SCHEDULED_JOBS.filter(({ name }) =>
      name.startsWith('sponsorship.'),
    );

    expect(registered).toHaveLength(ALL_JOBS.length);
    for (const definition of ALL_JOBS) {
      expect(registered).toContain(definition);
    }
  });

  test('定期実行の一覧はジョブの定義の検証(名前・時刻・同じ時刻の順序の重複の拒否)を通る', () => {
    expect(() => createCronRegistry(SCHEDULED_JOBS)).not.toThrow();
  });

  test('0:07の起動(7 8 * * *)では、通知のジョブだけが動く', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(DAILY_NOTICES_CRON)
      .map(({ name, order }) => ({ name, order }));

    expect(DAILY_NOTICES_CRON).toBe('7 8 * * *');
    expect(jobs).toEqual([{ name: 'sponsorship.daily-notices', order: 1600 }]);
  });

  test('0:07の通知のジョブの時刻は、決済の確定が開始通知を依頼待ちにするかを決める時刻と同じ値を使う', () => {
    expect(SPONSORSHIP_DAILY_NOTICES_JOB_DEFINITION.at).toBe(
      SPONSORSHIP_DAILY_NOTICES_TIME,
    );
    expect(SPONSORSHIP_DAILY_NOTICES_TIME).toEqual({ hour: 0, minute: 7 });
  });

  test('4:21の起動(21 12 * * *)では、他の機能のジョブとorderが重ならず、Weekトーナメントの再処理(1500)の後・Yearトーナメントの再処理(1700)の前に日次の処理が動く', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(MAINTENANCE_CRON)
      .map(({ name, order }) => ({ name, order }));
    const index = jobs.findIndex(
      ({ name }) => name === 'sponsorship.maintenance',
    );

    expect(MAINTENANCE_CRON).toBe('21 12 * * *');
    expect(new Set(jobs.map(({ order }) => order)).size).toBe(jobs.length);
    expect(jobs.slice(index - 1, index + 2)).toEqual([
      { name: 'tournament-week.entry-follow-up', order: 1500 },
      { name: 'sponsorship.maintenance', order: 1600 },
      { name: 'tournament-year.entry-follow-up', order: 1700 },
    ]);
  });

  test('0:07の起動には予算を置かず、4:21の起動は合計の所要時間の予算(300秒)を他の機能のジョブと共有する', () => {
    const budgets = createRunBudgetTable(SCHEDULED_RUN_BUDGETS);

    expect(budgets.budgetFor(DAILY_NOTICES_CRON)).toBeUndefined();
    expect(budgets.budgetFor(MAINTENANCE_CRON)?.maxTotalDurationMs).toBe(
      300_000,
    );
  });

  test('本機能のジョブの順は、割り当てられた1600番台の帯に収まる', () => {
    for (const { order } of ALL_JOBS) {
      expect(order).toBeGreaterThanOrEqual(1600);
      expect(order).toBeLessThan(1700);
    }
  });
});
