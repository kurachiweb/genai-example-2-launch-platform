import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { RUN_USER_LIFECYCLE_MESSAGE } from '../../../../lib/core/messaging/contracts/identity.ts';
import {
  createLifecycleStoreFake,
  createLogCapture,
  createPublisherFake,
  createReporterFake,
  jobContextAt,
  type LifecycleStoreFakeOptions,
  type PublisherFakeOptions,
  ulidOf,
  type WithdrawnUser,
} from '../testing/daily-job-fakes.ts';
import { IdentityDailyJobError } from './daily-job-support.ts';
import {
  PURGE_CANDIDATE_LIMIT,
  PurgeOrchestratorJob,
} from './purge-orchestrator-job.ts';

// 業務日付2026-11-15の4:21(UTC-8)
const SCHEDULED_TIME = new Date('2026-11-15T12:21:00.000Z');

// 業務日付2026-11-03(実行日の12日前)の0:00
const PURGE_BOUNDARY = new Date('2026-11-03T08:00:00.000Z');

const OVERDUE_BOUNDARY = new Date('2026-11-01T12:21:00.000Z');

const logs = createLogCapture();

beforeEach(() => {
  logs.start();
});

afterEach(() => {
  logs.stop();
});

function withdrawnAt(index: number, deletedAt: Date): WithdrawnUser {
  return { userId: ulidOf('01JUSER', index), deletedAt };
}

function setup(
  storeOptions: LifecycleStoreFakeOptions = {},
  publisherOptions: PublisherFakeOptions = {},
) {
  const lifecycle = createLifecycleStoreFake(storeOptions);
  const messages = createPublisherFake(publisherOptions);
  const reports = createReporterFake();
  const job = new PurgeOrchestratorJob(
    lifecycle.store,
    messages.publisher,
    reports.reporter,
  );
  return { job, lifecycle, messages, reports };
}

const run = (job: PurgeOrchestratorJob) =>
  job.run(jobContextAt(SCHEDULED_TIME));

