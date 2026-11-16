import { describe, expect, test } from 'bun:test';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { createRunBudgetTable } from '../../lib/core/scheduling/run-budget.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import {
  EVENING_DISPATCH_JOB_DEFINITION,
  MORNING_DISPATCH_JOB_DEFINITION,
  NOTIFICATION_MAINTENANCE_JOB_DEFINITION,
} from '../../src/application/notifications/notification-jobs.ts';
import { NOTIFICATIONS_TYPES } from '../../src/application/notifications/notifications-types.ts';
import {
  SCHEDULED_JOBS,
  SCHEDULED_RUN_BUDGETS,
} from '../../src/composition/scheduled-jobs.ts';

const EVENING_CRON = toUtcCronExpression({ hour: 23, minute: 45 });
const MORNING_CRON = toUtcCronExpression({ hour: 0, minute: 0 });
const MAINTENANCE_CRON = toUtcCronExpression({ hour: 4, minute: 21 });

const ALL_JOBS = [
  EVENING_DISPATCH_JOB_DEFINITION,
  MORNING_DISPATCH_JOB_DEFINITION,
  NOTIFICATION_MAINTENANCE_JOB_DEFINITION,
] as const;

describe('通知のジョブの定期実行の一覧への登録', () => {
  test('夜の枠・朝の枠・保守の3つの定義を、業務時刻23:45・0:00・4:21とorder 1300で定める', () => {
    expect(ALL_JOBS).toEqual([
      {
        name: 'notifications.evening-dispatch',
        at: { hour: 23, minute: 45 },
        order: 1300,
        handler: NOTIFICATIONS_TYPES.EveningDispatchJob,
      },
      {
        name: 'notifications.morning-dispatch',
        at: { hour: 0, minute: 0 },
        order: 1300,
        handler: NOTIFICATIONS_TYPES.MorningDispatchJob,
      },
      {
        name: 'notifications.maintenance',
        at: { hour: 4, minute: 21 },
        order: 1300,
        handler: NOTIFICATIONS_TYPES.NotificationMaintenanceJob,
      },
    ]);
  });

  test('3つの定義を、そのまま定期実行の一覧に載せる', () => {
    for (const definition of ALL_JOBS) {
      expect(SCHEDULED_JOBS).toContain(definition);
    }
  });

  test('定期実行の一覧はジョブの定義の検証(名前・時刻・同じ時刻の順序の重複の拒否)を通る', () => {
    expect(() => createCronRegistry(SCHEDULED_JOBS)).not.toThrow();
  });

  test('23:45の起動(45 7 * * *)と0:00の起動(0 8 * * *)では、マッチのジョブ(order 1100)の後に通知のジョブが動く', () => {
    const registry = createCronRegistry(SCHEDULED_JOBS);
    const namesAndOrders = (cron: string) =>
      registry.jobsFor(cron).map(({ name, order }) => ({ name, order }));

    expect(EVENING_CRON).toBe('45 7 * * *');
    expect(MORNING_CRON).toBe('0 8 * * *');
    expect(namesAndOrders(EVENING_CRON)).toEqual([
      { name: 'match-engine.qualifier-pairing', order: 1100 },
      { name: 'notifications.evening-dispatch', order: 1300 },
    ]);
    expect(namesAndOrders(MORNING_CRON)).toEqual([
      { name: 'match-engine.match-kickoff', order: 1100 },
      { name: 'notifications.morning-dispatch', order: 1300 },
    ]);
  });

  test('4:21の起動(21 12 * * *)では、他の機能のジョブとorderが重ならず、マッチのイベントの削除の後・コメントの匿名化の前に保守が動く', () => {
    const names = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(MAINTENANCE_CRON)
      .map(({ name }) => name);
    const orders = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(MAINTENANCE_CRON)
      .map(({ order }) => order);
    const index = names.indexOf('notifications.maintenance');

    expect(MAINTENANCE_CRON).toBe('21 12 * * *');
    expect(new Set(orders).size).toBe(orders.length);
    expect(names.slice(index - 1, index + 2)).toEqual([
      'match-engine.event-cleanup',
      'notifications.maintenance',
      'engagement.comment-anonymization',
    ]);
  });

  test('3つの起動時刻はいずれも、合計の所要時間の予算(300秒)を他の機能のジョブと共有する', () => {
    const budgets = createRunBudgetTable(SCHEDULED_RUN_BUDGETS);

    for (const cron of [EVENING_CRON, MORNING_CRON, MAINTENANCE_CRON]) {
      expect(budgets.budgetFor(cron)?.maxTotalDurationMs).toBe(300_000);
    }
  });

  test('本機能のジョブの順は、割り当てられた1300番台の帯に収まる', () => {
    for (const { order } of ALL_JOBS) {
      expect(order).toBeGreaterThanOrEqual(1300);
      expect(order).toBeLessThan(1400);
    }
  });
});
