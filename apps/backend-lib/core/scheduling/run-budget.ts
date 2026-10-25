import {
  type BusinessTimeOfDay,
  toUtcCronExpression,
} from '../time/business-time.ts';
import { CronRegistryError } from './cron-registry.ts';

export interface ScheduledRunBudget {
  readonly at: BusinessTimeOfDay;
  readonly maxTotalDurationMs: number;
}

export interface RunBudgetTable {
  budgetFor(cron: string): ScheduledRunBudget | undefined;
}

function cronExpressionOf(budget: ScheduledRunBudget): string {
  try {
    return toUtcCronExpression(budget.at);
  } catch (error) {
    throw new CronRegistryError('時間の予算の業務時刻が範囲外です', {
      cause: error,
    });
  }
}

function assertMaxTotalDuration(
  cron: string,
  budget: ScheduledRunBudget,
): void {
  const { maxTotalDurationMs } = budget;
  if (!Number.isInteger(maxTotalDurationMs) || maxTotalDurationMs <= 0) {
    throw new CronRegistryError(
      `時刻(${cron})の時間の予算は正の整数のミリ秒で指定してください: ${String(maxTotalDurationMs)}`,
    );
  }
}

function freezeBudget(budget: ScheduledRunBudget): ScheduledRunBudget {
  return Object.freeze({
    at: Object.freeze({ hour: budget.at.hour, minute: budget.at.minute }),
    maxTotalDurationMs: budget.maxTotalDurationMs,
  });
}

export function createRunBudgetTable(
  budgets: readonly ScheduledRunBudget[],
): RunBudgetTable {
  const budgetsByCron = new Map<string, ScheduledRunBudget>();
  for (const budget of budgets) {
    const cron = cronExpressionOf(budget);
    assertMaxTotalDuration(cron, budget);
    if (budgetsByCron.has(cron)) {
      throw new CronRegistryError(
        `同じ時刻(${cron})の時間の予算が重複しています`,
      );
    }
    budgetsByCron.set(cron, freezeBudget(budget));
  }
  return Object.freeze({
    budgetFor: (cron: string) => budgetsByCron.get(cron),
  });
}

export function exceedsRunBudget(
  budget: ScheduledRunBudget,
  totalDurationMs: number,
): boolean {
  return totalDurationMs > budget.maxTotalDurationMs;
}