describe('PurgeOrchestratorJob', () => {
  test('退会の業務日付が実行日の13日前以前の利用者だけを物理削除の候補にし、12日前の業務日付の退会を含めない', async () => {
    const thirteenDaysBefore = withdrawnAt(
      1,
      new Date(PURGE_BOUNDARY.getTime() - 1),
    );
    const twelveDaysBefore = withdrawnAt(2, PURGE_BOUNDARY);
    const { job, lifecycle } = setup({
      withdrawn: [twelveDaysBefore, thirteenDaysBefore],
    });

    await run(job);

    expect(lifecycle.calls.purgeCandidateQueries[0]?.deletedBefore).toEqual(
      PURGE_BOUNDARY,
    );
    expect(lifecycle.calls.purgeDueCreations).toEqual([
      { userIds: [thirteenDaysBefore.userId], at: SCHEDULED_TIME },
    ]);
  });

  test('候補ごとに物理削除の開始のイベントを作り、作ったイベントの非同期の波及処理の実行を送る', async () => {
    const users = [1, 2].map((index) =>
      withdrawnAt(index, new Date('2026-10-20T00:00:00.000Z')),
    );
    const { job, messages } = setup({ withdrawn: users });

    await run(job);

    expect(messages.published).toEqual([
      {
        type: RUN_USER_LIFECYCLE_MESSAGE.type,
        body: { eventId: ulidOf('01JPURGE', 1) },
        options: undefined,
      },
      {
        type: RUN_USER_LIFECYCLE_MESSAGE.type,
        body: { eventId: ulidOf('01JPURGE', 2) },
        options: undefined,
      },
    ]);
  });

  test('1回の起動で扱う候補は50件までにし、残りは翌日に回す', async () => {
    const users = Array.from(
      { length: PURGE_CANDIDATE_LIMIT + 5 },
      (_, index) =>
        withdrawnAt(index + 1, new Date(Date.UTC(2026, 9, 1, 0, index))),
    );
    const { job, lifecycle, messages } = setup({ withdrawn: users });

    await run(job);

    expect(PURGE_CANDIDATE_LIMIT).toBe(50);
    expect(lifecycle.calls.purgeDueCreations[0]?.userIds).toEqual(
      users.slice(0, 50).map((user) => user.userId),
    );
    expect(messages.published).toHaveLength(50);
  });

  test('物理削除を始めた利用者は候補にならず、同じ日に2回動いてもイベントを重ねて作らない', async () => {
    const user = withdrawnAt(1, new Date('2026-10-20T00:00:00.000Z'));
    const { job, lifecycle, messages } = setup({ withdrawn: [user] });

    await run(job);
    await run(job);

    expect(lifecycle.calls.purgeDueCreations).toEqual([
      { userIds: [user.userId], at: SCHEDULED_TIME },
    ]);
    expect(messages.published).toHaveLength(1);
  });

  test('候補・作成・送信・送信の失敗・期限超過の件数と残りの有無をinfoで記録する', async () => {
    const users = Array.from(
      { length: PURGE_CANDIDATE_LIMIT + 1 },
      (_, index) =>
        withdrawnAt(index + 1, new Date(Date.UTC(2026, 9, 1, 0, index))),
    );
    const { job } = setup({ withdrawn: users });

    await run(job);

    const [summary] = logs.of('purge-orchestrator');
    expect(summary?.level).toBe('info');
    expect(summary?.properties).toEqual({
      found: 50,
      created: 50,
      published: 50,
      failed: 0,
      hasMore: true,
      overdue: 51,
    });
  });

  test('候補が無ければイベントを作らず何も送らない', async () => {
    const { job, lifecycle, messages } = setup();

    await run(job);

    expect(lifecycle.calls.purgeDueCreations).toEqual([]);
    expect(messages.attempted).toEqual([]);
  });

  test('論理削除から14日を過ぎても行が残る利用者を数え、1件以上なら件数だけを添えて運用者へ通知する', async () => {
    const overdue = [
      {
        ...withdrawnAt(1, new Date('2026-10-30T00:00:00.000Z')),
        purgeStarted: true,
      },
      withdrawnAt(2, new Date(OVERDUE_BOUNDARY.getTime() - 1)),
    ];
    const withinDeadline = withdrawnAt(3, OVERDUE_BOUNDARY);
    const { job, lifecycle, reports } = setup({
      withdrawn: [...overdue, withinDeadline],
    });

    await run(job);

    expect(lifecycle.calls.overdueQueries).toEqual([OVERDUE_BOUNDARY]);
    expect(reports.incidents).toEqual([{ kind: 'purge-overdue', count: 2 }]);
  });

  test('期限を過ぎた利用者がいなければ通知しない', async () => {
    const { job, reports } = setup({
      withdrawn: [withdrawnAt(1, OVERDUE_BOUNDARY)],
    });

    await run(job);

    expect(reports.incidents).toEqual([]);
  });

  test('一部の送信に失敗しても残りを送り、期限超過の確認を済ませてから1件の例外にまとめて投げる', async () => {
    const users = [1, 2, 3].map((index) =>
      withdrawnAt(index, new Date('2026-10-01T00:00:00.000Z')),
    );
    const failedEventId = ulidOf('01JPURGE', 1);
    const { job, lifecycle, messages, reports } = setup(
      { withdrawn: users },
      {
        failWhen: (body) =>
          (body as { eventId: string }).eventId === failedEventId,
      },
    );

    const failure = await run(job).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IdentityDailyJobError);
    expect((failure as Error).message).toContain('1件');
    expect(messages.published.map(({ body }) => body)).toEqual([
      { eventId: ulidOf('01JPURGE', 2) },
      { eventId: ulidOf('01JPURGE', 3) },
    ]);
    expect(lifecycle.calls.overdueQueries).toEqual([OVERDUE_BOUNDARY]);
    expect(reports.incidents).toEqual([{ kind: 'purge-overdue', count: 3 }]);
  });

  test('候補の照会に失敗しても期限超過の確認と通知を行い、元の例外を投げる', async () => {
    const cause = new Error('D1に接続できません');
    const { job, lifecycle, reports } = setup({
      withdrawn: [withdrawnAt(1, new Date('2026-10-01T00:00:00.000Z'))],
      listPurgeCandidatesError: cause,
    });

    const failure = await run(job).catch((error: unknown) => error);

    expect(failure).toBe(cause);
    expect(lifecycle.calls.overdueQueries).toEqual([OVERDUE_BOUNDARY]);
    expect(reports.incidents).toEqual([{ kind: 'purge-overdue', count: 1 }]);
  });

  test('期限超過の照会に失敗したら、物理削除の開始を済ませたうえでその例外を投げる', async () => {
    const cause = new Error('D1に接続できません');
    const { job, messages } = setup({
      withdrawn: [withdrawnAt(1, new Date('2026-10-01T00:00:00.000Z'))],
      countOverduePurgesError: cause,
    });

    const failure = await run(job).catch((error: unknown) => error);

    expect(failure).toBe(cause);
    expect(messages.published).toHaveLength(1);
  });
});
