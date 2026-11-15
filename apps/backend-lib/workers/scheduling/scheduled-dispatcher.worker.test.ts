import { resetSync, withContext } from '@logtape/logtape';
import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { ContainerModule } from 'inversify';
import { afterAll, describe, expect, test } from 'vitest';

import type { Database } from '../../../db/client.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import {
  createCronRegistry,
  type CronRegistry,
  type ScheduledJobContext,
  type ScheduledJobDefinition,
  type ScheduledJobHandler,
} from '../../core/scheduling/cron-registry.ts';
import {
  createRunBudgetTable,
  type ScheduledRunBudget,
} from '../../core/scheduling/run-budget.ts';
import {
  type BusinessTimeOfDay,
  toUtcCronExpression,
} from '../../core/time/business-time.ts';
import type { InvocationScope } from '../di/invocation-container.ts';
import type { PlatformEnv } from '../env/platform-env.ts';
import { ensureLoggingConfigured } from '../logging/configure-logging.ts';
import {
  buildSentryOptions,
  withSentryForScheduledAndQueue,
} from '../observability/sentry.ts';
import {
  createScheduledDispatcher,
  type ScheduledDispatcherOptions,
} from './scheduled-dispatcher.ts';

type TestEnv = typeof env;

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

interface RecordingFetch {
  readonly fetch: typeof fetch;
  readonly items: SentItem[];
}

interface JobRun {
  readonly name: string;
  readonly context: ScheduledJobContext;
  readonly scope: InvocationScope<PlatformEnv>;
  readonly database: Database;
}

interface TestJob {
  readonly name: string;
  readonly at: BusinessTimeOfDay;
  readonly order: number;
  readonly elapseMs?: number;
  readonly failure?: Error;
}

interface DispatchResult {
  readonly runs: readonly JobRun[];
  readonly logs: readonly LoggedObject[];
  readonly events: readonly SentItem[];
}

interface DispatchInput {
  readonly jobs: readonly TestJob[];
  readonly cron: string;
  readonly budgets?: readonly ScheduledRunBudget[];
  readonly registry?: CronRegistry;
  readonly fetch?: RecordingFetch;
  readonly withoutOptions?: boolean;
  readonly repeat?: number;
}

const DISPATCHER_CATEGORY = 'api.scheduled.dispatcher';
const CORRELATION_ID = 'correlation-scheduled';
const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);
const AT_4_21: BusinessTimeOfDay = { hour: 4, minute: 21 };
const AT_6_00: BusinessTimeOfDay = { hour: 6, minute: 0 };
const CRON_4_21 = toUtcCronExpression(AT_4_21);
// 業務時刻の2026-10-24(土)4:21
const SCHEDULED_TIME = new Date('2026-10-24T12:21:00.000Z');

function createRecordingConsole(logs: LoggedObject[]): Console {
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  return {
    debug: record,
    info: record,
    warn: record,
    error: record,
  } as unknown as Console;
}

function decodeBody(body: RequestInit['body']): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  throw new TypeError('想定外の送信本文の形式です');
}

// エンベロープは改行区切りのJSONで、先頭のヘッダーの後に項目のヘッダーと本体が交互に並ぶ
function parseEnvelope(text: string): SentItem[] {
  const [, ...lines] = text.split('\n').filter((line) => line !== '');
  const items: SentItem[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const header = JSON.parse(lines[index] ?? '') as { type: string };
    const payload = JSON.parse(lines[index + 1] ?? '') as Record<
      string,
      unknown
    >;
    items.push({ type: header.type, payload });
  }
  return items;
}

