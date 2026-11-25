import { resetSync } from '@logtape/logtape';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { Container } from 'inversify';
import { afterEach, describe, expect, test } from 'vitest';

import { REPORT_CATEGORY_OTHER_ID } from '../../../common-lib/reporting/report-rules.ts';
import {
  createKeyedHasher,
  type KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { toErrorResponse } from '../../../lib/core/errors/error-envelope.ts';
import type {
  AccountGuard,
  CurrentUser,
} from '../../../lib/core/identity/account-guard.ts';
import type {
  CounterDecision,
  CounterRule,
  WindowState,
} from '../../../lib/core/rate-limit/fixed-window.ts';
import {
  type HashedRateLimitKey,
  hashRateLimitKey,
} from '../../../lib/core/rate-limit/rate-limit-key.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import { ensureLoggingConfigured } from '../../../lib/workers/logging/configure-logging.ts';
import {
  createRateLimitCounterClient,
  type RateLimitCounterClient,
} from '../../../lib/workers/rate-limit/rate-limit-counter-client.ts';
import type {
  ReportCategoryStore,
  ReportSubmissionRateLimit,
  ReportSubmissionRecord,
  ReportSubmissionStore,
  ReportSubmitter,
  ReportTargetResolver,
} from '../../application/reporting/ports.ts';
import { DefaultReportSubmissionService } from '../../application/reporting/report-submission-service.ts';
import { REPORTING_TYPES } from '../../application/reporting/reporting-types.ts';
import {
  CounterReportSubmissionRateLimit,
  REPORT_IP_RATE_RULE,
  REPORT_USER_RATE_RULE,
} from './counter-report-submission-rate-limit.ts';

const NOW = new Date('2027-05-01T09:00:00.000Z');
const SECONDS_PER_HOUR = 3600;
const MILLISECONDS_PER_HOUR = SECONDS_PER_HOUR * 1000;
const WINDOW_STATE_KEY = 'window';
const LOG_CATEGORY = 'api.reporting.submission-rate-limit';

const USER_ID = '01JQ0USR000000000000000001';
const OWNER_ID = '01JQ0USR000000000000000002';
const PRODUCT_ID = '01JQ0PRD000000000000000001';
const CLIENT_IP = '192.0.2.10';

const MEMBER: ReportSubmitter = Object.freeze({
  kind: 'member',
  userId: USER_ID,
});
const GUEST: ReportSubmitter = Object.freeze({ kind: 'guest' });

const hasher = createKeyedHasher(
  'test-pepper-for-counter-report-submission-rate-limit',
);

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

interface Hit {
  readonly rule: CounterRule;
  readonly key: HashedRateLimitKey;
}

interface FakeCounters {
  readonly client: RateLimitCounterClient;
  readonly hits: Hit[];
}

// キーごとの回数を数え、規則の上限を超えた回だけ拒否を返す偽の厳密カウンタ
function createFakeCounters(): FakeCounters {
  const hits: Hit[] = [];
  const counts = new Map<string, number>();
  const real = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
  return {
    hits,
    client: {
      hit(rule, key): Promise<CounterDecision> {
        hits.push({ rule, key });
        const resetAt = NOW.getTime() + rule.windowSeconds * 1000;
        const name = `${rule.name}:${key}`;
        const count = (counts.get(name) ?? 0) + 1;
        if (count > rule.limit) {
          return Promise.resolve({
            allowed: false,
            count: rule.limit,
            remaining: 0,
            resetAt,
          });
        }
        counts.set(name, count);
        return Promise.resolve({
          allowed: true,
          count,
          remaining: rule.limit - count,
          resetAt,
        });
      },
      reset: () => Promise.reject(new Error('通報の回数制限では使わない')),
      assertWithinLimit: (decision, now) => {
        real.assertWithinLimit(decision, now);
      },
    },
  };
}

function configureRecordingLogs(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  const methods: Record<ConsoleMethod, typeof record> = {
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
  };
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: methods as unknown as Console,
  });
  return logs;
}

const limitLogs = (logs: readonly LoggedObject[]): LoggedObject[] =>
  logs.filter((log) => log.category === LOG_CATEGORY);

