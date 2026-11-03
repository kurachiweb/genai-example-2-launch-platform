import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../../lib/core/time/business-time.ts';
import { ADMIN_SESSION_POLICY } from '../../../domain/admin/admin-session-policy.ts';
import type { SessionPolicy } from '../../../domain/auth/session-policy.ts';
import type {
  AdminAuthTokenStore,
  AdminLoginChallengeStore,
  AdminSessionStore,
  AdminTotpCredentialStore,
} from '../ports.ts';
import {
  ADMIN_CREDENTIAL_CLEANUP_LIMIT,
  AdminCredentialCleanupJob,
  AdminDailyJobError,
} from './admin-credential-cleanup-job.ts';

type Target = 'sessions' | 'mailLinks' | 'loginChallenges' | 'totpPendings';

interface DeletionCall {
  readonly target: Target;
  readonly now: Date;
  readonly limit: number;
  readonly policy?: SessionPolicy;
}

interface FakeOptions {
  readonly deleted?: Partial<Record<Target, number>>;
  readonly errors?: Partial<Record<Target, Error>>;
}

const SCHEDULED_TIME = new Date('2026-11-15T12:21:00.000Z');

const CATEGORY = 'api.admin.credential-cleanup';

const records: LogRecord[] = [];

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

function contextAt(scheduledTime: Date): ScheduledJobContext {
  return {
    scheduledTime,
    cron: '21 12 * * *',
    business: toBusinessDateTime(scheduledTime),
  };
}

// 使わないメソッドを呼んだら失敗させ、ジョブが想定外の操作に触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (typeof property === 'string' && !(property in target)) {
        throw new Error(`${property}は呼ばれない想定です`);
      }
      return Reflect.get(target, property, receiver) as unknown;
    },
  }) as T;
}

function setup(options: FakeOptions = {}) {
  const calls: DeletionCall[] = [];
  const deleteFor = (target: Target, call: Omit<DeletionCall, 'target'>) => {
    calls.push({ target, ...call });
    const error = options.errors?.[target];
    if (error !== undefined) {
      return Promise.reject(error);
    }
    return Promise.resolve(options.deleted?.[target] ?? 0);
  };
  const job = new AdminCredentialCleanupJob(
    partialFake<AdminSessionStore>({
      deleteExpired: (now, policy, limit) =>
        deleteFor('sessions', { now, policy, limit }),
    }),
    partialFake<AdminAuthTokenStore>({
      deleteExpired: (now, limit) => deleteFor('mailLinks', { now, limit }),
    }),
    partialFake<AdminLoginChallengeStore>({
      deleteExpired: (now, limit) =>
        deleteFor('loginChallenges', { now, limit }),
    }),
    partialFake<AdminTotpCredentialStore>({
      clearExpiredPending: (now, limit) =>
        deleteFor('totpPendings', { now, limit }),
    }),
  );
  return { job, calls };
}

function logsOfJob() {
  return records
    .filter((record) => record.category.join('.') === CATEGORY)
    .map(({ level, properties }) => ({ level, properties }));
}

describe('AdminCredentialCleanupJob', () => {
  test('予定時刻を基準に、期限切れのセッション・未使用の認証系トークン・第2要素の待ち・TOTPの保留を、それぞれ500件まで削除する', async () => {
    const { job, calls } = setup();

    await job.run(contextAt(SCHEDULED_TIME));

    expect(ADMIN_CREDENTIAL_CLEANUP_LIMIT).toBe(500);
    expect(calls).toEqual([
      {
        target: 'sessions',
        now: SCHEDULED_TIME,
        policy: ADMIN_SESSION_POLICY,
        limit: 500,
      },
      { target: 'mailLinks', now: SCHEDULED_TIME, limit: 500 },
      { target: 'loginChallenges', now: SCHEDULED_TIME, limit: 500 },
      { target: 'totpPendings', now: SCHEDULED_TIME, limit: 500 },
    ]);
  });

  test('削除した件数を対象ごとにinfoで記録する', async () => {
    const { job } = setup({
      deleted: {
        sessions: 500,
        mailLinks: 3,
        loginChallenges: 5,
        totpPendings: 1,
      },
    });

    await job.run(contextAt(SCHEDULED_TIME));

    expect(logsOfJob()).toEqual([
      {
        level: 'info',
        properties: {
          sessions: 500,
          mailLinks: 3,
          loginChallenges: 5,
          totpPendings: 1,
          failed: 0,
        },
      },
    ]);
  });

  test('1つの対象の削除に失敗しても残りの対象を削除して件数を記録し、最後に失敗を1件の例外にまとめて投げる', async () => {
    const cause = new Error('D1に接続できません');
    const { job, calls } = setup({
      deleted: { sessions: 2, loginChallenges: 4, totpPendings: 0 },
      errors: { mailLinks: cause },
    });

    const failure = await job
      .run(contextAt(SCHEDULED_TIME))
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(AdminDailyJobError);
    expect((failure as Error).cause).toBe(cause);
    expect(calls.map(({ target }) => target)).toEqual([
      'sessions',
      'mailLinks',
      'loginChallenges',
      'totpPendings',
    ]);
    expect(logsOfJob()).toEqual([
      { level: 'error', properties: { error: cause, target: 'mailLinks' } },
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
