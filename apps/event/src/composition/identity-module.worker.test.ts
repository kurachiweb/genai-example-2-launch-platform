import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  createMessageBatch,
  type D1Migration,
  getQueueResult,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { emailCleanupCursors } from '../../db/schema/email/email-cleanup-cursors.ts';
import { emailSuppressions } from '../../db/schema/email/email-suppressions.ts';
import { users } from '../../db/schema/identity/users.ts';
import { EMAIL_TYPES } from '../../lib/core/email/identifiers.ts';
import type {
  SuppressionMaintenance,
  UserAddressDirectory,
} from '../../lib/core/email/ports.ts';
import type { DisposableEmailChecker } from '../../lib/core/identity/disposable-email.ts';
import {
  type LifecycleHandlerOutcome,
  USER_LIFECYCLE_RETRY_POLICY,
  type UserLifecycleAsyncHandler,
  type UserLifecycleAsyncRegistration,
} from '../../lib/core/identity/user-lifecycle.ts';
import {
  RECHECK_DISPOSABLE_EMAIL_MESSAGE,
  RUN_USER_LIFECYCLE_MESSAGE,
} from '../../lib/core/messaging/contracts/identity.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { decideOnFailure } from '../../lib/core/messaging/retry-policy.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { D1UserAddressDirectory } from '../../lib/workers/identity/d1-user-address-directory.ts';
import {
  after,
  clearIdentityTables,
  db,
  emailOf,
  eventIdOf,
  insertEvent,
  insertUser,
  readEvent,
  readHandlerRuns,
  T0,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import { createQueueDispatcher } from '../../lib/workers/messaging/queue-consumer.ts';
import { DisposableEmailRecheckHandler } from '../application/identity/disposable-email-recheck-handler.ts';
import { EmailSuppressionCleanupHandler } from '../application/identity/email-suppression-cleanup-handler.ts';
import { EVENT_IDENTITY_TYPES } from '../application/identity/event-identity-types.ts';
import { UserLifecycleRunner } from '../application/identity/user-lifecycle-runner.ts';
import worker from '../index.ts';
import {
  createEventIdentityModule,
  EVENT_IDENTITY_MODULE,
} from './identity-module.ts';
import { MESSAGE_HANDLERS } from './message-handlers.ts';
import { MODULES } from './modules.ts';

declare global {
  // @cloudflare/vitest-pool-workers 0.23.0の型定義はgetQueueResultの戻り値にこの型を使うが、宣言を含まない
  interface FetcherQueueResult {
    readonly outcome: string;
    readonly ackAll: boolean;
    readonly retryBatch: { readonly retry: boolean };
    readonly explicitAcks: readonly string[];
    readonly retryMessages: readonly { readonly msgId: string }[];
  }
}

interface MessageOutcome {
  readonly acked: boolean;
  readonly retried: boolean;
  readonly delaySeconds?: number;
}

interface DisifyRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: string;
}

type QueueHandler = (
  batch: MessageBatch,
  env: Env,
  ctx: ExecutionContext,
) => Promise<void>;

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const DISIFY_URL = 'https://disify.com/api/email';

const UNLINKED_CURSOR_NAME = 'email-delivery.unlinked-suppressions';

const CLEANUP_HANDLER_NAME = 'identity-auth.email-suppression-cleanup';

const OTHER_ADDRESS = 'other@mail.example';

// メッセージの本文の利用者IDはULIDの形でなければデッドレターへ移るため、ULIDの文字だけで作る
const RECHECK_USER_ID = '01JC0RECHECK00000000000001';

let disifyRequests: DisifyRequest[];

