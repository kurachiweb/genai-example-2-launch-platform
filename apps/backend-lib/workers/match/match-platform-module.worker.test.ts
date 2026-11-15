import { resetSync } from '@logtape/logtape';
import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import {
  afterAll,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { MATCH_PLATFORM_TYPES } from '../../core/match/identifiers.ts';
import type {
  MatchDirectory,
  MatchEventDispatcher,
  MatchEventStore,
  MatchExport,
  MatchScheduler,
  SupporterDirectory,
  UpvoteExport,
} from '../../core/match/ports.ts';
import { RUN_MATCH_EVENT_MESSAGE } from '../../core/messaging/contracts/match.ts';
import type { QueueEnvelope } from '../../core/messaging/envelope.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import {
  ensureLoggingConfigured,
  type LoggingOptions,
} from '../logging/configure-logging.ts';
import {
  D1MatchDirectory,
  D1SupporterDirectory,
} from './d1-match-directory.ts';
import { D1MatchEventStore } from './d1-match-event-store.ts';
import { D1MatchExport, D1UpvoteExport } from './d1-match-export.ts';
import { D1MatchScheduler } from './d1-match-scheduler.ts';
import { createMatchPlatformModule } from './match-platform-module.ts';
import { QueueMatchEventDispatcher } from './queue-match-event-dispatcher.ts';
import { AFTER_DECISION } from './testing/directory-fixtures.ts';
import { readMatchEvents } from './testing/event-fixtures.ts';
import {
  SAMPLE_MATCH_ID,
  SAMPLE_SCHEDULED_MATCH_ID,
  SAMPLE_SUPPORTER_ID,
  SAMPLE_UPVOTE_ID,
  SAMPLE_WINNER_ENTRY_ID,
  SAMPLE_WINNER_LAUNCH_ID,
  sampleQualifierInput,
  seedMatchPlatformSample,
} from './testing/match-platform-fixtures.ts';

interface RecordingQueue {
  readonly queue: Queue;
  readonly sent: unknown[];
}

interface LoggedObject {
  readonly category: string;
  readonly message: string;
}

const BOUND_IDENTIFIERS = Object.values(MATCH_PLATFORM_TYPES);

const SCHEDULED_AT = new Date('2026-11-19T14:45:00.000Z');

function createRecordingQueue(failing = false): RecordingQueue {
  const sent: unknown[] = [];
  const queue: Queue = {
    metrics: () => Promise.reject(new Error('テストでは使わない')),
    send: (body) => {
      if (failing) {
        return Promise.reject(new Error('Queueへの送信に失敗しました'));
      }
      sent.push(body);
      return Promise.resolve({
        metadata: { metrics: { backlogCount: sent.length, backlogBytes: 0 } },
      });
    },
    sendBatch: () => Promise.reject(new Error('テストでは使わない')),
  };
  return { queue, sent };
}

