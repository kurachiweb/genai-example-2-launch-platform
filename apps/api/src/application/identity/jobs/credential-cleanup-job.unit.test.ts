import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { USER_SESSION_POLICY } from '../../../domain/auth/session-policy.ts';
import {
  createCredentialStoresFake,
  createLogCapture,
  type CredentialStoresFakeOptions,
  jobContextAt,
} from '../testing/daily-job-fakes.ts';
import { CredentialCleanupJob } from './credential-cleanup-job.ts';
import { IdentityDailyJobError } from './daily-job-support.ts';

const SCHEDULED_TIME = new Date('2026-11-15T12:21:00.000Z');

const logs = createLogCapture();

beforeEach(() => {
  logs.start();
});

afterEach(() => {
  logs.stop();
});

function setup(options: CredentialStoresFakeOptions = {}) {
  const stores = createCredentialStoresFake(options);
  const job = new CredentialCleanupJob(
    stores.sessions,
    stores.authTokens,
    stores.loginChallenges,
    stores.totpCredentials,
  );
  return { job, stores };
}

const run = (job: CredentialCleanupJob) =>
  job.run(jobContextAt(SCHEDULED_TIME));

describe('CredentialCleanupJob', () => {
  test('予定時刻を基準に、期限切れのセッション・未使用の認証系トークン・第2要素の待ち・TOTPの保留をそれぞれ件数の上限なしで削除する', async () => {
    const { job, stores } = setup();

    await run(job);

    expect(stores.calls).toEqual([
      {
        target: 'sessions',
        now: SCHEDULED_TIME,
        policy: USER_SESSION_POLICY,
      },
      { target: 'mailLinks', now: SCHEDULED_TIME },
      { target: 'loginChallenges', now: SCHEDULED_TIME },
      { target: 'totpPendings', now: SCHEDULED_TIME },
    ]);
  });

  test('削除した件数を対象ごとにinfoで記録する', async () => {
    const { job } = setup({
      deleted: {
        sessions: 12,
        mailLinks: 3,
        loginChallenges: 5,
        totpPendings: 1,
      },
    });

    await run(job);

    const [summary] = logs.of('credential-cleanup');
    expect(summary?.level).toBe('info');
    expect(summary?.properties).toEqual({
      sessions: 12,
      mailLinks: 3,
      loginChallenges: 5,
      totpPendings: 1,
      failed: 0,
    });
  });

  test('1つの対象の削除に失敗しても残りの対象を削除して件数を記録し、最後に失敗を1件の例外にまとめて投げる', async () => {
    const cause = new Error('D1に接続できません');
    const { job, stores } = setup({
      deleted: { sessions: 2, loginChallenges: 4, totpPendings: 0 },
      errors: { mailLinks: cause },
    });

    const failure = await run(job).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(IdentityDailyJobError);
    expect((failure as Error).cause).toBe(cause);
    expect(stores.calls.map(({ target }) => target)).toEqual([
      'sessions',
      'mailLinks',
      'loginChallenges',
      'totpPendings',
    ]);
    const records = logs.of('credential-cleanup');
    expect(
      records.map(({ level, properties }) => ({ level, properties })),
    ).toEqual([
      {
        level: 'error',
        properties: { error: cause, target: 'mailLinks' },
      },
      {
        level: 'info',
        properties: {
          sessions: 2,
          loginChallenges: 4,
          totpPendings: 0,
          failed: 1,
        },
      },
    ]);
  });
});