function createContainer(overrides: Partial<Env> = {}): Container {
  return createInvocationContainer(
    {
      env: { ...env, ...overrides },
      executionCtx: createExecutionContext(),
      info: {
        kind: 'queue',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

let envelopeCount = 0;

// 封筒のIDはULIDの形でなければデッドレターへ移るため、ULIDの形の連番を振る
function envelopeOf(type: string, body: unknown): QueueEnvelope {
  envelopeCount += 1;
  return {
    v: 1,
    type,
    id: `01JC0MSG${String(envelopeCount).padStart(18, '0')}`,
    sentAt: T0.toISOString(),
    body,
  };
}

const defaultQueueHandler: QueueHandler = async (batch, runtimeEnv, ctx) => {
  const { queue } = worker;
  if (queue === undefined) {
    throw new Error('イベントサーバーのエントリにqueueハンドラーが無い');
  }
  await queue(batch, runtimeEnv, ctx);
};

// retry()は遅延の指定を記録しないため、ack・retryの状態はgetQueueResultで、遅延秒数はretryの呼び出しの引数で確かめる
async function dispatch(
  envelope: QueueEnvelope,
  options: { readonly attempts?: number; readonly handler?: QueueHandler } = {},
): Promise<MessageOutcome> {
  const batch = createMessageBatch(env.JOBS_QUEUE_NAME, [
    {
      id: envelope.id,
      timestamp: T0,
      attempts: options.attempts ?? 1,
      body: envelope,
    },
  ]);
  const [message] = batch.messages;
  if (message === undefined) {
    throw new Error('バッチにメッセージが無い');
  }
  const retrySpy = vi.spyOn(message, 'retry');
  const deadLetterSpy = vi.spyOn(env.JOBS_DLQ, 'send');
  const ctx = createExecutionContext();
  await (options.handler ?? defaultQueueHandler)(batch, env, ctx);
  const { explicitAcks, retryMessages } = await getQueueResult(batch, ctx);
  // 封筒や本文の不正でデッドレターへ移ったメッセージもackされるため、処理まで届いたことを確かめる
  expect(deadLetterSpy).not.toHaveBeenCalled();
  const retried = retryMessages.some(({ msgId }) => msgId === message.id);
  const delaySeconds = retrySpy.mock.calls.at(-1)?.[0]?.delaySeconds;
  return {
    acked: explicitAcks.includes(message.id),
    retried,
    ...(retried && delaySeconds !== undefined ? { delaySeconds } : {}),
  };
}

function stubDisify(response: () => Response): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url !== DISIFY_URL) {
      throw new Error(`想定外の外部への要求: ${request.url}`);
    }
    disifyRequests.push({
      url: request.url,
      headers: request.headers,
      body: await request.text(),
    });
    return response();
  });
}

function disifyJson(body: unknown, status = 200): () => Response {
  return () => Response.json(body, { status });
}

async function insertSuppression(address: string): Promise<void> {
  await db.insert(emailSuppressions).values({
    address,
    lastReason: 'hard_bounce',
    lastEventAt: T0,
    createdAt: T0,
    updatedAt: T0,
  });
}

async function suppressedAddresses(): Promise<string[]> {
  const rows = await db
    .select({ address: emailSuppressions.address })
    .from(emailSuppressions)
    .orderBy(emailSuppressions.address);
  return rows.map((row) => row.address);
}

