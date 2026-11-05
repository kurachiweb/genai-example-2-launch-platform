import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import { Hono } from 'hono';

import { createDatabase } from '../../db/client.ts';
import { SEARCH_INDEX_REFRESH_MESSAGE } from '../../lib/core/messaging/contracts/search-index-refresh.ts';
import type { QueueEnvelope } from '../../lib/core/messaging/envelope.ts';
import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import type { KeywordStatus } from '../../lib/core/search/keyword-status.ts';
import { createWorkerHandler } from '../../lib/workers/handler/create-worker-handler.ts';
import type { PlatformHonoEnv } from '../../lib/workers/http/hono-env.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../lib/workers/observability/sentry.ts';
import { createScheduledDispatcher } from '../../lib/workers/scheduling/scheduled-dispatcher.ts';
import { createSearchPlatformModule } from '../../lib/workers/search/search-platform-module.ts';
import {
  FIXTURE_SEARCH_TARGET_NAME,
  fixtureProductSearchDocuments,
  fixtureSearchTarget,
  setUpFixtureSearchTarget,
} from '../../lib/workers/search/testing/fixture-search-target.ts';
import { apiEnvSchema } from './env-schema.ts';
import { MODULES } from './modules.ts';
import { SCHEDULED_JOBS } from './scheduled-jobs.ts';
import { API_SEARCH_PLATFORM_MODULE } from './search-module.ts';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

const DAILY_CRON = '21 12 * * *';
const REEXTRACTION_JOB_NAME = 'content-processing.keyword-reextraction';
const REEXTRACTION_CATEGORY = 'api.search.reextraction';
const REFRESH_CATEGORY = 'api.search.refresh';
const MILLISECONDS_PER_MINUTE = 60_000;
const INSERT_CHUNK_SIZE = 10;

const db = createDatabase(env.DB);

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * MILLISECONDS_PER_MINUTE);
}

async function insertDocuments(
  rows: readonly (readonly [string, KeywordStatus, Date])[],
): Promise<void> {
  // D1は1文に束縛できる値の数に上限があるため、行を分けて書き込む
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_SIZE) {
    await db.insert(fixtureProductSearchDocuments).values(
      rows
        .slice(start, start + INSERT_CHUNK_SIZE)
        .map(([sourceId, keywordStatus, statusChangedAt]) => ({
          sourceId,
          keywordStatus,
          statusChangedAt,
        })),
    );
  }
}

function recordConsole(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(record);
  }
  return logs;
}

function recordSends(failingSourceIds: readonly string[] = []): string[] {
  const sourceIds: string[] = [];
  vi.spyOn(env.JOBS_QUEUE, 'send').mockImplementation((message) => {
    const envelope = message as QueueEnvelope;
    expect(envelope.type).toBe(SEARCH_INDEX_REFRESH_MESSAGE.type);
    const { target, sourceId } = envelope.body as {
      readonly target: string;
      readonly sourceId: string;
    };
    expect(target).toBe(FIXTURE_SEARCH_TARGET_NAME);
    sourceIds.push(sourceId);
    return failingSourceIds.includes(sourceId)
      ? Promise.reject(new Error('Queueに送れません'))
      : Promise.resolve({ metadata: { metrics: {} } } as QueueSendResponse);
  });
  return sourceIds;
}

// apiのエントリはDurable Objectを公開するため、テストより先に読み込まれて集約点のモジュールの差し替えが効かない。本物のジョブの一覧とモジュールの一覧のうち、検索の共通の束縛だけをテスト専用の検索対象で作り直す
function modulesWithFixtureTarget() {
  if (!MODULES.includes(API_SEARCH_PLATFORM_MODULE)) {
    throw new Error('モジュールの一覧に検索の共通の束縛がありません');
  }
  const fixturePlatformModule = createSearchPlatformModule(
    [fixtureSearchTarget],
    'api',
  );
  return MODULES.map((module) =>
    module === API_SEARCH_PLATFORM_MODULE ? fixturePlatformModule : module,
  );
}

const handler = createWorkerHandler<Env>({
  appName: 'api',
  app: new Hono<PlatformHonoEnv<Env>>(),
  envSchema: apiEnvSchema,
  sentry: (workerEnv) =>
    buildSentryOptions(readSentryRuntimeOptions(workerEnv)),
  scheduled: createScheduledDispatcher<Env>(
    createCronRegistry(SCHEDULED_JOBS),
    modulesWithFixtureTarget(),
  ),
});

