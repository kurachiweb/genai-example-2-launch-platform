import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../../../lib/core/messaging/contracts/product.ts';
import type { StoredProductLifecycleEvent } from '../../../../lib/core/product/ports.ts';
import { PRODUCT_TYPES } from '../product-types.ts';
import {
  createIncidentReporterFake,
  createJobLogCapture,
  createJobPublisherFake,
  createProductLifecycleStoreFake,
  jobContextAt,
  type JobPublisherFakeOptions,
  pendingProductEventOf,
} from '../testing/product-job-fakes.ts';
import {
  PRODUCT_LIFECYCLE_REDISPATCH_JOB_DEFINITION,
  PRODUCT_REDISPATCH_LIMIT,
  ProductLifecycleRedispatchJob,
} from './product-lifecycle-redispatch-job.ts';
import { ProductDailyJobError } from './product-job-support.ts';

// 業務日付2026-11-15の4:21(UTC-8)
const SCHEDULED_TIME = new Date('2026-11-15T12:21:00.000Z');

const ONE_HOUR_BEFORE = new Date('2026-11-15T11:21:00.000Z');

const SUMMARY_MESSAGE =
  '未完了のプロダクトライフサイクルイベントを送り直しました';

const logs = createJobLogCapture();

beforeEach(() => {
  logs.start();
});

afterEach(() => {
  logs.stop();
});

function setup(
  pending: readonly StoredProductLifecycleEvent[],
  publisherOptions: JobPublisherFakeOptions = {},
) {
  const lifecycle = createProductLifecycleStoreFake({ pending });
  const messages = createJobPublisherFake(publisherOptions);
  const reports = createIncidentReporterFake();
  const job = new ProductLifecycleRedispatchJob(
    lifecycle.store,
    messages.publisher,
    reports.reporter,
  );
  return { job, lifecycle, messages, reports };
}

const run = (job: ProductLifecycleRedispatchJob) =>
  job.run(jobContextAt(SCHEDULED_TIME));

