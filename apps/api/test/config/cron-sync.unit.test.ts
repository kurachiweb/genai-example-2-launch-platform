import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { unstable_readConfig } from 'wrangler';
import { z } from 'zod';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import {
  createRunBudgetTable,
  exceedsRunBudget,
} from '../../lib/core/scheduling/run-budget.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import {
  SCHEDULED_JOBS,
  SCHEDULED_RUN_BUDGETS,
} from '../../src/composition/scheduled-jobs.ts';

const API_WRANGLER_CONFIG = join(
  import.meta.dirname,
  '..',
  '..',
  'wrangler.jsonc',
);

const WRANGLER_ENVIRONMENTS = [
  { label: 'ローカル(ルート)', wranglerEnv: undefined },
  { label: 'staging', wranglerEnv: 'staging' },
  { label: 'prod', wranglerEnv: 'prod' },
] as const;

const triggersSchema = z.object({
  triggers: z.object({ crons: z.array(z.string()).optional() }),
});

const DAILY_RUN_AT = { hour: 4, minute: 21 } as const;
const DAILY_RUN_BUDGET_MS = 300_000;

function readTriggerCrons(wranglerEnv: string | undefined): readonly string[] {
  const raw: unknown = unstable_readConfig(
    { config: API_WRANGLER_CONFIG, env: wranglerEnv },
    { hideWarnings: true },
  );
  return triggersSchema.parse(raw).triggers.crons ?? [];
}

describe.each(WRANGLER_ENVIRONMENTS)(
  '定期実行の定義との一致($label)',
  ({ wranglerEnv }) => {
    test('登録したジョブの業務時刻から導いたcron式と、Wrangler設定の定期実行の定義が順序を問わず一致する', () => {
      const registered = createCronRegistry(SCHEDULED_JOBS).cronExpressions();

      // 下流specはtriggers.crons内の位置を定めないため、同じ規則で並べ替えてから比べる
      expect(readTriggerCrons(wranglerEnv).toSorted()).toEqual(
        registered.toSorted(),
      );
    });
  },
);

describe('起動時刻ごとの時間の予算の登録', () => {
  test('4:21の1回の起動の予算が、式21 12 * * *で300,000msとして引ける', () => {
    const cron = toUtcCronExpression(DAILY_RUN_AT);
    const budget = createRunBudgetTable(SCHEDULED_RUN_BUDGETS).budgetFor(cron);

    expect(cron).toBe('21 12 * * *');
    expect(budget?.maxTotalDurationMs).toBe(DAILY_RUN_BUDGET_MS);
  });

  test('登録した予算で、300,000msは超過にならず300,001msは超過になる', () => {
    const budget = createRunBudgetTable(SCHEDULED_RUN_BUDGETS).budgetFor(
      '21 12 * * *',
    );
    if (budget === undefined) {
      throw new Error('4:21の予算が登録されていません');
    }

    expect(exceedsRunBudget(budget, DAILY_RUN_BUDGET_MS)).toBe(false);
    expect(exceedsRunBudget(budget, DAILY_RUN_BUDGET_MS + 1)).toBe(true);
  });

  test('予算は4:21の1件だけを登録する', () => {
    expect(SCHEDULED_RUN_BUDGETS).toEqual([
      { at: DAILY_RUN_AT, maxTotalDurationMs: DAILY_RUN_BUDGET_MS },
    ]);
  });
});