async function caught(action: Promise<void>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

const uniqueIp = (): string => `2001:db8::${crypto.randomUUID().slice(0, 4)}`;

const uniqueUserId = (): string =>
  `01JQ0USR${crypto.randomUUID().replaceAll('-', '').slice(0, 18).toUpperCase()}`;

function counterStub(
  ruleName: string,
  key: HashedRateLimitKey,
): DurableObjectStub {
  const namespace = env.RATE_LIMIT_COUNTER;
  return namespace.get(namespace.idFromName(`${ruleName}:${key}`));
}

// 期間の始まりを1時間前へずらし、期間の終わりのAlarmを実行して1時間が経った後を再現する
async function elapseHour(
  ruleName: string,
  key: HashedRateLimitKey,
): Promise<readonly (readonly [string, unknown])[]> {
  const stub = counterStub(ruleName, key);
  await runInDurableObject(stub, (_instance, state) => {
    const current = state.storage.kv.get<WindowState>(WINDOW_STATE_KEY);
    if (current === undefined) {
      throw new Error('回数の記録がありません。');
    }
    state.storage.kv.put(WINDOW_STATE_KEY, {
      ...current,
      windowStartedAt: current.windowStartedAt - MILLISECONDS_PER_HOUR,
    });
  });
  await runDurableObjectAlarm(stub);
  return runInDurableObject(stub, (_instance, state) => [
    ...state.storage.kv.list(),
  ]);
}

afterEach(() => {
  resetSync();
});

describe('CounterReportSubmissionRateLimit の規則とキー', () => {
  test('規則は送信元IPアドレスごとと利用者ごとに1時間に10回である', () => {
    expect(REPORT_IP_RATE_RULE).toEqual({
      name: 'report:ip',
      limit: 10,
      windowSeconds: SECONDS_PER_HOUR,
    });
    expect(REPORT_USER_RATE_RULE).toEqual({
      name: 'report:user',
      limit: 10,
      windowSeconds: SECONDS_PER_HOUR,
    });
    expect(Object.isFrozen(REPORT_IP_RATE_RULE)).toBe(true);
    expect(Object.isFrozen(REPORT_USER_RATE_RULE)).toBe(true);
  });

  test('ログイン中の利用者は利用者の規則を先に、IPアドレスの規則を後に数える', async () => {
    const counters = createFakeCounters();
    const limit = new CounterReportSubmissionRateLimit(counters.client, hasher);

    await limit.consume(MEMBER, CLIENT_IP, NOW);

    expect(counters.hits.map(({ rule }) => rule)).toEqual([
      REPORT_USER_RATE_RULE,
      REPORT_IP_RATE_RULE,
    ]);
  });

  test('キーは用途ごとに利用者のIDと送信元IPアドレスをハッシュ化した値だけにする', async () => {
    const counters = createFakeCounters();
    const limit = new CounterReportSubmissionRateLimit(counters.client, hasher);

    await limit.consume(MEMBER, CLIENT_IP, NOW);

    expect(counters.hits.map(({ key }) => key)).toEqual([
      await hashRateLimitKey(hasher, 'report-user', USER_ID),
      await hashRateLimitKey(hasher, 'report', CLIENT_IP),
    ]);
    const serialized = JSON.stringify(counters.hits);
    expect(serialized).not.toContain(CLIENT_IP);
    expect(serialized).not.toContain(USER_ID);
  });

  test('未ログイン(停止中を含む)の通報は利用者の規則を使わず、IPアドレスの規則だけで数える', async () => {
    const counters = createFakeCounters();
    const limit = new CounterReportSubmissionRateLimit(counters.client, hasher);

    await limit.consume(GUEST, CLIENT_IP, NOW);

    expect(counters.hits.map(({ rule }) => rule)).toEqual([
      REPORT_IP_RATE_RULE,
    ]);
  });

  test('利用者の規則で拒否したら、IPアドレスの規則を数えずに429と再送までの秒数を返す', async () => {
    const counters = createFakeCounters();
    const limit = new CounterReportSubmissionRateLimit(counters.client, hasher);
    for (let sent = 0; sent < 10; sent += 1) {
      await limit.consume(MEMBER, `198.51.100.${String(sent)}`, NOW);
    }
    const before = counters.hits.length;

    const error = await caught(
      limit.consume(MEMBER, CLIENT_IP, new Date(NOW.getTime() + 600_000)),
    );

    expect(counters.hits.slice(before).map(({ rule }) => rule)).toEqual([
      REPORT_USER_RATE_RULE,
    ]);
    expect(error).toBeInstanceOf(AppError);
    const response = toErrorResponse(error as AppError);
    expect(response.status).toBe(429);
    expect(response.headers['Retry-After']).toBe('3000');
    expect(response.body.error).toEqual({
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
    });
  });

  test('IPアドレスの規則で拒否したら429を返し、先に数えた利用者の回数は戻さない', async () => {
    const counters = createFakeCounters();
    const limit = new CounterReportSubmissionRateLimit(counters.client, hasher);
    for (let sent = 0; sent < 10; sent += 1) {
      await limit.consume(GUEST, CLIENT_IP, NOW);
    }

    const error = await caught(limit.consume(MEMBER, CLIENT_IP, NOW));

    expect((error as AppError).kind).toBe('rate_limited');
    expect(counters.hits.slice(-2).map(({ rule }) => rule)).toEqual([
      REPORT_USER_RATE_RULE,
      REPORT_IP_RATE_RULE,
    ]);
  });

  test.each([
    ['不明', undefined],
    ['空文字列', ''],
  ])(
    '送信元IPアドレスが%sなら未ログインの通報を数えずに、IPアドレスを含まない警告を1件残す',
    async (_label, clientIp) => {
      const logs = configureRecordingLogs();
      const counters = createFakeCounters();
      const limit = new CounterReportSubmissionRateLimit(
        counters.client,
        hasher,
      );

      await limit.consume(GUEST, clientIp, NOW);

      expect(counters.hits).toEqual([]);
      expect(limitLogs(logs)).toMatchObject([
        { level: 'warning', reason: 'report-ip-missing' },
      ]);
    },
  );

  test('送信元IPアドレスが不明なら、ログイン中の利用者は利用者の規則だけで数えて警告を残す', async () => {
    const logs = configureRecordingLogs();
    const counters = createFakeCounters();
    const limit = new CounterReportSubmissionRateLimit(counters.client, hasher);

    await limit.consume(MEMBER, undefined, NOW);

    expect(counters.hits.map(({ rule }) => rule)).toEqual([
      REPORT_USER_RATE_RULE,
    ]);
    expect(limitLogs(logs)).toMatchObject([
      { level: 'warning', reason: 'report-ip-missing' },
    ]);
    expect(JSON.stringify(limitLogs(logs))).not.toContain(USER_ID);
  });

  test('数えた通報ではログを残さない', async () => {
    const logs = configureRecordingLogs();
    const counters = createFakeCounters();
    const limit = new CounterReportSubmissionRateLimit(counters.client, hasher);

    await limit.consume(MEMBER, CLIENT_IP, NOW);

    expect(limitLogs(logs)).toEqual([]);
  });
});

describe('CounterReportSubmissionRateLimit の実物の厳密カウンタ', () => {
  test('同じ送信元IPアドレスの11回目を拒否し、1時間後に回数を0に戻す', async () => {
    const counters = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
    const limit = new CounterReportSubmissionRateLimit(counters, hasher);
    const clientIp = uniqueIp();

    // 厳密カウンタの期間はDurable Objectの時計で始まるため、要求のたびにその時点の時刻を渡す
    for (let sent = 0; sent < 10; sent += 1) {
      await limit.consume(GUEST, clientIp, new Date());
    }
    const error = await caught(limit.consume(GUEST, clientIp, new Date()));
    const remaining = await elapseHour(
      REPORT_IP_RATE_RULE.name,
      await hashRateLimitKey(hasher, 'report', clientIp),
    );

    expect((error as AppError).kind).toBe('rate_limited');
    expect((error as AppError).retryAfterSeconds).toBeGreaterThan(0);
    expect((error as AppError).retryAfterSeconds).toBeLessThanOrEqual(
      SECONDS_PER_HOUR,
    );
    expect(remaining).toEqual([]);
    await expect(
      limit.consume(GUEST, clientIp, new Date()),
    ).resolves.toBeUndefined();
  });

  test('同じ利用者の11回目を送信元IPアドレスが違っても拒否し、1時間後に回数を0に戻す', async () => {
    const counters = createRateLimitCounterClient(env.RATE_LIMIT_COUNTER);
    const limit = new CounterReportSubmissionRateLimit(counters, hasher);
    const member: ReportSubmitter = { kind: 'member', userId: uniqueUserId() };

    for (let sent = 0; sent < 10; sent += 1) {
      await limit.consume(member, uniqueIp(), new Date());
    }
    const error = await caught(limit.consume(member, uniqueIp(), new Date()));
    const remaining = await elapseHour(
      REPORT_USER_RATE_RULE.name,
      await hashRateLimitKey(hasher, 'report-user', member.userId),
    );

    expect((error as AppError).kind).toBe('rate_limited');
    expect((error as AppError).retryAfterSeconds).toBeGreaterThan(0);
    expect(remaining).toEqual([]);
    await expect(
      limit.consume(member, uniqueIp(), new Date()),
    ).resolves.toBeUndefined();
  });

  test('コンテナで厳密カウンタのクライアントとハッシュ化の部品を注入して解決できる', async () => {
    const counters = createFakeCounters();
    const container = new Container();
    container
      .bind<RateLimitCounterClient>(PLATFORM_TYPES.RateLimitCounterClient)
      .toConstantValue(counters.client);
    container
      .bind<KeyedHasher>(PLATFORM_TYPES.KeyedHasher)
      .toConstantValue(hasher);
    container
      .bind<ReportSubmissionRateLimit>(
        REPORTING_TYPES.ReportSubmissionRateLimit,
      )
      .to(CounterReportSubmissionRateLimit);

    const limit = container.get<ReportSubmissionRateLimit>(
      REPORTING_TYPES.ReportSubmissionRateLimit,
    );
    await limit.consume(MEMBER, CLIENT_IP, NOW);

    expect(counters.hits).toHaveLength(2);
  });
});

describe('受け付けのユースケースと回数制限', () => {
  const SESSION: SessionView = Object.freeze({
    principal: () => Promise.resolve({ kind: 'anonymous' as const }),
  });

  const userOf = (status: 'active' | 'suspended'): CurrentUser => ({
    principal: {
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: USER_ID,
      sessionId: '01JQ0SES000000000000000001',
    },
    user: {
      id: USER_ID,
      pseudonymousId: '01JQ0PSE000000000000000001',
      status,
      emailVerifiedAt: NOW,
      deletedAt: null,
      email: 'member@mail.example',
      nickname: '通報するひと',
      handle: 'reporter',
    },
  });

  const notExpected = (): Promise<never> =>
    Promise.reject(new Error('呼ばれない想定です'));

  function assemble(currentUser: CurrentUser | undefined) {
    const counters = createFakeCounters();
    const submitted: ReportSubmissionRecord[] = [];
    const guard: AccountGuard = {
      currentUser: () => Promise.resolve(currentUser),
      requireUser: notExpected,
      requireWritableUser: notExpected,
      requireVerifiedUser: notExpected,
    };
    const categories: ReportCategoryStore = {
      list: notExpected,
      find: (id) =>
        Promise.resolve({
          id,
          name: 'その他',
          systemDefault: true,
          createdAt: NOW,
        }),
      countReports: notExpected,
      insert: notExpected,
      rename: notExpected,
      deleteAndReassign: notExpected,
    };
    const targets: ReportTargetResolver = {
      resolveForSubmission: () =>
        Promise.resolve({
          kind: 'product',
          targetId: PRODUCT_ID,
          ownerUserId: OWNER_ID,
          productId: PRODUCT_ID,
        }),
      describe: notExpected,
    };
    const store: ReportSubmissionStore = {
      submit: (record) => {
        submitted.push(record);
        return Promise.resolve('accepted');
      },
    };
    let sequence = 0;
    const service = new DefaultReportSubmissionService(
      guard,
      categories,
      targets,
      new CounterReportSubmissionRateLimit(counters.client, hasher),
      store,
      {
        generate: () => {
          sequence += 1;
          return `01JQ0GEN${String(sequence).padStart(18, '0')}`;
        },
      },
    );
    return { service, counters, submitted };
  }

  const submit = (service: DefaultReportSubmissionService): Promise<void> =>
    service.submit(
      SESSION,
      {
        targetKind: 'product',
        targetRef: PRODUCT_ID,
        categoryId: REPORT_CATEGORY_OTHER_ID,
        reason: '迷惑な宣伝です。',
        contactEmail: undefined,
      },
      { clientIp: CLIENT_IP, now: NOW },
    );

  test.each([
    ['未ログイン', undefined],
    ['停止中', userOf('suspended')],
  ] as const)(
    '%sの利用者の通報は利用者の規則を使わない',
    async (_label, currentUser) => {
      const { service, counters } = assemble(currentUser);

      await submit(service);

      expect(counters.hits.map(({ rule }) => rule)).toEqual([
        REPORT_IP_RATE_RULE,
      ]);
    },
  );

  test('停止していない利用者の通報は利用者の規則とIPアドレスの規則で数える', async () => {
    const { service, counters } = assemble(userOf('active'));

    await submit(service);

    expect(counters.hits.map(({ rule }) => rule)).toEqual([
      REPORT_USER_RATE_RULE,
      REPORT_IP_RATE_RULE,
    ]);
  });

  test('11回目の通報を拒否し、書き込まない', async () => {
    const { service, submitted } = assemble(userOf('active'));
    for (let sent = 0; sent < 10; sent += 1) {
      await submit(service);
    }

    const error = await caught(submit(service));

    expect((error as AppError).kind).toBe('rate_limited');
    expect(submitted).toHaveLength(10);
  });
});
