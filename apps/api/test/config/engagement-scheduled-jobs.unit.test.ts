import { describe, expect, test } from 'bun:test';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { createRunBudgetTable } from '../../lib/core/scheduling/run-budget.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import { COMMENT_ANONYMIZATION_JOB_DEFINITION } from '../../src/application/engagement/comment-anonymization-job.ts';
import {
  SCHEDULED_JOBS,
  SCHEDULED_RUN_BUDGETS,
} from '../../src/composition/scheduled-jobs.ts';

const DAILY_CRON = toUtcCronExpression({ hour: 4, minute: 21 });

describe('コメントの匿名化のジョブの定期実行の一覧への登録', () => {
  test('匿名化の定義を、そのまま定期実行の一覧に1つだけ載せる', () => {
    expect(
      SCHEDULED_JOBS.filter(({ name }) => name.startsWith('engagement.')),
    ).toEqual([COMMENT_ANONYMIZATION_JOB_DEFINITION]);
    expect(SCHEDULED_JOBS).toContain(COMMENT_ANONYMIZATION_JOB_DEFINITION);
  });

  test('定期実行の一覧はジョブの定義の検証(名前・時刻・同じ時刻の順序の重複の拒否)を通る', () => {
    expect(() => createCronRegistry(SCHEDULED_JOBS)).not.toThrow();
  });

  test('4:21の起動(21 12 * * *)では、他の機能のジョブとorderが重ならず、通知の保守(1300)の後・検索のキーワードの再抽出(2300)の前に匿名化が動く', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(DAILY_CRON)
      .map(({ name, order }) => ({ name, order }));
    const index = jobs.findIndex(
      ({ name }) => name === 'engagement.comment-anonymization',
    );

    expect(DAILY_CRON).toBe('21 12 * * *');
    expect(new Set(jobs.map(({ order }) => order)).size).toBe(jobs.length);
    expect(jobs.slice(index - 1, index + 2)).toEqual([
      { name: 'notifications.maintenance', order: 1300 },
      { name: 'engagement.comment-anonymization', order: 1400 },
      { name: 'content-processing.keyword-reextraction', order: 2300 },
    ]);
  });

  test('4:21の起動の合計の所要時間の予算(300秒)を、他の機能のジョブと共有する', () => {
    expect(
      createRunBudgetTable(SCHEDULED_RUN_BUDGETS).budgetFor(DAILY_CRON)
        ?.maxTotalDurationMs,
    ).toBe(300_000);
  });
});
