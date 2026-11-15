import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { RUN_PRODUCT_LIFECYCLE_MESSAGE } from '../../../../lib/core/messaging/contracts/product.ts';
import { PRODUCT_TYPES } from '../product-types.ts';
import {
  createIncidentReporterFake,
  createJobLogCapture,
  createJobPublisherFake,
  createProductLifecycleStoreFake,
  deletedProductOf,
  jobContextAt,
  type JobPublisherFakeOptions,
  type ProductLifecycleStoreFakeOptions,
  ulidOf,
} from '../testing/product-job-fakes.ts';
import { ProductDailyJobError } from './product-job-support.ts';
import {
  PRODUCT_PURGE_CANDIDATE_LIMIT,
  PRODUCT_PURGE_ORCHESTRATOR_JOB_DEFINITION,
  ProductPurgeOrchestratorJob,
} from './product-purge-orchestrator-job.ts';

// 業務日付2026-11-15の4:21(UTC-8)
const SCHEDULED_TIME = new Date('2026-11-15T12:21:00.000Z');

// 業務日付2026-11-03(実行日の12日前)の0:00
const PURGE_BOUNDARY = new Date('2026-11-03T08:00:00.000Z');

const OVERDUE_BOUNDARY = new Date('2026-11-01T12:21:00.000Z');

const SUMMARY_MESSAGE = '論理削除したプロダクトの物理削除を開始しました';

const logs = createJobLogCapture();

beforeEach(() => {
  logs.start();
});

afterEach(() => {
  logs.stop();
});

function setup(
  storeOptions: ProductLifecycleStoreFakeOptions = {},
  publisherOptions: JobPublisherFakeOptions = {},
) {
  const lifecycle = createProductLifecycleStoreFake(storeOptions);
  const messages = createJobPublisherFake(publisherOptions);
  const reports = createIncidentReporterFake();
  const job = new ProductPurgeOrchestratorJob(
    lifecycle.store,
    messages.publisher,
    reports.reporter,
  );
  return { job, lifecycle, messages, reports };
}

const run = (job: ProductPurgeOrchestratorJob, at = SCHEDULED_TIME) =>
  job.run(jobContextAt(at));

