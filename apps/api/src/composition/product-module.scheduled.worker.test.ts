import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { and, count, eq } from 'drizzle-orm';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { productLifecycleEvents } from '../../db/schema/product/product-lifecycle-events.ts';
import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/product.ts';
import {
  clearProductTables,
  db,
  insertProductEvents,
  insertProducts,
  insertUser,
  productEventIdOf,
  T0,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { PRODUCT_REDISPATCH_LIMIT } from '../application/product/jobs/product-lifecycle-redispatch-job.ts';
import { PRODUCT_PURGE_CANDIDATE_LIMIT } from '../application/product/jobs/product-purge-orchestrator-job.ts';
import * as mainModule from '../index.ts';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface JobSummary {
  readonly name: string;
  readonly result: string;
  readonly durationMs: number;
}

// 業務日付2026-11-30の業務時刻4:21
const SCHEDULED_TIME = new Date(Date.UTC(2026, 10, 30, 12, 21));
const DAILY_CRON = '21 12 * * *';
const PURGE_JOB = 'product-launch.purge-orchestrator';
const REDISPATCH_JOB = 'product-launch.lifecycle-redispatch';

// Cron Triggersの1回の起動に置いた各ジョブの所要時間の目安(infra/003)
const PER_JOB_GUIDELINE_MS = 30_000;

const OWNER = 1;
const OVERFLOW = 3;
const DELETED_PRODUCT_COUNT = PRODUCT_PURGE_CANDIDATE_LIMIT + OVERFLOW;
const LIVE_PRODUCT_INDEX = 9_000;
const STALE_EVENT_COUNT = PRODUCT_REDISPATCH_LIMIT + OVERFLOW;

function recordConsole(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return logs;
}

async function runDailyScheduled(): Promise<void> {
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();
  await scheduled(
    createScheduledController({
      cron: DAILY_CRON,
      scheduledTime: SCHEDULED_TIME.getTime(),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

async function countEvents(
  condition: ReturnType<typeof eq> | ReturnType<typeof and>,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(productLifecycleEvents)
    .where(condition);
  return row?.total ?? 0;
}

// 上限を超える件数の論理削除済みのプロダクトと、最後の送信から1時間以上経った未完了のイベントを用意する
async function seedUpperLimits(): Promise<void> {
  await insertUser(OWNER);
  await insertProducts(
    Array.from({ length: DELETED_PRODUCT_COUNT }, (_, index) => index + 1),
    OWNER,
    { deletedAt: T0 },
  );
  await insertProducts([LIVE_PRODUCT_INDEX], OWNER);
  await insertProductEvents(
    Array.from({ length: STALE_EVENT_COUNT }, (_, index) => index + 1),
    LIVE_PRODUCT_INDEX,
    { type: 'hidden' },
  );
}

beforeEach(async () => {
  await clearProductTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('4:21の起動でのプロダクトのジョブ(上限の件数)', () => {
  test('200件のpurge_dueの作成と送信、100件の送り直しを予算の警告なく終え、各ジョブが目安の時間に収まる', async () => {
    await seedUpperLimits();
    const send = vi.spyOn(env.JOBS_QUEUE, 'send');
    const logs = recordConsole();

    await runDailyScheduled();

    const productSends = send.mock.calls.filter(
      ([envelope]) =>
        (envelope as { type?: string }).type ===
        RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
    );
    expect(productSends).toHaveLength(
      PRODUCT_PURGE_CANDIDATE_LIMIT + PRODUCT_REDISPATCH_LIMIT,
    );
    expect(
      await countEvents(eq(productLifecycleEvents.type, 'purge_due')),
    ).toBe(PRODUCT_PURGE_CANDIDATE_LIMIT);
    expect(
      await countEvents(
        and(
          eq(productLifecycleEvents.type, 'hidden'),
          eq(productLifecycleEvents.dispatchCount, 2),
        ),
      ),
    ).toBe(PRODUCT_REDISPATCH_LIMIT);
    const [lastStale] = await db
      .select({ dispatchCount: productLifecycleEvents.dispatchCount })
      .from(productLifecycleEvents)
      .where(
        eq(productLifecycleEvents.id, productEventIdOf(STALE_EVENT_COUNT)),
      );
    expect(lastStale?.dispatchCount).toBe(1);

    expect(
      logs.find(
        ({ message }) =>
          message === '物理削除の期限を過ぎたプロダクトが残っています',
      ),
    ).toMatchObject({ level: 'error', count: DELETED_PRODUCT_COUNT });
    expect(
      logs.some(
        ({ message }) =>
          message === '定期実行の合計の所要時間が予算を超えました',
      ),
    ).toBe(false);
    const summary = logs.find(
      ({ message }) => message === '定期実行を終えました',
    );
    const jobs = (summary?.['jobs'] ?? []) as readonly JobSummary[];
    const productJobs = jobs.filter(({ name }) =>
      [PURGE_JOB, REDISPATCH_JOB].includes(name),
    );
    expect(productJobs.map(({ name, result }) => ({ name, result }))).toEqual([
      { name: PURGE_JOB, result: 'succeeded' },
      { name: REDISPATCH_JOB, result: 'succeeded' },
    ]);
    for (const { durationMs } of productJobs) {
      expect(durationMs).toBeLessThan(PER_JOB_GUIDELINE_MS);
    }
  });
});