describe('ProductLifecycleRedispatchJob', () => {
  test('業務時刻4:21の起動に、物理削除の開始の後のorder 1010で登録する定義を持つ', () => {
    expect(PRODUCT_LIFECYCLE_REDISPATCH_JOB_DEFINITION).toEqual({
      name: 'product-launch.lifecycle-redispatch',
      at: { hour: 4, minute: 21 },
      order: 1010,
      handler: PRODUCT_TYPES.ProductLifecycleRedispatchJob,
    });
    expect(Object.isFrozen(PRODUCT_LIFECYCLE_REDISPATCH_JOB_DEFINITION)).toBe(
      true,
    );
  });

  test('最後の送信からちょうど1時間の未完了のイベントを送り直し、1時間に満たないイベントと完了済みのイベントを送り直さない', async () => {
    const exactlyOneHour = pendingProductEventOf(1, {
      lastDispatchedAt: ONE_HOUR_BEFORE,
    });
    const underOneHour = pendingProductEventOf(2, {
      lastDispatchedAt: new Date(ONE_HOUR_BEFORE.getTime() + 1),
    });
    const completed = pendingProductEventOf(3, { status: 'completed' });
    const { job, messages } = setup([exactlyOneHour, underOneHour, completed]);

    await run(job);

    expect(messages.published).toEqual([
      {
        type: RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        body: { eventId: exactlyOneHour.id },
      },
    ]);
  });

  test('送り直したイベントの送信の回数を予定時刻で1増やす', async () => {
    const events = [pendingProductEventOf(1), pendingProductEventOf(2)];
    const { job, lifecycle } = setup(events);

    await run(job);

    expect(lifecycle.calls.redispatchMarks).toEqual([
      { eventIds: events.map(({ id }) => id), at: SCHEDULED_TIME },
    ]);
  });

  test('1回の起動で送り直すイベントは100件までにする', async () => {
    const events = Array.from(
      { length: PRODUCT_REDISPATCH_LIMIT + 3 },
      (_, index) =>
        pendingProductEventOf(index + 1, {
          lastDispatchedAt: new Date(Date.UTC(2026, 10, 1, 0, index)),
        }),
    );
    const { job, lifecycle, messages } = setup(events);

    await run(job);

    expect(PRODUCT_REDISPATCH_LIMIT).toBe(100);
    expect(lifecycle.calls.stalePendingQueries).toEqual([
      {
        dispatchedBefore: new Date(ONE_HOUR_BEFORE.getTime() + 1),
        limit: PRODUCT_REDISPATCH_LIMIT + 1,
      },
    ]);
    expect(messages.published).toHaveLength(100);
    expect(lifecycle.calls.redispatchMarks[0]?.eventIds).toEqual(
      events.slice(0, 100).map(({ id }) => id),
    );
  });

  test('3回目以降の送り直しを含めば、送り直した件数と該当のイベントのIDを運用者へ報告する', async () => {
    const second = pendingProductEventOf(1, { dispatchCount: 2 });
    const third = pendingProductEventOf(2, { dispatchCount: 3 });
    const fifth = pendingProductEventOf(3, { dispatchCount: 5 });
    const { job, reports } = setup([second, third, fifth]);

    await run(job);

    expect(reports.incidents).toEqual([
      {
        kind: 'product-lifecycle-events-redispatched',
        count: 3,
        stuckEventIds: [third.id, fifth.id],
      },
    ]);
  });

  test('2回目までの送り直しだけなら報告しない', async () => {
    const { job, reports } = setup([
      pendingProductEventOf(1, { dispatchCount: 1 }),
      pendingProductEventOf(2, { dispatchCount: 2 }),
    ]);

    await run(job);

    expect(reports.incidents).toEqual([]);
  });

  test('対象・送り直し・送信の失敗・3回目以降の件数と残りの有無をinfoで記録する', async () => {
    const { job } = setup([
      pendingProductEventOf(1, { dispatchCount: 3 }),
      pendingProductEventOf(2),
    ]);

    await run(job);

    const summary = logs.find(SUMMARY_MESSAGE);
    expect(summary?.level).toBe('info');
    expect(summary?.category).toEqual(['api', 'application', 'product']);
    expect(summary?.properties).toEqual({
      found: 2,
      redispatched: 2,
      failed: 0,
      stuck: 1,
      hasMore: false,
    });
  });

  test('対象が無ければ記録も報告もしない', async () => {
    const { job, lifecycle, reports } = setup([]);

    await run(job);

    expect(lifecycle.calls.redispatchMarks).toEqual([]);
    expect(reports.incidents).toEqual([]);
  });

  test('送信に失敗したイベントは回数を増やさず翌日に回し、残りを送り直してから1件の例外にまとめて投げる', async () => {
    const failed = pendingProductEventOf(1, { dispatchCount: 4 });
    const succeeded = pendingProductEventOf(2, { dispatchCount: 3 });
    const { job, lifecycle, reports } = setup([failed, succeeded], {
      failWhen: (body) => (body as { eventId: string }).eventId === failed.id,
    });

    const failure = await run(job).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProductDailyJobError);
    expect((failure as Error).message).toContain('1件');
    expect(lifecycle.calls.redispatchMarks).toEqual([
      { eventIds: [succeeded.id], at: SCHEDULED_TIME },
    ]);
    expect(reports.incidents).toEqual([
      {
        kind: 'product-lifecycle-events-redispatched',
        count: 1,
        stuckEventIds: [succeeded.id],
      },
    ]);
    const error = logs.find(
      'プロダクトライフサイクルイベントを送り直せませんでした',
    );
    expect(error?.level).toBe('error');
    expect(Object.keys(error?.properties ?? {}).toSorted()).toEqual([
      'error',
      'eventId',
      'productId',
    ]);
  });
});