function createRecordingFetch(): RecordingFetch {
  const items: SentItem[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    items.push(...parseEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  return { fetch: recordingFetch as typeof fetch, items };
}

function createFailingFetch(): RecordingFetch {
  const failingFetch = () =>
    Promise.reject(new TypeError('送信先に接続できません'));
  return { fetch: failingFetch as unknown as typeof fetch, items: [] };
}

function jobIdentifier(name: string): symbol {
  return Symbol.for(`test.scheduled-job.${name}`);
}

function toDefinition(job: TestJob): ScheduledJobDefinition {
  return {
    name: job.name,
    at: job.at,
    order: job.order,
    handler: jobIdentifier(job.name),
  };
}

// 時計はジョブの実行中にだけ進め、所要時間をジョブごとの経過時間の和として決める
function createJobModule(
  jobs: readonly TestJob[],
  runs: JobRun[],
  clock: { current: number },
): ContainerModule {
  return new ContainerModule(({ bind }) => {
    for (const job of jobs) {
      bind<ScheduledJobHandler>(jobIdentifier(job.name)).toDynamicValue(
        (context) => ({
          run: (jobContext) => {
            runs.push({
              name: job.name,
              context: jobContext,
              scope: context.get<InvocationScope<PlatformEnv>>(
                PLATFORM_TYPES.InvocationScope,
              ),
              database: context.get<Database>(PLATFORM_TYPES.Database),
            });
            clock.current += job.elapseMs ?? 0;
            return job.failure === undefined
              ? Promise.resolve()
              : Promise.reject(job.failure);
          },
        }),
      );
    }
  });
}

function sentryOptions(recording: RecordingFetch): () => CloudflareOptions {
  // 呼び出しごとに送信先を変えて確かめるため、isolateでのクライアントの使い回しを切る
  return () => ({
    ...buildSentryOptions({
      dsn: TEST_DSN,
      environment: 'test',
      tracesSampleRate: 0,
    }),
    cacheClient: false,
    transportOptions: { fetch: recording.fetch },
  });
}

async function dispatch(input: DispatchInput): Promise<DispatchResult> {
  const runs: JobRun[] = [];
  const logs: LoggedObject[] = [];
  const clock = { current: 1_000 };
  const recording = input.fetch ?? createRecordingFetch();
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: createRecordingConsole(logs),
  });
  const options: ScheduledDispatcherOptions = {
    budgets: createRunBudgetTable(input.budgets ?? []),
    now: () => clock.current,
  };
  const dispatcher = createScheduledDispatcher<TestEnv>(
    input.registry ?? createCronRegistry(input.jobs.map(toDefinition)),
    [{ bindings: createJobModule(input.jobs, runs, clock) }],
    input.withoutOptions === true ? undefined : options,
  );
  const handler = withSentryForScheduledAndQueue<TestEnv>(
    sentryOptions(recording),
    {
      // 同じクライアントで続けて起動した場合を確かめるため、1回の呼び出しの中で指定の回数だけ振り分ける
      scheduled: async (controller, scheduledEnv, ctx) => {
        for (let count = 0; count < (input.repeat ?? 1); count += 1) {
          await dispatcher.dispatch(controller, scheduledEnv, ctx);
        }
      },
    },
  );
  const ctx = createExecutionContext();

  await withContext({ correlationId: CORRELATION_ID }, () =>
    handler.scheduled?.(
      createScheduledController({
        scheduledTime: SCHEDULED_TIME,
        cron: input.cron,
      }),
      env,
      ctx,
    ),
  );
  await waitOnExecutionContext(ctx);

  return {
    runs,
    logs: logs.filter(({ category }) => category === DISPATCHER_CATEGORY),
    events: recording.items.filter(({ type }) => type === 'event'),
  };
}

function logsAt(result: DispatchResult, level: string): LoggedObject[] {
  return result.logs.filter((logged) => logged.level === level);
}

function eventsAt(result: DispatchResult, level: string): SentItem[] {
  return result.events.filter(({ payload }) => payload.level === level);
}

function summaryOf(result: DispatchResult): LoggedObject | undefined {
  return logsAt(result, 'info').at(-1);
}

function exceptionValues(item: SentItem): string[] {
  const exception = item.payload.exception as
    { values?: { value?: string }[] } | undefined;
  return (exception?.values ?? []).map(({ value }) => value ?? '');
}

afterAll(() => {
  resetSync();
});

