import type { ScheduledJobDefinition } from '../../lib/core/scheduling/cron-registry.ts';
import type { ScheduledRunBudget } from '../../lib/core/scheduling/run-budget.ts';

export const SCHEDULED_JOBS: readonly ScheduledJobDefinition[] = [];

// 4:21の起動には複数のドメインのジョブが順に集まるため、1回の起動の合計の所要時間に予算を置き、超過を警告する。ジョブの無い時刻の予算は誤りにならない
export const SCHEDULED_RUN_BUDGETS: readonly ScheduledRunBudget[] = [
  { at: { hour: 4, minute: 21 }, maxTotalDurationMs: 300_000 },
];
