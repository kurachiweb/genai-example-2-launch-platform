import { getConfig } from '@logtape/logtape';
import { captureEvent, captureException, withScope } from '@sentry/cloudflare';

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type {
  CronRegistry,
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../core/scheduling/cron-registry.ts';
import {
  exceedsRunBudget,
  type RunBudgetTable,
} from '../../core/scheduling/run-budget.ts';
import { toBusinessDateTime } from '../../core/time/business-time.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformEnv } from '../env/platform-env.ts';

export interface ScheduledDispatcher<E extends PlatformEnv> {
  dispatch(
    controller: ScheduledController,
    env: E,
    ctx: ExecutionContext,
  ): Promise<void>;
}

export interface ScheduledDispatcherOptions {
  readonly budgets?: RunBudgetTable;
  readonly now?: () => number;
}

type JobResult = 'succeeded' | 'failed';

interface JobOutcome {
  readonly name: string;
  readonly result: JobResult;
  readonly durationMs: number;
}

interface DispatchRun<E extends PlatformEnv> {
  readonly env: E;
  readonly ctx: ExecutionContext;
  readonly info: InvocationScopeInfo;
  readonly context: ScheduledJobContext;
}

const KIND = 'scheduled';
const NO_BUDGETS: RunBudgetTable = Object.freeze({
  budgetFor: () => undefined,
});

// Cron Triggersはapiだけに置くため、カテゴリのアプリ名はapiに固定する
const logger = getAppLogger(['api', 'scheduled', 'dispatcher']);

// 相関IDはWorkerハンドラーがログの文脈に入れるため、同じ値をコンテナにも渡す。文脈の外で呼ばれたときだけ採番する
function currentCorrelationId(): string {
  const correlationId =
    getConfig()?.contextLocalStorage?.getStore()?.['correlationId'];
  return typeof correlationId === 'string'
    ? correlationId
    : crypto.randomUUID();
}

function reportJobFailure(
  definition: ScheduledJobDefinition,
  cron: string,
  durationMs: number,
  error: unknown,
): void {
  logger.error('定期実行のジョブが失敗しました', {
    kind: KIND,
    cron,
    job: definition.name,
    durationMs,
    error,
  });
  withScope((scope) => {
    scope.setTag('job', definition.name);
    captureException(error);
  });
}

function reportBudgetExceeded(
  cron: string,
  totalDurationMs: number,
  maxTotalDurationMs: number,
  jobCount: number,
): void {
  logger.warn('定期実行の合計の所要時間が予算を超えました', {
    kind: KIND,
    cron,
    totalDurationMs,
    maxTotalDurationMs,
    jobCount,
  });
  // captureMessageの文言だけのイベントは、直前と同じ文言なら重複として捨てられ、続けて起きた超過を通知できない。文言をlogentryに置くと重複の判定から外れ、まとめ方は式ごとの指紋で決める
  captureEvent({
    level: 'warning',
    logentry: { message: '定期実行の合計の所要時間が予算を超えました' },
    fingerprint: ['scheduled-run-budget', cron],
    tags: { cron },
    contexts: {
      scheduled_run: { totalDurationMs, maxTotalDurationMs, jobCount },
    },
  });
}

export function createScheduledDispatcher<E extends PlatformEnv>(
  registry: CronRegistry,
  modules: readonly Pick<AppModule, 'bindings'>[],
  options: ScheduledDispatcherOptions = {},
): ScheduledDispatcher<E> {
  const budgets = options.budgets ?? NO_BUDGETS;
  const now = options.now ?? Date.now;

  async function runJob(
    definition: ScheduledJobDefinition,
    run: DispatchRun<E>,
  ): Promise<JobOutcome> {
    const startedAt = now();
    try {
      const container = createInvocationContainer(
        { env: run.env, executionCtx: run.ctx, info: run.info },
        modules,
      );
      const handler = await container.getAsync<ScheduledJobHandler>(
        definition.handler,
      );
      await handler.run(run.context);
      return {
        name: definition.name,
        result: 'succeeded',
        durationMs: now() - startedAt,
      };
    } catch (error) {
      const durationMs = now() - startedAt;
      reportJobFailure(definition, run.context.cron, durationMs, error);
      return { name: definition.name, result: 'failed', durationMs };
    }
  }

  async function dispatch(
    controller: ScheduledController,
    env: E,
    ctx: ExecutionContext,
  ): Promise<void> {
    const { cron } = controller;
    const definitions = registry.jobsFor(cron);
    if (definitions.length === 0) {
      logger.warn('ジョブが登録されていない時刻で定期実行が起動しました', {
        kind: KIND,
        cron,
      });
      return;
    }
    const scheduledTime = new Date(controller.scheduledTime);
    const run: DispatchRun<E> = {
      env,
      ctx,
      info: {
        kind: KIND,
        correlationId: currentCorrelationId(),
        clientIp: undefined,
      },
      context: {
        scheduledTime,
        cron,
        business: toBusinessDateTime(scheduledTime),
      },
    };
    const startedAt = now();
    const outcomes: JobOutcome[] = [];
    for (const definition of definitions) {
      outcomes.push(await runJob(definition, run));
    }
    const totalDurationMs = now() - startedAt;
    const budget = budgets.budgetFor(cron);
    if (budget !== undefined && exceedsRunBudget(budget, totalDurationMs)) {
      reportBudgetExceeded(
        cron,
        totalDurationMs,
        budget.maxTotalDurationMs,
        outcomes.length,
      );
    }
    logger.info('定期実行を終えました', {
      kind: KIND,
      cron,
      result: outcomes.every(({ result }) => result === 'succeeded')
        ? 'succeeded'
        : 'failed',
      jobs: outcomes,
      totalDurationMs,
    });
  }

  return Object.freeze({ dispatch });
}