describe('createScheduledDispatcher', () => {
  test('起動した式のジョブを登録の順に、ジョブごとの新しいコンテナで、予定時刻の業務日付・曜日を渡して実行する', async () => {
    const result = await dispatch({
      cron: CRON_4_21,
      jobs: [
        { name: 'weekly-ranking', at: AT_4_21, order: 2 },
        { name: 'daily-ranking', at: AT_4_21, order: 1 },
        { name: 'morning-digest', at: AT_6_00, order: 1 },
      ],
    });

    expect(result.runs.map(({ name }) => name)).toStrictEqual([
      'daily-ranking',
      'weekly-ranking',
    ]);
    for (const run of result.runs) {
      expect(run.context).toStrictEqual({
        scheduledTime: SCHEDULED_TIME,
        cron: CRON_4_21,
        business: { date: '2026-10-24', weekday: 6, hour: 4, minute: 21 },
      });
      expect(run.scope.info).toStrictEqual({
        kind: 'scheduled',
        correlationId: CORRELATION_ID,
        clientIp: undefined,
      });
    }
    const [first, second] = result.runs as [JobRun, JobRun];
    expect(first.database).not.toBe(second.database);
    expect(first.scope).not.toBe(second.scope);
  });

  test('1つ目のジョブが失敗しても2つ目を実行し、失敗をエラーログとエラートラッキングへ送る', async () => {
    const result = await dispatch({
      cron: CRON_4_21,
      jobs: [
        {
          name: 'daily-ranking',
          at: AT_4_21,
          order: 1,
          elapseMs: 40,
          failure: new Error('集計に失敗しました'),
        },
        { name: 'weekly-ranking', at: AT_4_21, order: 2, elapseMs: 60 },
      ],
    });

    expect(result.runs.map(({ name }) => name)).toStrictEqual([
      'daily-ranking',
      'weekly-ranking',
    ]);
    const errors = logsAt(result, 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      kind: 'scheduled',
      cron: CRON_4_21,
      job: 'daily-ranking',
      durationMs: 40,
      correlationId: CORRELATION_ID,
      error: { name: 'Error', message: '集計に失敗しました' },
    });
    const exceptions = eventsAt(result, 'error');
    expect(exceptions).toHaveLength(1);
    expect(exceptionValues(exceptions[0] as SentItem)).toStrictEqual([
      '集計に失敗しました',
    ]);
    expect(exceptions[0]?.payload.tags).toMatchObject({ job: 'daily-ranking' });
    expect(summaryOf(result)).toMatchObject({
      result: 'failed',
      jobs: [
        { name: 'daily-ranking', result: 'failed', durationMs: 40 },
        { name: 'weekly-ranking', result: 'succeeded', durationMs: 60 },
      ],
      totalDurationMs: 100,
    });
  });

  test('ジョブの無い式で起動すると、ジョブを実行せずに警告のログだけを出す', async () => {
    const result = await dispatch({
      cron: '0 0 * * *',
      jobs: [{ name: 'daily-ranking', at: AT_4_21, order: 1 }],
    });

    expect(result.runs).toStrictEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]).toMatchObject({
      level: 'warning',
      kind: 'scheduled',
      cron: '0 0 * * *',
      correlationId: CORRELATION_ID,
    });
    expect(result.events).toStrictEqual([]);
  });

  test('ジョブが1つも登録されていなければ、警告のログだけを出して失敗せずに終える', async () => {
    const result = await dispatch({
      cron: CRON_4_21,
      jobs: [],
      registry: createCronRegistry([]),
      withoutOptions: true,
    });

    expect(result.runs).toStrictEqual([]);
    expect(result.logs.map(({ level }) => level)).toStrictEqual(['warning']);
    expect(result.events).toStrictEqual([]);
  });

  test('最後に、処理の種別・結果・ジョブごとの所要時間・全ジョブの合計の所要時間の要約を出す', async () => {
    const result = await dispatch({
      cron: CRON_4_21,
      jobs: [
        { name: 'daily-ranking', at: AT_4_21, order: 1, elapseMs: 120 },
        { name: 'weekly-ranking', at: AT_4_21, order: 2, elapseMs: 80 },
      ],
    });

    expect(result.logs.map(({ level }) => level)).toStrictEqual(['info']);
    const summary = summaryOf(result);
    expect(summary?.time).toEqual(expect.any(String));
    expect(summary).toStrictEqual({
      time: summary?.time,
      level: 'info',
      category: DISPATCHER_CATEGORY,
      message: '定期実行を終えました',
      correlationId: CORRELATION_ID,
      kind: 'scheduled',
      cron: CRON_4_21,
      result: 'succeeded',
      jobs: [
        { name: 'daily-ranking', result: 'succeeded', durationMs: 120 },
        { name: 'weekly-ranking', result: 'succeeded', durationMs: 80 },
      ],
      totalDurationMs: 200,
    });
  });

  test('時計を渡さなければ実時間で計り、要約に合計の所要時間を出す', async () => {
    const result = await dispatch({
      cron: CRON_4_21,
      jobs: [{ name: 'daily-ranking', at: AT_4_21, order: 1 }],
      withoutOptions: true,
    });

    expect(result.runs).toHaveLength(1);
    expect(summaryOf(result)?.totalDurationMs).toEqual(expect.any(Number));
    expect(result.events).toStrictEqual([]);
  });
});

