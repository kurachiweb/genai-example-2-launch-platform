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
import { IDENTITY_TYPES } from '../../src/application/identity/identity-types.ts';
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
const REDISPATCH_RUN_AT = { hour: 16, minute: 21 } as const;

const IDENTITY_DAILY_JOBS = [
  {
    name: 'identity-auth.purge-orchestrator',
    at: DAILY_RUN_AT,
    order: 100,
    handler: IDENTITY_TYPES.PurgeOrchestratorJob,
  },
  {
    name: 'identity-auth.credential-cleanup',
    at: DAILY_RUN_AT,
    order: 110,
    handler: IDENTITY_TYPES.CredentialCleanupJob,
  },
  {
    name: 'identity-auth.disposable-recheck-sweep',
    at: DAILY_RUN_AT,
    order: 120,
    handler: IDENTITY_TYPES.DisposableRecheckSweepJob,
  },
] as const;

const IDENTITY_REDISPATCH_JOB = {
  name: 'identity-auth.lifecycle-redispatch',
  at: REDISPATCH_RUN_AT,
  order: 100,
  handler: IDENTITY_TYPES.LifecycleRedispatchJob,
} as const;

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

describe('利用者のアカウントの日次のジョブの登録', () => {
  test('3つのジョブを業務時刻4:21に順序100・110・120で、送り直しのジョブを業務時刻16:21に順序100で登録する', () => {
    const identityJobs = SCHEDULED_JOBS.filter(({ name }) =>
      name.startsWith('identity-auth.'),
    );

    expect(identityJobs).toEqual([
      ...IDENTITY_DAILY_JOBS,
      IDENTITY_REDISPATCH_JOB,
    ]);
  });

  test('4:21の起動で、3つのジョブが他のドメインのジョブより先に物理削除の開始・期限切れの削除・判定し直しの順に動く', () => {
    const names = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(toUtcCronExpression(DAILY_RUN_AT))
      .map(({ name }) => name);

    expect(names.slice(0, IDENTITY_DAILY_JOBS.length)).toEqual(
      IDENTITY_DAILY_JOBS.map(({ name }) => name),
    );
  });

  test('16:21の起動は式21 0 * * *で、送り直しのジョブだけが動く', () => {
    const cron = toUtcCronExpression(REDISPATCH_RUN_AT);

    expect(cron).toBe('21 0 * * *');
    expect(
      createCronRegistry(SCHEDULED_JOBS)
        .jobsFor(cron)
        .map(({ name }) => name),
    ).toEqual([IDENTITY_REDISPATCH_JOB.name]);
  });

  test.each(WRANGLER_ENVIRONMENTS)(
    '定期実行の定義($label)に、4:21の式21 12 * * *と16:21の式21 0 * * *がある',
    ({ wranglerEnv }) => {
      const crons = readTriggerCrons(wranglerEnv);

      expect(crons).toContain('21 12 * * *');
      expect(crons).toContain('21 0 * * *');
    },
  );
});

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

  test('16:21の起動には予算を置かない', () => {
    expect(
      createRunBudgetTable(SCHEDULED_RUN_BUDGETS).budgetFor(
        toUtcCronExpression(REDISPATCH_RUN_AT),
      ),
    ).toBeUndefined();
  });

  test('予算は4:21の1件だけを登録する', () => {
    expect(SCHEDULED_RUN_BUDGETS).toEqual([
      { at: DAILY_RUN_AT, maxTotalDurationMs: DAILY_RUN_BUDGET_MS },
    ]);
  });
});
