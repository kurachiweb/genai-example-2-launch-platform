import { describe, expect, test } from 'bun:test';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { createRunBudgetTable } from '../../lib/core/scheduling/run-budget.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import {
  YEAR_ENTRY_FOLLOW_UP_JOB_DEFINITION,
  YEAR_EVENING_BRACKET_JOB_DEFINITION,
} from '../../src/application/year-tournament/year-tournament-jobs.ts';
import {
  SCHEDULED_JOBS,
  SCHEDULED_RUN_BUDGETS,
} from '../../src/composition/scheduled-jobs.ts';

const EVENING_CRON = toUtcCronExpression({ hour: 23, minute: 45 });
const MAINTENANCE_CRON = toUtcCronExpression({ hour: 4, minute: 21 });

const ALL_JOBS = [
  YEAR_EVENING_BRACKET_JOB_DEFINITION,
  YEAR_ENTRY_FOLLOW_UP_JOB_DEFINITION,
] as const;

describe('Yearトーナメントのジョブの定期実行の一覧への登録', () => {
  test('夜の処理と再処理の定義を、そのまま定期実行の一覧に1つずつ載せる', () => {
    const registered = SCHEDULED_JOBS.filter(({ name }) =>
      name.startsWith('tournament-year.'),
    );

    expect(registered).toHaveLength(ALL_JOBS.length);
    for (const definition of ALL_JOBS) {
      expect(registered).toContain(definition);
    }
  });

  test('定期実行の一覧はジョブの定義の検証(名前・時刻・同じ時刻の順序の重複の拒否)を通る', () => {
    expect(() => createCronRegistry(SCHEDULED_JOBS)).not.toThrow();
  });

  test('23:45の起動(45 7 * * *)では、マッチのペアリング(1100)・通知の夜の枠(1300)・Weekトーナメントの夜の処理(1500)の後に夜の処理が最後に動く', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(EVENING_CRON)
      .map(({ name, order }) => ({ name, order }));

    expect(EVENING_CRON).toBe('45 7 * * *');
    expect(jobs).toEqual([
      { name: 'match-engine.qualifier-pairing', order: 1100 },
      { name: 'notifications.evening-dispatch', order: 1300 },
      { name: 'tournament-week.evening-bracket', order: 1500 },
      { name: 'tournament-year.evening-bracket', order: 1700 },
    ]);
  });

  test('4:21の起動(21 12 * * *)では、他の機能のジョブとorderが重ならず、スポンサー広告の日次の処理(1600)の後・検索のキーワードの再抽出(2300)の前に再処理が動く', () => {
    const jobs = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(MAINTENANCE_CRON)
      .map(({ name, order }) => ({ name, order }));
    const index = jobs.findIndex(
      ({ name }) => name === 'tournament-year.entry-follow-up',
    );

    expect(MAINTENANCE_CRON).toBe('21 12 * * *');
    expect(new Set(jobs.map(({ order }) => order)).size).toBe(jobs.length);
    expect(jobs.slice(index - 1, index + 2)).toEqual([
      { name: 'sponsorship.maintenance', order: 1600 },
      { name: 'tournament-year.entry-follow-up', order: 1700 },
      { name: 'content-processing.keyword-reextraction', order: 2300 },
    ]);
  });

  test('2つの起動時刻は、合計の所要時間の予算(300秒)を他の機能のジョブと共有する', () => {
    const budgets = createRunBudgetTable(SCHEDULED_RUN_BUDGETS);

    for (const cron of [EVENING_CRON, MAINTENANCE_CRON]) {
      expect(budgets.budgetFor(cron)?.maxTotalDurationMs).toBe(300_000);
    }
  });

  test('本機能のジョブの順は、割り当てられた1700番台の帯に収まる', () => {
    for (const { order } of ALL_JOBS) {
      expect(order).toBeGreaterThanOrEqual(1700);
      expect(order).toBeLessThan(1800);
    }
  });
});