describe('ProductPurgeOrchestratorJob', () => {
  test('業務時刻4:21の起動にorder 1000で登録する定義を持つ', () => {
    expect(PRODUCT_PURGE_ORCHESTRATOR_JOB_DEFINITION).toEqual({
      name: 'product-launch.purge-orchestrator',
      at: { hour: 4, minute: 21 },
      order: 1000,
      handler: PRODUCT_TYPES.ProductPurgeOrchestratorJob,
    });
    expect(Object.isFrozen(PRODUCT_PURGE_ORCHESTRATOR_JOB_DEFINITION)).toBe(
      true,
    );
  });

  test('論理削除の業務日付が実行日の13日前以前のプロダクトだけにpurge_dueを作り、12日前の業務日付の論理削除には作らない', async () => {
    const thirteenDaysBefore = deletedProductOf(
      1,
      new Date(PURGE_BOUNDARY.getTime() - 1),
    );
    const twelveDaysBefore = deletedProductOf(2, PURGE_BOUNDARY);
    const { job, lifecycle } = setup({
      deleted: [twelveDaysBefore, thirteenDaysBefore],
    });

    await run(job);

    expect(lifecycle.calls.purgeCandidateQueries).toEqual([
      {
        deletedBefore: PURGE_BOUNDARY,
        limit: PRODUCT_PURGE_CANDIDATE_LIMIT + 1,
      },
    ]);
    expect(lifecycle.calls.purgeDueCreations).toEqual([
      { productIds: [thirteenDaysBefore.productId], at: SCHEDULED_TIME },
    ]);
  });

  test('境界は月をまたいでも業務日付で12日前の0:00になる', async () => {
    // 業務日付2026-03-05の4:21(UTC-8)。12日前は2026-02-21
    const { job, lifecycle } = setup();

    await run(job, new Date('2026-03-05T12:21:00.000Z'));

    expect(lifecycle.calls.purgeCandidateQueries[0]?.deletedBefore).toEqual(
      new Date('2026-02-21T08:00:00.000Z'),
    );
  });

  test('作ったpurge_dueごとにプロダクトライフサイクルの実行を送る', async () => {
    const products = [1, 2].map((index) =>
      deletedProductOf(index, new Date('2026-10-20T00:00:00.000Z')),
    );
    const { job, messages } = setup({ deleted: products });

    await run(job);

    expect(messages.published).toEqual([
      {
        type: RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        body: { eventId: ulidOf('01JD0PURGE', 1) },
      },
      {
        type: RUN_PRODUCT_LIFECYCLE_MESSAGE.type,
        body: { eventId: ulidOf('01JD0PURGE', 2) },
      },
    ]);
  });

  test('1回の起動で扱う候補は200件までにし、残りは翌日に回す', async () => {
    const products = Array.from(
      { length: PRODUCT_PURGE_CANDIDATE_LIMIT + 5 },
      (_, index) =>
        deletedProductOf(index + 1, new Date(Date.UTC(2026, 9, 1, 0, index))),
    );
    const { job, lifecycle, messages } = setup({ deleted: products });

    await run(job);

    expect(PRODUCT_PURGE_CANDIDATE_LIMIT).toBe(200);
    expect(lifecycle.calls.purgeDueCreations[0]?.productIds).toEqual(
      products.slice(0, 200).map(({ productId }) => productId),
    );
    expect(messages.published).toHaveLength(200);
  });

  test('purge_dueを作ったプロダクトは候補にならず、同じ日に2回動いてもイベントを重ねて作らない', async () => {
    const product = deletedProductOf(1, new Date('2026-10-20T00:00:00.000Z'));
    const { job, lifecycle, messages } = setup({ deleted: [product] });

    await run(job);
    await run(job);

    expect(lifecycle.calls.purgeDueCreations).toEqual([
      { productIds: [product.productId], at: SCHEDULED_TIME },
    ]);
    expect(messages.published).toHaveLength(1);
  });

  test('候補・作成・送信・送信の失敗・期限超過の件数と残りの有無をinfoで記録する', async () => {
    const products = Array.from(
      { length: PRODUCT_PURGE_CANDIDATE_LIMIT + 1 },
      (_, index) =>
        deletedProductOf(index + 1, new Date(Date.UTC(2026, 9, 1, 0, index))),
    );
    const { job } = setup({ deleted: products });

    await run(job);

    const summary = logs.find(SUMMARY_MESSAGE);
    expect(summary?.level).toBe('info');
    expect(summary?.category).toEqual(['api', 'application', 'product']);
    expect(summary?.properties).toEqual({
      found: 200,
      created: 200,
      published: 200,
      failed: 0,
      hasMore: true,
      overdue: 201,
    });
  });

  test('候補が無ければイベントを作らず何も送らない', async () => {
    const { job, lifecycle, messages } = setup();

    await run(job);

    expect(lifecycle.calls.purgeDueCreations).toEqual([]);
    expect(messages.attempted).toEqual([]);
  });

  test('論理削除から14日を過ぎても行が残るプロダクトを数え、1件以上ならproduct-purge-overdueと件数を報告する', async () => {
    const overdue = [
      deletedProductOf(1, new Date('2026-10-30T00:00:00.000Z'), {
        purgeStarted: true,
      }),
      deletedProductOf(2, new Date(OVERDUE_BOUNDARY.getTime() - 1)),
    ];
    const withinDeadline = deletedProductOf(3, OVERDUE_BOUNDARY);
    const { job, lifecycle, reports } = setup({
      deleted: [...overdue, withinDeadline],
    });

    await run(job);

    expect(lifecycle.calls.overdueQueries).toEqual([OVERDUE_BOUNDARY]);
    expect(reports.incidents).toEqual([
      { kind: 'product-purge-overdue', count: 2 },
    ]);
  });

  test('期限を過ぎたプロダクトが無ければ報告しない', async () => {
    const { job, reports } = setup({
      deleted: [deletedProductOf(1, OVERDUE_BOUNDARY)],
    });

    await run(job);

    expect(reports.incidents).toEqual([]);
  });

  test('一部の送信に失敗しても残りを送り、期限超過の確認を済ませてから1件の例外にまとめて投げ、イベントとプロダクトのIDだけを記録する', async () => {
    const products = [1, 2, 3].map((index) =>
      deletedProductOf(index, new Date('2026-10-01T00:00:00.000Z')),
    );
    const failedEventId = ulidOf('01JD0PURGE', 1);
    const { job, lifecycle, messages, reports } = setup(
      { deleted: products },
      {
        failWhen: (body) =>
          (body as { eventId: string }).eventId === failedEventId,
      },
    );

    const failure = await run(job).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProductDailyJobError);
    expect((failure as Error).message).toContain('1件');
    expect(messages.published.map(({ body }) => body)).toEqual([
      { eventId: ulidOf('01JD0PURGE', 2) },
      { eventId: ulidOf('01JD0PURGE', 3) },
    ]);
    expect(lifecycle.calls.overdueQueries).toEqual([OVERDUE_BOUNDARY]);
    expect(reports.incidents).toEqual([
      { kind: 'product-purge-overdue', count: 3 },
    ]);
    const error = logs.find(
      '物理削除の時期の到来のイベントの送信を要求できませんでした',
    );
    expect(error?.level).toBe('error');
    expect(Object.keys(error?.properties ?? {}).toSorted()).toEqual([
      'error',
      'eventId',
      'productId',
    ]);
    expect(error?.properties).toMatchObject({
      eventId: failedEventId,
      productId: products[0]?.productId,
    });
  });

  test('候補の照会に失敗しても期限超過の確認と報告を行い、元の例外を投げる', async () => {
    const cause = new Error('D1に接続できません');
    const { job, lifecycle, reports } = setup({
      deleted: [deletedProductOf(1, new Date('2026-10-01T00:00:00.000Z'))],
      listPurgeCandidatesError: cause,
    });

    const failure = await run(job).catch((error: unknown) => error);

    expect(failure).toBe(cause);
    expect(lifecycle.calls.overdueQueries).toEqual([OVERDUE_BOUNDARY]);
    expect(reports.incidents).toEqual([
      { kind: 'product-purge-overdue', count: 1 },
    ]);
  });

  test('期限超過の照会に失敗したら、物理削除の開始を済ませたうえでその例外を投げる', async () => {
    const cause = new Error('D1に接続できません');
    const { job, messages } = setup({
      deleted: [deletedProductOf(1, new Date('2026-10-01T00:00:00.000Z'))],
      countOverduePurgesError: cause,
    });

    const failure = await run(job).catch((error: unknown) => error);

    expect(failure).toBe(cause);
    expect(messages.published).toHaveLength(1);
  });
});