describe('createScheduledDispatcher(時間の予算)', () => {
  const BUDGET: ScheduledRunBudget = { at: AT_4_21, maxTotalDurationMs: 300 };

  test('合計の所要時間が予算を1ms超えると、要約の前に警告のログとエラートラッキングのwarningを1回送る', async () => {
    const result = await dispatch({
      cron: CRON_4_21,
      budgets: [BUDGET],
      jobs: [
        { name: 'daily-ranking', at: AT_4_21, order: 1, elapseMs: 200 },
        { name: 'weekly-ranking', at: AT_4_21, order: 2, elapseMs: 101 },
      ],
    });

    expect(result.logs.map(({ level }) => level)).toStrictEqual([
      'warning',
      'info',
    ]);
    expect(result.logs[0]).toMatchObject({
      kind: 'scheduled',
      cron: CRON_4_21,
      totalDurationMs: 301,
      maxTotalDurationMs: 300,
      correlationId: CORRELATION_ID,
    });
    expect(result.events).toHaveLength(1);
    const [warning] = eventsAt(result, 'warning') as [SentItem];
    expect(warning.payload.tags).toMatchObject({ cron: CRON_4_21 });
    expect(warning.payload.contexts).toMatchObject({
      scheduled_run: {
        totalDurationMs: 301,
        maxTotalDurationMs: 300,
        jobCount: 2,
      },
    });
    expect(summaryOf(result)).toMatchObject({
      result: 'succeeded',
      totalDurationMs: 301,
    });
  });

  test('同じクライアントで続けて2回予算を超えると、2回ともエラートラッキングへwarningを送る', async () => {
    const result = await dispatch({
      cron: CRON_4_21,
      budgets: [BUDGET],
      jobs: [{ name: 'daily-ranking', at: AT_4_21, order: 1, elapseMs: 301 }],
      repeat: 2,
    });

    expect(logsAt(result, 'warning')).toHaveLength(2);
    const warnings = eventsAt(result, 'warning');
    expect(warnings).toHaveLength(2);
    expect(warnings.map(({ payload }) => payload.fingerprint)).toStrictEqual([
      ['scheduled-run-budget', CRON_4_21],
      ['scheduled-run-budget', CRON_4_21],
    ]);
  });

  test('ジョブの失敗を含んでも、合計が予算を超えれば警告を送る', async () => {
    const result = await dispatch({
      cron: CRON_4_21,
      budgets: [BUDGET],
      jobs: [
        {
          name: 'daily-ranking',
          at: AT_4_21,
          order: 1,
          elapseMs: 301,
          failure: new Error('集計に失敗しました'),
        },
      ],
    });

    expect(logsAt(result, 'warning')).toHaveLength(1);
    expect(eventsAt(result, 'warning')).toHaveLength(1);
    expect(eventsAt(result, 'error')).toHaveLength(1);
  });

  test.each<{
    readonly title: string;
    readonly budgets: readonly ScheduledRunBudget[];
    readonly jobs: readonly TestJob[];
  }>([
    {
      title: '合計が予算ちょうど',
      budgets: [BUDGET],
      jobs: [
        { name: 'daily-ranking', at: AT_4_21, order: 1, elapseMs: 200 },
        { name: 'weekly-ranking', at: AT_4_21, order: 2, elapseMs: 100 },
      ],
    },
    {
      title: '起動した式に予算が無い',
      budgets: [{ at: AT_6_00, maxTotalDurationMs: 1 }],
      jobs: [{ name: 'daily-ranking', at: AT_4_21, order: 1, elapseMs: 500 }],
    },
    {
      title: '失敗したジョブを含み、合計が予算以内',
      budgets: [BUDGET],
      jobs: [
        {
          name: 'daily-ranking',
          at: AT_4_21,
          order: 1,
          elapseMs: 150,
          failure: new Error('集計に失敗しました'),
        },
        { name: 'weekly-ranking', at: AT_4_21, order: 2, elapseMs: 100 },
      ],
    },
  ])('$titleなら警告を送らない', async ({ budgets, jobs }) => {
    const result = await dispatch({ cron: CRON_4_21, budgets, jobs });

    expect(result.runs).toHaveLength(jobs.length);
    expect(logsAt(result, 'warning')).toStrictEqual([]);
    expect(eventsAt(result, 'warning')).toStrictEqual([]);
    expect(summaryOf(result)?.totalDurationMs).toBe(
      jobs.reduce((total, { elapseMs }) => total + (elapseMs ?? 0), 0),
    );
  });

  test('エラートラッキングへの送信に失敗しても、ジョブの実行と要約は変わらない', async () => {
    const result = await dispatch({
      cron: CRON_4_21,
      budgets: [BUDGET],
      fetch: createFailingFetch(),
      jobs: [
        {
          name: 'daily-ranking',
          at: AT_4_21,
          order: 1,
          elapseMs: 200,
          failure: new Error('集計に失敗しました'),
        },
        { name: 'weekly-ranking', at: AT_4_21, order: 2, elapseMs: 200 },
      ],
    });

    expect(result.runs.map(({ name }) => name)).toStrictEqual([
      'daily-ranking',
      'weekly-ranking',
    ]);
    expect(result.logs.map(({ level }) => level)).toStrictEqual([
      'error',
      'warning',
      'info',
    ]);
    expect(summaryOf(result)).toMatchObject({
      result: 'failed',
      totalDurationMs: 400,
    });
  });
});
