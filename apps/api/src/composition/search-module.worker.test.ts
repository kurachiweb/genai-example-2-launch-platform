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
    ).toEqual([]);
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
    ).toEqual(['email-delivery.cleanup', REEXTRACTION_JOB_NAME]);
  });
});

describe('定期実行からの日次の再抽出', () => {
  test('検索対象が登録されていない4:21の起動で、要求を送らずに検索対象の無い要約をログに出して成功する', async () => {
    const send = vi.spyOn(env.JOBS_QUEUE, 'send');
    const logs = recordConsole();

    await runScheduled(DAILY_CRON, SCHEDULED_TIME);

    expect(send).not.toHaveBeenCalled();
    expect(
      logs.filter(({ category }) => category === REEXTRACTION_CATEGORY),
    ).toEqual([
      expect.objectContaining({
        level: 'info',
        targets: [],
        requested: 0,
        failed: 0,
      }),
    ]);
    expect(
      logs.find(({ message }) => message === '定期実行を終えました'),
    ).toMatchObject({
      cron: DAILY_CRON,
      jobs: [
        expect.objectContaining({ name: 'email-delivery.cleanup' }),
        expect.objectContaining({
          name: REEXTRACTION_JOB_NAME,
          result: 'succeeded',
        }),
      ],
    });
  });
});