async function runDailyScheduled(): Promise<void> {
  const { scheduled } = handler;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがありません');
  }
  const ctx = createExecutionContext();
  await scheduled(
    createScheduledController({ cron: DAILY_CRON, scheduledTime: Date.now() }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

function dailySummary(logs: readonly LoggedObject[]): LoggedObject | undefined {
  return logs.find(({ message }) => message === '定期実行を終えました');
}

beforeEach(async () => {
  await setUpFixtureSearchTarget(env.DB);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('検索対象のある日次の再抽出', () => {
  test('4:21の起動で、縮退と1時間以上の更新待ちの索引文書だけの更新を古い順に要求し、検索対象ごとの件数をログに出す', async () => {
    await insertDocuments([
      ['fallback-recent', 'fallback', minutesAgo(5)],
      ['pending-old', 'pending', minutesAgo(120)],
      ['pending-recent', 'pending', minutesAgo(30)],
      ['fallback-old', 'fallback', minutesAgo(600)],
      ['extracted-old', 'extracted', minutesAgo(600)],
      ['unsupported-old', 'unsupported', minutesAgo(600)],
      ['disabled-old', 'disabled', minutesAgo(600)],
    ]);
    const sent = recordSends();
    const logs = recordConsole();

    await runDailyScheduled();

    expect(sent).toEqual(['fallback-old', 'pending-old', 'fallback-recent']);
    expect(
      logs.filter(({ category }) => category === REEXTRACTION_CATEGORY),
    ).toEqual([
      expect.objectContaining({
        level: 'info',
        targets: [
          {
            target: FIXTURE_SEARCH_TARGET_NAME,
            status: 'completed',
            found: 3,
            requested: 3,
            failed: 0,
          },
        ],
        requested: 3,
        failed: 0,
      }),
    ]);
    expect(dailySummary(logs)).toMatchObject({
      result: 'succeeded',
      jobs: [
        expect.objectContaining({
          name: 'identity-auth.purge-orchestrator',
        }),
        expect.objectContaining({
          name: 'identity-auth.credential-cleanup',
        }),
        expect.objectContaining({
          name: 'identity-auth.disposable-recheck-sweep',
        }),
        expect.objectContaining({
          name: 'admin-foundation.credential-cleanup',
        }),
        expect.objectContaining({
          name: 'admin-foundation.audit-log-retention',
        }),
        expect.objectContaining({
          name: 'inquiry-chat.guest-inquiry-retention',
        }),
        expect.objectContaining({
          name: 'media-pipeline.expired-file-erasure',
        }),
        expect.objectContaining({ name: 'media-pipeline.moderation-requeue' }),
        expect.objectContaining({
          name: 'media-pipeline.location-reconciliation',
        }),
        expect.objectContaining({ name: 'email-delivery.cleanup' }),
        expect.objectContaining({
          name: REEXTRACTION_JOB_NAME,
          result: 'succeeded',
        }),
      ],
    });
  });

  test('1件の要求の送信が失敗しても、要求の部品が記録して残りの要求を続ける', async () => {
    await insertDocuments([
      ['first', 'fallback', minutesAgo(300)],
      ['second', 'fallback', minutesAgo(200)],
      ['third', 'fallback', minutesAgo(100)],
    ]);
    const sent = recordSends(['second']);
    const logs = recordConsole();

    await runDailyScheduled();

    expect(sent).toEqual(['first', 'second', 'third']);
    expect(
      logs.filter(({ category }) => category === REFRESH_CATEGORY),
    ).toEqual([
      expect.objectContaining({
        level: 'error',
        target: FIXTURE_SEARCH_TARGET_NAME,
        sourceId: 'second',
      }),
    ]);
    expect(
      logs.find(({ category }) => category === REEXTRACTION_CATEGORY),
    ).toMatchObject({
      level: 'info',
      requested: 3,
      failed: 0,
    });
  });

  test('検索対象ごとの上限200件までを要求する', async () => {
    await insertDocuments(
      Array.from(
        { length: 201 },
        (_, index) =>
          [
            `source-${String(index).padStart(3, '0')}`,
            'fallback',
            minutesAgo(500 - index),
          ] as const,
      ),
    );
    const sent = recordSends();
    recordConsole();

    await runDailyScheduled();

    expect(sent).toHaveLength(200);
    expect(sent.at(-1)).toBe('source-199');
  });
});