function createContainer({
  kind = 'fetch',
  appName = 'api',
  jobsQueue = env.JOBS_QUEUE,
}: {
  readonly kind?: InvocationScopeInfo['kind'];
  readonly appName?: LoggingOptions['appName'];
  readonly jobsQueue?: Queue;
} = {}): Container {
  return createInvocationContainer(
    {
      env: { ...env, JOBS_QUEUE: jobsQueue },
      executionCtx: createExecutionContext(),
      info: {
        kind,
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [createMatchPlatformModule(appName)],
  );
}

beforeEach(seedMatchPlatformSample);

afterAll(() => {
  resetSync();
});

describe('createMatchPlatformModule', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられる', () => {
    const module = createMatchPlatformModule('api');
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      module,
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(module.name).toBe('match-platform');
    expect('routes' in module).toBe(false);
  });

  test('マッチとサポーターの照会をD1の実装に解決し、確定した予選の結果とサポーターを引ける', async () => {
    const container = createContainer();
    const matches = container.get<MatchDirectory>(
      MATCH_PLATFORM_TYPES.MatchDirectory,
    );
    const supporters = container.get<SupporterDirectory>(
      MATCH_PLATFORM_TYPES.SupporterDirectory,
    );

    expect(matches).toBeInstanceOf(D1MatchDirectory);
    expect(supporters).toBeInstanceOf(D1SupporterDirectory);
    await expect(
      matches.findQualifierResults([SAMPLE_WINNER_LAUNCH_ID]),
    ).resolves.toEqual(
      new Map([
        [
          SAMPLE_WINNER_LAUNCH_ID,
          expect.objectContaining({ matchId: SAMPLE_MATCH_ID, result: 'won' }),
        ],
      ]),
    );
    await expect(
      supporters.listSupporters({
        entryId: SAMPLE_WINNER_ENTRY_ID,
        after: undefined,
        limit: 20,
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        upvoteId: SAMPLE_UPVOTE_ID,
        userId: SAMPLE_SUPPORTER_ID,
      }),
    ]);
  });

  test('マッチとUpvoteのデータエクスポートの照会をD1の実装に解決し、ローンチと利用者の行を引ける', async () => {
    const container = createContainer();
    const matchExport = container.get<MatchExport>(
      MATCH_PLATFORM_TYPES.MatchExport,
    );
    const upvoteExport = container.get<UpvoteExport>(
      MATCH_PLATFORM_TYPES.UpvoteExport,
    );

    expect(matchExport).toBeInstanceOf(D1MatchExport);
    expect(upvoteExport).toBeInstanceOf(D1UpvoteExport);
    await expect(
      matchExport.listForLaunches([SAMPLE_WINNER_LAUNCH_ID]),
    ).resolves.toEqual(
      new Map([
        [
          SAMPLE_WINNER_LAUNCH_ID,
          [
            expect.objectContaining({
              matchId: SAMPLE_MATCH_ID,
              result: 'won',
            }),
          ],
        ],
      ]),
    );
    await expect(upvoteExport.listByUser(SAMPLE_SUPPORTER_ID)).resolves.toEqual(
      [expect.objectContaining({ matchId: SAMPLE_MATCH_ID })],
    );
  });

  test('予定の作成を束縛した送信の実装と組んで解決し、作ったイベントを処理単位のQueueへ送る', async () => {
    const { queue, sent } = createRecordingQueue();
    const container = createContainer({ jobsQueue: queue });
    const scheduler = container.get<MatchScheduler>(
      MATCH_PLATFORM_TYPES.MatchScheduler,
    );

    expect(scheduler).toBeInstanceOf(D1MatchScheduler);
    await expect(
      scheduler.schedule([sampleQualifierInput()], SCHEDULED_AT),
    ).resolves.toEqual({ created: [SAMPLE_SCHEDULED_MATCH_ID], skipped: [] });

    const events = await readMatchEvents();
    const scheduled = events.filter(
      (event) => event.matchId === SAMPLE_SCHEDULED_MATCH_ID,
    );
    expect(scheduled).toHaveLength(1);
    expect(sent).toEqual([
      expect.objectContaining<Partial<QueueEnvelope>>({
        type: RUN_MATCH_EVENT_MESSAGE.type,
        body: { eventId: scheduled[0]?.id },
      }),
    ]);
  });

  test('イベントの記録をD1の実装に解決し、作ったイベントを引ける', async () => {
    const container = createContainer();
    const store = container.get<MatchEventStore>(
      MATCH_PLATFORM_TYPES.MatchEventStore,
    );

    expect(store).toBeInstanceOf(D1MatchEventStore);
    const [eventId] = await store.createMissingDecidedEvents(
      new Date(0),
      AFTER_DECISION,
      10,
    );
    expect(eventId).toBeDefined();
    await expect(store.findEvent(eventId ?? '')).resolves.toMatchObject({
      id: eventId,
      matchId: SAMPLE_MATCH_ID,
      type: 'decided',
      status: 'pending',
    });
  });

  test('イベントの送信のログのカテゴリは、モジュールに渡したアプリの名前で始まる', async () => {
    const logs: LoggedObject[] = [];
    const record = (logged: unknown) => {
      logs.push(logged as LoggedObject);
    };
    ensureLoggingConfigured({
      appName: 'event',
      level: 'debug',
      console: {
        debug: record,
        info: record,
        warn: record,
        error: record,
      } as unknown as Console,
    });
    const { queue } = createRecordingQueue(true);
    const dispatcher = createContainer({
      appName: 'event',
      jobsQueue: queue,
    }).get<MatchEventDispatcher>(MATCH_PLATFORM_TYPES.MatchEventDispatcher);

    expect(dispatcher).toBeInstanceOf(QueueMatchEventDispatcher);
    await dispatcher.publish(['01JD0MEVT00000000000000001']);

    expect(
      logs
        .filter(({ message }) => message.startsWith('マッチイベント'))
        .map((log) => log.category),
    ).toEqual(['event.match.events']);
  });

  test.each(['fetch', 'queue', 'scheduled'] as const)(
    '%sの処理単位でも束縛した7つの識別子をすべて解決する',
    (kind) => {
      const container = createContainer({ kind });

      expect(BOUND_IDENTIFIERS).toHaveLength(7);
      for (const identifier of BOUND_IDENTIFIERS) {
        expect(container.get(identifier)).toBeDefined();
      }
    },
  );

  test('照会・予定の作成・イベントの記録と送信・エクスポートは処理単位の中では同じインスタンスを返し、別の処理単位では別のインスタンスを返す', () => {
    const first = createContainer();
    const second = createContainer();

    for (const identifier of BOUND_IDENTIFIERS) {
      expect(first.get(identifier)).toBe(first.get(identifier));
      expect(second.get(identifier)).not.toBe(first.get(identifier));
    }
  });
});
