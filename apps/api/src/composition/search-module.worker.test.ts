import { resetSync } from '@logtape/logtape';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { SEARCH_TYPES } from '../../lib/core/search/identifiers.ts';
import type { SearchTargetCatalog } from '../../lib/core/search/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { QueueSearchIndexRefreshRequester } from '../../lib/workers/search/search-index-refresh-requester.ts';
import { D1SearchIndexRepository } from '../../lib/workers/search/search-index-repository.ts';
import { SearchKeywordReextractionJob } from '../application/search/search-keyword-reextraction-job.ts';
import * as mainModule from '../index.ts';
import { MODULES } from './modules.ts';
import { SCHEDULED_JOBS } from './scheduled-jobs.ts';

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

// 業務日付2026-11-02の業務時刻4:21
const SCHEDULED_TIME = new Date(Date.UTC(2026, 10, 2, 12, 21));
const DAILY_CRON = '21 12 * * *';
const REEXTRACTION_JOB_NAME = 'content-processing.keyword-reextraction';
// 4:21の起動では、利用者のアカウントのジョブ(100番台)と、各specの削除のジョブの帯(800番台)のメディアのジョブが先に動く
const IDENTITY_JOB_NAMES = [
  'identity-auth.purge-orchestrator',
  'identity-auth.credential-cleanup',
  'identity-auth.disposable-recheck-sweep',
];
const ADMIN_JOB_NAMES = [
  'admin-foundation.credential-cleanup',
  'admin-foundation.audit-log-retention',
];
const INQUIRY_JOB_NAMES = ['inquiry-chat.guest-inquiry-retention'];
const PAYMENTS_JOB_NAMES = [
  'payments.pending-checkout-sweep',
  'payments.history-retention',
];
const ULTRAS_JOB_NAMES = ['ultras-subscription.pending-dispatch-sweep'];
const PROFILE_JOB_NAMES = ['user-profile-social.orphaned-file-sweep'];
const MEDIA_JOB_NAMES = [
  'media-pipeline.expired-file-erasure',
  'media-pipeline.moderation-requeue',
  'media-pipeline.location-reconciliation',
];
const PRODUCT_JOB_NAMES = [
  'product-launch.purge-orchestrator',
  'product-launch.lifecycle-redispatch',
];
const MATCH_JOB_NAMES = [
  'match-engine.event-redispatch',
  'match-engine.event-cleanup',
];
const REEXTRACTION_CATEGORY = 'api.search.reextraction';

function createContainer() {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'scheduled',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
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

async function runScheduled(cron: string, scheduledTime: Date): Promise<void> {
  const scheduled = mainModule.default.scheduled;
  if (scheduled === undefined) {
    throw new Error('定期実行のハンドラーがエクスポートされていません');
  }
  const ctx = createExecutionContext();
  await scheduled(
    createScheduledController({
      cron,
      scheduledTime: scheduledTime.getTime(),
    }),
    env,
    ctx,
  );
  await waitOnExecutionContext(ctx);
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('APIサーバーの検索のモジュール', () => {
  test('両サーバー共通の検索の束縛と、apiだけの再抽出のジョブを束縛する', () => {
    const container = createContainer();

    expect(
      container.get<SearchTargetCatalog>(SEARCH_TYPES.TargetCatalog).names(),
    ).toEqual(['product', 'help-article']);
    expect(container.get(SEARCH_TYPES.IndexStore)).toBeInstanceOf(
      D1SearchIndexRepository,
    );
    expect(container.get(SEARCH_TYPES.RefreshRequester)).toBeInstanceOf(
      QueueSearchIndexRefreshRequester,
    );
    expect(container.get(SEARCH_TYPES.ReextractionJob)).toBeInstanceOf(
      SearchKeywordReextractionJob,
    );
  });

  test('再抽出のジョブを業務時刻4:21の起動に、各specの削除のジョブの帯より後の順序2300で登録する', () => {
    expect(
      SCHEDULED_JOBS.find(({ name }) => name === REEXTRACTION_JOB_NAME),
    ).toEqual({
      name: REEXTRACTION_JOB_NAME,
      at: { hour: 4, minute: 21 },
      order: 2300,
      handler: SEARCH_TYPES.ReextractionJob,
    });
    expect(
      createCronRegistry(SCHEDULED_JOBS)
        .jobsFor(DAILY_CRON)
        .map(({ name }) => name),
    ).toEqual([
      ...IDENTITY_JOB_NAMES,
      ...ADMIN_JOB_NAMES,
      ...INQUIRY_JOB_NAMES,
      ...PAYMENTS_JOB_NAMES,
      ...ULTRAS_JOB_NAMES,
      ...PROFILE_JOB_NAMES,
      ...MEDIA_JOB_NAMES,
      'email-delivery.cleanup',
      ...PRODUCT_JOB_NAMES,
      ...MATCH_JOB_NAMES,
      REEXTRACTION_JOB_NAME,
    ]);
  });
});

describe('定期実行からの日次の再抽出', () => {
  test('再抽出の候補の索引文書が無い4:21の起動で、要求を送らずに検索対象ごとの要約をログに出して成功する', async () => {
    const send = vi.spyOn(env.JOBS_QUEUE, 'send');
    const logs = recordConsole();

    await runScheduled(DAILY_CRON, SCHEDULED_TIME);

    expect(send).not.toHaveBeenCalled();
    expect(
      logs.filter(({ category }) => category === REEXTRACTION_CATEGORY),
    ).toEqual([
      expect.objectContaining({
        level: 'info',
        targets: [
          {
            target: 'product',
            status: 'completed',
            found: 0,
            requested: 0,
            failed: 0,
          },
          {
            target: 'help-article',
            status: 'completed',
            found: 0,
            requested: 0,
            failed: 0,
          },
        ],
        requested: 0,
        failed: 0,
      }),
    ]);
    expect(
      logs.find(({ message }) => message === '定期実行を終えました'),
    ).toMatchObject({
      cron: DAILY_CRON,
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
          name: 'payments.pending-checkout-sweep',
        }),
        expect.objectContaining({ name: 'payments.history-retention' }),
        expect.objectContaining({
          name: 'ultras-subscription.pending-dispatch-sweep',
        }),
        expect.objectContaining({
          name: 'user-profile-social.orphaned-file-sweep',
        }),
        expect.objectContaining({
          name: 'media-pipeline.expired-file-erasure',
        }),
        expect.objectContaining({ name: 'media-pipeline.moderation-requeue' }),
        expect.objectContaining({
          name: 'media-pipeline.location-reconciliation',
        }),
        expect.objectContaining({ name: 'email-delivery.cleanup' }),
        expect.objectContaining({ name: PRODUCT_JOB_NAMES[0] }),
        expect.objectContaining({ name: PRODUCT_JOB_NAMES[1] }),
        expect.objectContaining({ name: MATCH_JOB_NAMES[0] }),
        expect.objectContaining({ name: MATCH_JOB_NAMES[1] }),
        expect.objectContaining({
          name: REEXTRACTION_JOB_NAME,
          result: 'succeeded',
        }),
      ],
    });
  });
});
