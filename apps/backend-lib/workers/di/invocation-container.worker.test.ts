import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { type Container, ContainerModule, inject, injectable } from 'inversify';
import { describe, expect, test } from 'vitest';
import { z } from 'zod';

import type { Database } from '../../../db/client.ts';
import {
  createKeyedHasher,
  hashPurpose,
  type KeyedHasher,
} from '../../core/crypto/keyed-hasher.ts';
import type { AppModule } from '../../core/di/app-module.ts';
import {
  type InvocationScopeInfo,
  PLATFORM_TYPES,
} from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { defineMessageContract } from '../../core/messaging/message-contract.ts';
import { type Clock, systemClock } from '../../core/time/clock.ts';
import type { PlatformEnv } from '../env/platform-env.ts';
import {
  type MessagePublisher,
  MessagePublishError,
} from '../messaging/queue-publisher.ts';
import {
  createInvocationContainer,
  type InvocationScope,
} from './invocation-container.ts';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const TEST_TYPES = Object.freeze({
  ReportService: Symbol.for('test.ReportService'),
});

@injectable()
class ReportService {
  constructor(
    @inject(PLATFORM_TYPES.Database) readonly database: Database,
    @inject(PLATFORM_TYPES.Clock) readonly clock: Clock,
    @inject(PLATFORM_TYPES.InvocationScope)
    readonly scope: InvocationScope<PlatformEnv>,
  ) {}
}

interface PlatformInstances {
  readonly database: Database;
  readonly idGenerator: IdGenerator;
  readonly keyedHasher: KeyedHasher;
  readonly messagePublisher: MessagePublisher;
}

function createScope(
  kind: InvocationScopeInfo['kind'],
  correlationId: string,
): InvocationScope<typeof env> {
  return {
    env,
    executionCtx: createExecutionContext(),
    info: { kind, correlationId, clientIp: undefined },
  };
}

function resolvePlatformInstances(container: Container): PlatformInstances {
  return {
    database: container.get<Database>(PLATFORM_TYPES.Database),
    idGenerator: container.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
    keyedHasher: container.get<KeyedHasher>(PLATFORM_TYPES.KeyedHasher),
    messagePublisher: container.get<MessagePublisher>(
      PLATFORM_TYPES.MessagePublisher,
    ),
  };
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('失敗するはずの処理が成功した');
}

describe('createInvocationContainer', () => {
  test('基盤の依存を識別子で解決できる', async () => {
    const scope = createScope('fetch', 'correlation-platform');
    const container = createInvocationContainer(scope, []);
    const purpose = hashPurpose('test.invocation-container');

    const { database, idGenerator, keyedHasher, messagePublisher } =
      resolvePlatformInstances(container);

    expect(container.get(PLATFORM_TYPES.Env)).toBe(env);
    expect(container.get(PLATFORM_TYPES.InvocationScope)).toBe(scope);
    expect(container.get(PLATFORM_TYPES.Clock)).toBe(systemClock);
    expect(idGenerator.generate()).toMatch(ULID_PATTERN);
    expect(await keyedHasher.hash(purpose, 'value')).toBe(
      await createKeyedHasher(env.HASH_PEPPER).hash(purpose, 'value'),
    );
    expect(
      await database.get<{ answer: number }>(sql`select 42 as answer`),
    ).toEqual({ answer: 42 });
    const unregisteredContract = defineMessageContract(
      'test.unregistered-job',
      z.object({}),
    );
    const rejection = await captureRejection(
      messagePublisher.publish(unregisteredContract, {}),
    );
    expect(rejection).toBeInstanceOf(MessagePublishError);
    expect((rejection as MessagePublishError).reason).toBe('unknown-type');
  });

  test('アプリが束縛する依存は基盤では束縛しない', () => {
    const container = createInvocationContainer(
      createScope('queue', 'correlation-unbound'),
      [],
    );

    expect(container.isBound(PLATFORM_TYPES.BotVerifier)).toBe(false);
    expect(container.isBound(PLATFORM_TYPES.RateLimitCounterClient)).toBe(
      false,
    );
  });

  test('同時に処理される2つの処理単位が別のデータベースと処理単位内で単一のインスタンスを受け取る', async () => {
    const runInvocation = async (
      scope: InvocationScope<typeof env>,
    ): Promise<readonly [PlatformInstances, PlatformInstances]> => {
      const container = createInvocationContainer(scope, []);
      const first = resolvePlatformInstances(container);
      await first.database.run(sql`select 1`);
      const second = resolvePlatformInstances(container);
      return [first, second];
    };

    const [[firstOfA, secondOfA], [firstOfB, secondOfB]] = await Promise.all([
      runInvocation(createScope('fetch', 'correlation-a')),
      runInvocation(createScope('scheduled', 'correlation-b')),
    ]);

    for (const key of [
      'database',
      'idGenerator',
      'keyedHasher',
      'messagePublisher',
    ] as const) {
      expect(secondOfA[key]).toBe(firstOfA[key]);
      expect(secondOfB[key]).toBe(firstOfB[key]);
      expect(firstOfB[key]).not.toBe(firstOfA[key]);
    }
  });

  test('モジュールの束縛を基盤の束縛の後に読み込み、注入先を識別子で解決する', () => {
    let platformBoundBeforeModule = false;
    const reportModule: AppModule<
      Hono<{ Variables: { container: Container } }>
    > = {
      name: 'report',
      bindings: new ContainerModule(({ bind, isBound }) => {
        platformBoundBeforeModule =
          isBound(PLATFORM_TYPES.Database) &&
          isBound(PLATFORM_TYPES.MessagePublisher);
        bind(TEST_TYPES.ReportService).to(ReportService);
      }),
      routes: (app) => {
        app.get('/reports', (c) => c.text('ok'));
      },
    };
    const routesOnlyModule: AppModule = { name: 'routes-only' };
    const scope = createScope('fetch', 'correlation-module');

    const container = createInvocationContainer(scope, [
      routesOnlyModule,
      reportModule,
    ]);
    const first = container.get<ReportService>(TEST_TYPES.ReportService);
    const second = container.get<ReportService>(TEST_TYPES.ReportService);

    expect(platformBoundBeforeModule).toBe(true);
    expect(first).toBeInstanceOf(ReportService);
    expect(first.database).toBe(container.get(PLATFORM_TYPES.Database));
    expect(first.clock).toBe(systemClock);
    expect(first.scope).toBe(scope);
    expect(second).not.toBe(first);
  });
});
