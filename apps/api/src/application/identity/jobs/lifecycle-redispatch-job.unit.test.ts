import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { RUN_USER_LIFECYCLE_MESSAGE } from '../../../../lib/core/messaging/contracts/identity.ts';
import type { StoredLifecycleEvent } from '../../../../lib/core/identity/ports.ts';
import {
  createLifecycleStoreFake,
  createLogCapture,
  createPublisherFake,
  createReporterFake,
  jobContextAt,
  pendingEventOf,
  type PublisherFakeOptions,
  REDISPATCH_CRON,
} from '../testing/daily-job-fakes.ts';
import { IdentityDailyJobError } from './daily-job-support.ts';
import {
  LifecycleRedispatchJob,
  REDISPATCH_LIMIT,
} from './lifecycle-redispatch-job.ts';

// 業務日付2026-11-15の16:21(UTC-8)
const SCHEDULED_TIME = new Date('2026-11-16T00:21:00.000Z');

const ONE_HOUR_BEFORE = new Date('2026-11-15T23:21:00.000Z');

const logs = createLogCapture();

beforeEach(() => {
  logs.start();
});

afterEach(() => {
  logs.stop();
});

function setup(
  pending: readonly StoredLifecycleEvent[],
  publisherOptions: PublisherFakeOptions = {},
) {
  const lifecycle = createLifecycleStoreFake({ pending });
  const messages = createPublisherFake(publisherOptions);
  const reports = createReporterFake();
  const job = new LifecycleRedispatchJob(
    lifecycle.store,
    messages.publisher,
    reports.reporter,
  );
  return { job, lifecycle, messages, reports };
}

const run = (job: LifecycleRedispatchJob) =>
  job.run(jobContextAt(SCHEDULED_TIME, REDISPATCH_CRON));

describe('LifecycleRedispatchJob', () => {
  test('最後の送信からちょうど1時間の未完了のイベントを送り直し、1時間に満たないイベントと完了済みのイベントを送り直さない', async () => {
    const exactlyOneHour = pendingEventOf(1, {
      lastDispatchedAt: ONE_HOUR_BEFORE,
    });
    const underOneHour = pendingEventOf(2, {
      lastDispatchedAt: new Date(ONE_HOUR_BEFORE.getTime() + 1),
    });
    const completed = pendingEventOf(3, { status: 'completed' });
    const { job, messages } = setup([exactlyOneHour, underOneHour, completed]);

    await run(job);

    expect(messages.published).toEqual([
      {
        type: RUN_USER_LIFECYCLE_MESSAGE.type,
        body: { eventId: exactlyOneHour.id },
        options: undefined,
      },
    ]);
  });

  test('送り直したイベントの送信の回数を予定時刻で1増やす', async () => {
    const events = [pendingEventOf(1), pendingEventOf(2)];
    const { job, lifecycle } = setup(events);

    await run(job);

    expect(lifecycle.calls.redispatchMarks).toEqual([
      { eventIds: events.map(({ id }) => id), at: SCHEDULED_TIME },
    ]);
  });

  test('1回の起動で送り直すイベントは100件までにする', async () => {
    const events = Array.from({ length: REDISPATCH_LIMIT + 3 }, (_, index) =>
      pendingEventOf(index + 1, {
        lastDispatchedAt: new Date(Date.UTC(2026, 10, 1, 0, index)),
      }),
    );
    const { job, lifecycle, messages } = setup(events);

    await run(job);

    expect(REDISPATCH_LIMIT).toBe(100);
    expect(messages.published).toHaveLength(100);
    expect(lifecycle.calls.redispatchMarks[0]?.eventIds).toEqual(
      events.slice(0, 100).map(({ id }) => id),
    );
  });

  test('3回目以降の送り直しを含めば、送り直した件数と該当のイベントのIDを運用者へ通知する', async () => {
    const second = pendingEventOf(1, { dispatchCount: 2 });
    const third = pendingEventOf(2, { dispatchCount: 3 });
    const fifth = pendingEventOf(3, { dispatchCount: 5 });
    const { job, reports } = setup([second, third, fifth]);

    await run(job);

    expect(reports.incidents).toEqual([
      {
        kind: 'lifecycle-events-redispatched',
        count: 3,
        stuckEventIds: [third.id, fifth.id],
      },
    ]);
  });

  test('対象・送り直し・送信の失敗・3回目以降の件数と残りの有無をinfoで記録する', async () => {
    const { job } = setup([
      pendingEventOf(1, { dispatchCount: 3 }),
      pendingEventOf(2),
    ]);

    await run(job);

    const [summary] = logs.of('lifecycle-redispatch');
    expect(summary?.level).toBe('info');
    expect(summary?.properties).toEqual({
      found: 2,
      redispatched: 2,
      failed: 0,
      stuck: 1,
      hasMore: false,
    });
  });

  test('2回目までの送り直しだけなら通知しない', async () => {
    const { job, reports } = setup([
      pendingEventOf(1, { dispatchCount: 1 }),
      pendingEventOf(2, { dispatchCount: 2 }),
    ]);

    await run(job);

    expect(reports.incidents).toEqual([]);
  });

  test('対象が無ければ記録も通知もしない', async () => {
    const { job, lifecycle, reports } = setup([]);

    await run(job);

    expect(lifecycle.calls.stalePendingQueries).toEqual([
      {
        dispatchedBefore: new Date(ONE_HOUR_BEFORE.getTime() + 1),
        limit: REDISPATCH_LIMIT + 1,
      },
    ]);
    expect(lifecycle.calls.redispatchMarks).toEqual([]);
    expect(reports.incidents).toEqual([]);
  });

  test('送信に失敗したイベントは回数を増やさず翌日に回し、残りを送り直してから1件の例外にまとめて投げる', async () => {
    const failed = pendingEventOf(1, { dispatchCount: 4 });
    const succeeded = pendingEventOf(2, { dispatchCount: 3 });
    const { job, lifecycle, reports } = setup([failed, succeeded], {
      failWhen: (body) => (body as { eventId: string }).eventId === failed.id,
    });

    const failure = await run(job).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IdentityDailyJobError);
    expect(lifecycle.calls.redispatchMarks).toEqual([
      { eventIds: [succeeded.id], at: SCHEDULED_TIME },
    ]);
    expect(reports.incidents).toEqual([
      {
        kind: 'lifecycle-events-redispatched',
        count: 1,
        stuckEventIds: [succeeded.id],
      },
    ]);
  });
});
