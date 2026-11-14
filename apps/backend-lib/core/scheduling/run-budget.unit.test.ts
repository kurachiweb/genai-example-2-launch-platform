import { describe, expect, test } from 'bun:test';

import { CronRegistryError } from './cron-registry.ts';
import {
  createRunBudgetTable,
  exceedsRunBudget,
  type ScheduledRunBudget,
} from './run-budget.ts';

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  return undefined;
}

const DAILY_CLEANUP_BUDGET: ScheduledRunBudget = {
  at: { hour: 4, minute: 21 },
  maxTotalDurationMs: 300_000,
};
const RECONCILIATION_BUDGET: ScheduledRunBudget = {
  at: { hour: 23, minute: 40 },
  maxTotalDurationMs: 60_000,
};

describe('createRunBudgetTable', () => {
  test('4:21の予算をUTCのcron式21 12 * * *で引ける', () => {
    const table = createRunBudgetTable([DAILY_CLEANUP_BUDGET]);

    expect(table.budgetFor('21 12 * * *')).toEqual(DAILY_CLEANUP_BUDGET);
  });

  test('複数の時刻の予算をそれぞれの式で引ける', () => {
    const table = createRunBudgetTable([
      DAILY_CLEANUP_BUDGET,
      RECONCILIATION_BUDGET,
    ]);

    expect(table.budgetFor('21 12 * * *')).toEqual(DAILY_CLEANUP_BUDGET);
    expect(table.budgetFor('40 7 * * *')).toEqual(RECONCILIATION_BUDGET);
  });

  test('予算の無い式はundefinedになる', () => {
    const table = createRunBudgetTable([DAILY_CLEANUP_BUDGET]);

    expect(table.budgetFor('22 12 * * *')).toBeUndefined();
    expect(table.budgetFor('21 4 * * *')).toBeUndefined();
    expect(table.budgetFor('')).toBeUndefined();
  });

  test('予算が1つも無ければどの式もundefinedになる', () => {
    const table = createRunBudgetTable([]);

    expect(table.budgetFor('21 12 * * *')).toBeUndefined();
  });

  test('ジョブの登録と独立に、ジョブの無い時刻の予算も受け付ける', () => {
    const table = createRunBudgetTable([
      { at: { hour: 0, minute: 0 }, maxTotalDurationMs: 1 },
    ]);

    expect(table.budgetFor('0 8 * * *')).toEqual({
      at: { hour: 0, minute: 0 },
      maxTotalDurationMs: 1,
    });
  });

  test('作成後に呼び出し側が予算を変えても表の予算は変わらない', () => {
    const at = { hour: 4, minute: 21 };
    const budget = { at, maxTotalDurationMs: 300_000 };
    const budgets = [budget];
    const table = createRunBudgetTable(budgets);

    budget.maxTotalDurationMs = 1;
    at.minute = 22;
    budgets.push({ at: { hour: 23, minute: 40 }, maxTotalDurationMs: 1 });

    expect(table.budgetFor('21 12 * * *')).toEqual(DAILY_CLEANUP_BUDGET);
    expect(Object.isFrozen(table.budgetFor('21 12 * * *'))).toBe(true);
    expect(table.budgetFor('40 7 * * *')).toBeUndefined();
  });

  test('同じ時刻の予算が2つあるとCronRegistryErrorになる', () => {
    const budgets = [
      DAILY_CLEANUP_BUDGET,
      { at: { hour: 4, minute: 21 }, maxTotalDurationMs: 600_000 },
    ];

    expect(() => createRunBudgetTable(budgets)).toThrow(CronRegistryError);
    expect(() => createRunBudgetTable(budgets)).toThrow('21 12 * * *');
  });

  test.each([
    { hour: 24, minute: 0 },
    { hour: -1, minute: 0 },
    { hour: 4, minute: 60 },
    { hour: 4, minute: -1 },
    { hour: 4.5, minute: 0 },
    { hour: 4, minute: 21.5 },
    { hour: Number.NaN, minute: 0 },
  ])(
    '範囲外の業務時刻%pは範囲の誤りを原因に持つCronRegistryErrorになる',
    (at) => {
      const budgets = [{ at, maxTotalDurationMs: 300_000 }];

      const error = captureError(() => createRunBudgetTable(budgets));

      expect(error).toBeInstanceOf(CronRegistryError);
      expect((error as CronRegistryError).cause).toBeInstanceOf(RangeError);
    },
  );

  test.each([0, -1, 0.5, 299_999.5, Number.NaN, Number.POSITIVE_INFINITY])(
    '正の整数でない予算%pはCronRegistryErrorになる',
    (maxTotalDurationMs) => {
      const budgets = [{ at: { hour: 4, minute: 21 }, maxTotalDurationMs }];

      expect(() => createRunBudgetTable(budgets)).toThrow(CronRegistryError);
      expect(() => createRunBudgetTable(budgets)).toThrow(
        String(maxTotalDurationMs),
      );
    },
  );

  test('境界の0:00と23:59と予算1msは受け付ける', () => {
    const table = createRunBudgetTable([
      { at: { hour: 0, minute: 0 }, maxTotalDurationMs: 1 },
      { at: { hour: 23, minute: 59 }, maxTotalDurationMs: 1 },
    ]);

    expect(table.budgetFor('0 8 * * *')?.maxTotalDurationMs).toBe(1);
    expect(table.budgetFor('59 7 * * *')?.maxTotalDurationMs).toBe(1);
  });
});

describe('exceedsRunBudget', () => {
  test('合計が予算ちょうどの300,000msなら超過しない', () => {
    expect(exceedsRunBudget(DAILY_CLEANUP_BUDGET, 300_000)).toBe(false);
  });

  test('合計が予算より1ms大きい300,001msなら超過する', () => {
    expect(exceedsRunBudget(DAILY_CLEANUP_BUDGET, 300_001)).toBe(true);
  });

  test('合計が予算より小さければ超過しない', () => {
    expect(exceedsRunBudget(DAILY_CLEANUP_BUDGET, 0)).toBe(false);
    expect(exceedsRunBudget(DAILY_CLEANUP_BUDGET, 299_999)).toBe(false);
  });
});