async function readDisposableColumns() {
  const [row] = await db
    .select({
      status: users.disposableEmailStatus,
      checkedAt: users.disposableEmailCheckedAt,
    })
    .from(users)
    .where(eq(users.id, RECHECK_USER_ID));
  return row;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  disifyRequests = [];
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearIdentityTables();
  await db.delete(emailSuppressions);
  await db.delete(emailCleanupCursors);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('イベントサーバーのidentityの束縛', () => {
  test('処理単位のコンテナから2つのメッセージの処理と退会の波及処理、照会口と抑止記録の後始末を解決する', () => {
    const container = createContainer();

    expect(
      container.get(EVENT_IDENTITY_TYPES.UserLifecycleRunner),
    ).toBeInstanceOf(UserLifecycleRunner);
    expect(
      container.get(EVENT_IDENTITY_TYPES.DisposableEmailRecheckHandler),
    ).toBeInstanceOf(DisposableEmailRecheckHandler);
    expect(
      container.get(EVENT_IDENTITY_TYPES.EmailSuppressionCleanupHandler),
    ).toBeInstanceOf(EmailSuppressionCleanupHandler);
    expect(
      container.get<UserAddressDirectory>(EMAIL_TYPES.UserAddressDirectory),
    ).toBeInstanceOf(D1UserAddressDirectory);
    expect(
      container.get<SuppressionMaintenance>(EMAIL_TYPES.SuppressionMaintenance),
    ).toHaveProperty('deleteByAddress');
  });

  test.each([
    { label: '設定されていれば', apiKey: ['disify', 'test', 'key'].join('-') },
    { label: '空文字なら', apiKey: '' },
    { label: '未設定なら', apiKey: undefined },
  ])(
    '使い捨てメールアドレスの判定は、任意のキーが$label環境の値に従い、イベントサーバーのUser-Agentで送る',
    async ({ apiKey }) => {
      stubDisify(disifyJson({ format: true, disposable: false }));
      const checker = createContainer({
        DISIFY_API_KEY: apiKey,
      } as Partial<Env>).get<DisposableEmailChecker>(
        EVENT_IDENTITY_TYPES.DisposableEmailChecker,
      );

      await expect(checker.check('someone@mail.example')).resolves.toBe(
        'regular',
      );

      expect(disifyRequests).toHaveLength(1);
      expect(disifyRequests[0]?.headers.get('x-api-key')).toBe(
        apiKey === '' || apiKey === undefined ? null : apiKey,
      );
      expect(disifyRequests[0]?.headers.get('user-agent')).toBe(
        'genai-example-2-event',
      );
    },
  );
});

describe('退会の抑止記録の削除', () => {
  test('退会のライフサイクルイベントのメッセージで、利用者のメールアドレスの抑止記録と続きの位置を消し、波及処理とイベントを完了する', async () => {
    await insertUser(1, { deletedAt: after(1000) });
    await insertSuppression(emailOf(1).toUpperCase());
    await insertSuppression(OTHER_ADDRESS);
    await db.insert(emailCleanupCursors).values({
      name: UNLINKED_CURSOR_NAME,
      afterKey: emailOf(1),
      createdAt: T0,
      updatedAt: T0,
    });
    await insertEvent(10, { userId: userIdOf(1), type: 'withdrawn' });

    const outcome = await dispatch(
      envelopeOf(RUN_USER_LIFECYCLE_MESSAGE.type, { eventId: eventIdOf(10) }),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    expect(await suppressedAddresses()).toEqual([OTHER_ADDRESS]);
    expect(await db.select().from(emailCleanupCursors)).toEqual([]);
    expect(await readHandlerRuns()).toMatchObject([
      { eventId: eventIdOf(10), handlerName: CLEANUP_HANDLER_NAME },
    ]);
    expect(await readEvent(10)).toMatchObject({ status: 'completed' });
  });

  test('停止のライフサイクルイベントでは抑止記録を消さない', async () => {
    await insertUser(1, { status: 'suspended', suspendedAt: after(1000) });
    await insertSuppression(emailOf(1));
    await insertEvent(10, { userId: userIdOf(1), type: 'suspended' });

    const outcome = await dispatch(
      envelopeOf(RUN_USER_LIFECYCLE_MESSAGE.type, { eventId: eventIdOf(10) }),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    expect(await suppressedAddresses()).toEqual([emailOf(1)]);
    expect(await readEvent(10)).toMatchObject({ status: 'completed' });
  });

  test('利用者の行が既に無ければ、抑止記録を消さずに完了する', async () => {
    await insertSuppression(emailOf(1));
    const handler = createContainer().get<UserLifecycleAsyncHandler>(
      EVENT_IDENTITY_TYPES.EmailSuppressionCleanupHandler,
    );

    await expect(
      handler.handle({
        id: eventIdOf(10),
        userId: userIdOf(1),
        type: 'withdrawn',
        occurredAt: T0,
      }),
    ).resolves.toEqual({ kind: 'done' });

    expect(await suppressedAddresses()).toEqual([emailOf(1)]);
  });
});

describe('使い捨てメールアドレスの判定し直し', () => {
  test('未判定の確認済みの利用者を、ローカル部を置き換えたアドレスで判定し直し、結果と判定の日時を保存する', async () => {
    stubDisify(disifyJson({ format: true, disposable: true }));
    await insertUser(1, {
      id: RECHECK_USER_ID,
      emailVerifiedAt: after(1000),
      disposableEmailStatus: 'undetermined',
      disposableEmailCheckedAt: after(1000),
    });

    const outcome = await dispatch(
      envelopeOf(RECHECK_DISPOSABLE_EMAIL_MESSAGE.type, {
        userId: RECHECK_USER_ID,
      }),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    expect(disifyRequests.map(({ body }) => body)).toEqual([
      new URLSearchParams({ email: 'dummy@mail.example' }).toString(),
    ]);
    const columns = await readDisposableColumns();
    expect(columns?.status).toBe('disposable');
    expect(columns?.checkedAt?.getTime()).toBeGreaterThan(
      after(1000).getTime(),
    );
  });

  test('判定サービスが使えなくても例外にせず、未判定と判定の日時を保存して完了する', async () => {
    stubDisify(disifyJson({ error: 'unavailable' }, 503));
    await insertUser(1, {
      id: RECHECK_USER_ID,
      emailVerifiedAt: after(1000),
      disposableEmailStatus: 'undetermined',
      disposableEmailCheckedAt: after(1000),
    });

    const outcome = await dispatch(
      envelopeOf(RECHECK_DISPOSABLE_EMAIL_MESSAGE.type, {
        userId: RECHECK_USER_ID,
      }),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    const columns = await readDisposableColumns();
    expect(columns?.status).toBe('undetermined');
    expect(columns?.checkedAt?.getTime()).toBeGreaterThan(
      after(1000).getTime(),
    );
  });

  test.each([
    {
      label: '退会済み',
      columns: {
        emailVerifiedAt: after(1000),
        disposableEmailStatus: 'undetermined',
        disposableEmailCheckedAt: after(1000),
        deletedAt: after(2000),
      },
    },
    {
      label: '未確認',
      columns: {
        disposableEmailStatus: 'undetermined',
        disposableEmailCheckedAt: after(1000),
      },
    },
    {
      label: '判定済み',
      columns: {
        emailVerifiedAt: after(1000),
        disposableEmailStatus: 'regular',
        disposableEmailCheckedAt: after(1000),
      },
    },
  ] as const)(
    '$labelの利用者は判定サービスを呼ばず、判定を変えずに完了する',
    async ({ columns }) => {
      stubDisify(disifyJson({ format: true, disposable: true }));
      await insertUser(1, { ...columns, id: RECHECK_USER_ID });

      const outcome = await dispatch(
        envelopeOf(RECHECK_DISPOSABLE_EMAIL_MESSAGE.type, {
          userId: RECHECK_USER_ID,
        }),
      );

      expect(outcome).toStrictEqual({ acked: true, retried: false });
      expect(disifyRequests).toEqual([]);
      expect(await readDisposableColumns()).toEqual({
        status: columns.disposableEmailStatus,
        checkedAt: after(1000),
      });
    },
  );
});

describe('ライフサイクルの実行のメッセージと登録した波及処理', () => {
  const FIRST = Symbol.for('test.FirstLifecycleHandler');
  const SECOND = Symbol.for('test.SecondLifecycleHandler');

  const FAKE_REGISTRATIONS: readonly UserLifecycleAsyncRegistration[] = [
    {
      name: 'identity-auth-test.second',
      events: ['withdrawn'],
      order: 20,
      handler: SECOND,
    },
    {
      name: 'identity-auth-test.first',
      events: ['withdrawn'],
      order: 10,
      handler: FIRST,
    },
  ];

  function createFakeDispatcher(
    calls: string[],
    secondFailures: { remaining: number },
  ): QueueHandler {
    const fakeHandler = (
      name: string,
      fail: () => boolean,
    ): UserLifecycleAsyncHandler => ({
      handle: (): Promise<LifecycleHandlerOutcome> => {
        calls.push(name);
        return fail()
          ? Promise.reject(new Error(`${name}の失敗`))
          : Promise.resolve({ kind: 'done' });
      },
    });
    const fakes = {
      name: 'fake-lifecycle-handlers',
      bindings: new ContainerModule(({ bind }) => {
        bind<UserLifecycleAsyncHandler>(FIRST).toConstantValue(
          fakeHandler('first', () => false),
        );
        bind<UserLifecycleAsyncHandler>(SECOND).toConstantValue(
          fakeHandler('second', () => {
            if (secondFailures.remaining === 0) {
              return false;
            }
            secondFailures.remaining -= 1;
            return true;
          }),
        );
      }),
    };
    const modules = [
      ...MODULES.map((module) =>
        module === EVENT_IDENTITY_MODULE
          ? createEventIdentityModule({ asyncHandlers: FAKE_REGISTRATIONS })
          : module,
      ),
      fakes,
    ];
    const dispatcher = createQueueDispatcher(MESSAGE_HANDLERS, modules);
    return (batch, runtimeEnv, ctx) =>
      dispatcher.dispatch(batch, runtimeEnv, ctx);
  }

  test('組み立ての一覧に本specのモジュールが含まれる', () => {
    expect(MODULES).toContain(EVENT_IDENTITY_MODULE);
  });

  test('登録の順に呼び、失敗した波及処理は本specの再試行の方針で再試行され、完了済みの波及処理を飛ばして続きから完了する', async () => {
    const calls: string[] = [];
    const handler = createFakeDispatcher(calls, { remaining: 1 });
    await insertUser(1, { deletedAt: after(1000) });
    await insertEvent(10, { userId: userIdOf(1), type: 'withdrawn' });
    const envelope = envelopeOf(RUN_USER_LIFECYCLE_MESSAGE.type, {
      eventId: eventIdOf(10),
    });

    const expected = decideOnFailure(USER_LIFECYCLE_RETRY_POLICY, 1);
    if (expected.kind !== 'retry') {
      throw new Error('1回目の失敗は再試行になるはず');
    }

    const first = await dispatch(envelope, { attempts: 1, handler });

    expect(first).toStrictEqual({
      acked: false,
      retried: true,
      delaySeconds: expected.delaySeconds,
    });
    expect(expected.delaySeconds).toBe(
      USER_LIFECYCLE_RETRY_POLICY.baseDelaySeconds,
    );
    expect(calls).toEqual(['first', 'second']);
    expect(await readHandlerRuns()).toMatchObject([
      { eventId: eventIdOf(10), handlerName: 'identity-auth-test.first' },
    ]);
    expect(await readEvent(10)).toMatchObject({ status: 'pending' });

    const second = await dispatch(envelope, { attempts: 2, handler });

    expect(second).toStrictEqual({ acked: true, retried: false });
    expect(calls).toEqual(['first', 'second', 'second']);
    expect(await readHandlerRuns()).toMatchObject([
      { eventId: eventIdOf(10), handlerName: 'identity-auth-test.first' },
      { eventId: eventIdOf(10), handlerName: 'identity-auth-test.second' },
    ]);
    expect(await readEvent(10)).toMatchObject({ status: 'completed' });
  });
});
