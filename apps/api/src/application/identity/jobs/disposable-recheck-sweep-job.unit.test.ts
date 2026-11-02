import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { RECHECK_DISPOSABLE_EMAIL_MESSAGE } from '../../../../lib/core/messaging/contracts/identity.ts';
import {
  createLogCapture,
  createPublisherFake,
  createUndeterminedUsersFake,
  jobContextAt,
  type PublisherFakeOptions,
  ulidOf,
  type UndeterminedUser,
} from '../testing/daily-job-fakes.ts';
import { IdentityDailyJobError } from './daily-job-support.ts';
import {
  DISPOSABLE_RECHECK_LIMIT,
  DisposableRecheckSweepJob,
} from './disposable-recheck-sweep-job.ts';

const SCHEDULED_TIME = new Date('2026-11-15T12:21:00.000Z');

const ONE_HOUR_BEFORE = new Date('2026-11-15T11:21:00.000Z');

const logs = createLogCapture();

beforeEach(() => {
  logs.start();
});

afterEach(() => {
  logs.stop();
});

function undeterminedAt(index: number, checkedAt: Date): UndeterminedUser {
  return { userId: ulidOf('01JUSER', index), checkedAt };
}

function setup(
  undetermined: readonly UndeterminedUser[],
  publisherOptions: PublisherFakeOptions = {},
) {
  const accounts = createUndeterminedUsersFake(undetermined);
  const messages = createPublisherFake(publisherOptions);
  const job = new DisposableRecheckSweepJob(accounts.users, messages.publisher);
  return { job, accounts, messages };
}

const run = (job: DisposableRecheckSweepJob) =>
  job.run(jobContextAt(SCHEDULED_TIME));

describe('DisposableRecheckSweepJob', () => {
  test('最後の判定からちょうど1時間の未判定の利用者の判定し直しを遅延なしで依頼し、1時間に満たない利用者を含めない', async () => {
    const exactlyOneHour = undeterminedAt(1, ONE_HOUR_BEFORE);
    const underOneHour = undeterminedAt(
      2,
      new Date(ONE_HOUR_BEFORE.getTime() + 1),
    );
    const { job, messages } = setup([underOneHour, exactlyOneHour]);

    await run(job);

    expect(messages.published).toEqual([
      {
        type: RECHECK_DISPOSABLE_EMAIL_MESSAGE.type,
        body: { userId: exactlyOneHour.userId },
        options: undefined,
      },
    ]);
  });

  test('1回の起動で依頼する利用者は50件までにし、残りの有無を件数とともに記録する', async () => {
    const users = Array.from(
      { length: DISPOSABLE_RECHECK_LIMIT + 2 },
      (_, index) =>
        undeterminedAt(index + 1, new Date(Date.UTC(2026, 10, 1, 0, index))),
    );
    const { job, accounts, messages } = setup(users);

    await run(job);

    expect(DISPOSABLE_RECHECK_LIMIT).toBe(50);
    expect(accounts.queries[0]?.limit).toBe(DISPOSABLE_RECHECK_LIMIT + 1);
    expect(messages.published.map(({ body }) => body)).toEqual(
      users.slice(0, 50).map(({ userId }) => ({ userId })),
    );
    const [summary] = logs.of('disposable-recheck-sweep');
    expect(summary?.level).toBe('info');
    expect(summary?.properties).toEqual({
      found: 50,
      requested: 50,
      failed: 0,
      hasMore: true,
    });
  });

  test('対象が無ければ何も送らない', async () => {
    const { job, messages } = setup([]);

    await run(job);

    expect(messages.attempted).toEqual([]);
  });

  test('一部の依頼の送信に失敗しても残りを依頼し、1件の例外にまとめて投げる', async () => {
    const users = [1, 2, 3].map((index) =>
      undeterminedAt(index, new Date(Date.UTC(2026, 10, 1, index))),
    );
    const failedUserId = users[0]?.userId;
    const { job, messages } = setup(users, {
      failWhen: (body) => (body as { userId: string }).userId === failedUserId,
    });

    const failure = await run(job).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IdentityDailyJobError);
    expect(messages.published.map(({ body }) => body)).toEqual([
      { userId: users[1]?.userId },
      { userId: users[2]?.userId },
    ]);
    const records = logs.of('disposable-recheck-sweep');
    expect(records[0]?.level).toBe('error');
    expect(records[0]?.properties).toMatchObject({ userId: failedUserId });
    expect(records[1]?.properties).toEqual({
      found: 3,
      requested: 2,
      failed: 1,
      hasMore: false,
    });
  });
});
