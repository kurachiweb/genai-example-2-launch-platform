import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  ScheduledJobContext,
  ScheduledJobHandler,
} from '../../../lib/core/scheduling/cron-registry.ts';
import { SEARCH_TYPES } from '../../../lib/core/search/identifiers.ts';
import type {
  SearchIndexRefreshRequester,
  SearchIndexStore,
  SearchTargetCatalog,
} from '../../../lib/core/search/ports.ts';
import type { SearchTargetInfo } from '../../../lib/core/search/search-target.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import {
  REEXTRACTION_LIMIT_PER_TARGET,
  REEXTRACTION_PENDING_TIMEOUT_MS,
  SearchKeywordReextractionError,
  SearchKeywordReextractionJob,
} from './search-keyword-reextraction-job.ts';

const SCHEDULED_TIME = new Date('2026-11-02T12:21:00.000Z');
const NOW = new Date('2026-11-02T12:21:03.456Z');
const PENDING_BEFORE = new Date('2026-11-02T11:21:03.456Z');

const CONTEXT: ScheduledJobContext = {
  scheduledTime: SCHEDULED_TIME,
  cron: '21 12 * * *',
  business: toBusinessDateTime(SCHEDULED_TIME),
};

const REEXTRACTION_CATEGORY = 'api.search.reextraction';

interface LookupCall {
  readonly target: string;
  readonly pendingBefore: Date;
  readonly limit: number;
}

interface RefreshCall {
  readonly target: string;
  readonly sourceId: string;
}

interface Fakes {
  readonly catalog: SearchTargetCatalog;
  readonly store: SearchIndexStore;
  readonly requester: SearchIndexRefreshRequester;
  readonly clock: Clock;
  readonly lookups: LookupCall[];
  readonly refreshes: RefreshCall[];
}

interface FakeOptions {
  readonly candidates: Readonly<Record<string, readonly string[] | Error>>;
  readonly failingRefreshes?: Readonly<Record<string, Error>>;
}

function notUsed(): never {
  throw new Error('日次の再抽出では呼ばれない');
}

function createFakes({
  candidates,
  failingRefreshes = {},
}: FakeOptions): Fakes {
  const lookups: LookupCall[] = [];
  const refreshes: RefreshCall[] = [];
  const names = Object.keys(candidates);
  const catalog: SearchTargetCatalog = {
    find: (name): SearchTargetInfo | undefined =>
      names.includes(name) ? { name, fields: {} } : undefined,
    names: () => names,
  };
  const store: SearchIndexStore = {
    findState: notUsed,
    upsert: notUsed,
    delete: notUsed,
    findSourceIdsForReextraction: (target, pendingBefore, limit) => {
      lookups.push({ target, pendingBefore, limit });
      const found = candidates[target];
      if (found === undefined) {
        return Promise.reject(new Error(`未知の検索対象${target}`));
      }
      return found instanceof Error
        ? Promise.reject(found)
        : Promise.resolve(found);
    },
  };
  const requester: SearchIndexRefreshRequester = {
    requestRefresh: (target, sourceId) => {
      refreshes.push({ target, sourceId });
      const failure = failingRefreshes[`${target}/${sourceId}`];
      return failure === undefined
        ? Promise.resolve()
        : Promise.reject(failure);
    },
  };
  const clock: Clock = { now: () => new Date(NOW) };
  return { catalog, store, requester, clock, lookups, refreshes };
}

function jobOf({
  catalog,
  store,
  requester,
  clock,
}: Fakes): ScheduledJobHandler {
  return new SearchKeywordReextractionJob(catalog, store, requester, clock);
}

const records: LogRecord[] = [];

function reextractionLogs(): LogRecord[] {
  return records.filter(
    (record) => record.category.join('.') === REEXTRACTION_CATEGORY,
  );
}

function summaryLogs(): LogRecord[] {
  return reextractionLogs().filter(({ level }) => level === 'info');
}

function errorLogs(): LogRecord[] {
  return reextractionLogs().filter(({ level }) => level === 'error');
}

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

describe('再抽出の定数', () => {
  test('更新待ちの判定は1時間、検索対象ごとの上限は200件である', () => {
    expect(REEXTRACTION_PENDING_TIMEOUT_MS).toBe(3_600_000);
    expect(REEXTRACTION_LIMIT_PER_TARGET).toBe(200);
  });
});

describe('SearchKeywordReextractionJob', () => {
  test('全ての検索対象について、現在時刻の1時間前を境に上限200件で候補を取得し、各候補の更新を順に要求する', async () => {
    const fakes = createFakes({
      candidates: {
        products: ['p1', 'p2'],
        comments: ['c1'],
      },
    });

    await jobOf(fakes).run(CONTEXT);

    expect(fakes.lookups).toEqual([
      { target: 'products', pendingBefore: PENDING_BEFORE, limit: 200 },
      { target: 'comments', pendingBefore: PENDING_BEFORE, limit: 200 },
    ]);
    expect(fakes.refreshes).toEqual([
      { target: 'products', sourceId: 'p1' },
      { target: 'products', sourceId: 'p2' },
      { target: 'comments', sourceId: 'c1' },
    ]);
  });

  test('検索対象ごとの候補と要求の件数を、1件のinfoのログにまとめて出す', async () => {
    const fakes = createFakes({
      candidates: {
        products: ['p1', 'p2'],
        comments: [],
      },
    });

    await jobOf(fakes).run(CONTEXT);

    const logs = summaryLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.properties).toEqual({
      targets: [
        {
          target: 'products',
          status: 'completed',
          found: 2,
          requested: 2,
          failed: 0,
        },
        {
          target: 'comments',
          status: 'completed',
          found: 0,
          requested: 0,
          failed: 0,
        },
      ],
      requested: 2,
      failed: 0,
    });
    expect(errorLogs()).toEqual([]);
  });

  test('検索対象が登録されていなければ、候補を取得せずに検索対象の無い要約のログを出す', async () => {
    const fakes = createFakes({ candidates: {} });

    await jobOf(fakes).run(CONTEXT);

    expect(fakes.lookups).toEqual([]);
    expect(fakes.refreshes).toEqual([]);
    expect(summaryLogs().map(({ properties }) => properties)).toEqual([
      { targets: [], requested: 0, failed: 0 },
    ]);
  });

  test('1件の要求が例外を投げても残りの候補と検索対象の要求を続け、失敗をerrorのログに出して最後に例外で伝える', async () => {
    const failure = new Error('契約に合わない本文');
    const fakes = createFakes({
      candidates: {
        products: ['p1', 'p2', 'p3'],
        comments: ['c1'],
      },
      failingRefreshes: { 'products/p2': failure },
    });

    const error: unknown = await jobOf(fakes)
      .run(CONTEXT)
      .catch((caught: unknown) => caught);

    expect(fakes.refreshes).toEqual([
      { target: 'products', sourceId: 'p1' },
      { target: 'products', sourceId: 'p2' },
      { target: 'products', sourceId: 'p3' },
      { target: 'comments', sourceId: 'c1' },
    ]);
    expect(errorLogs().map(({ properties }) => properties)).toEqual([
      { error: failure, target: 'products', sourceId: 'p2' },
    ]);
    expect(summaryLogs().map(({ properties }) => properties)).toEqual([
      {
        targets: [
          {
            target: 'products',
            status: 'completed',
            found: 3,
            requested: 2,
            failed: 1,
          },
          {
            target: 'comments',
            status: 'completed',
            found: 1,
            requested: 1,
            failed: 0,
          },
        ],
        requested: 3,
        failed: 1,
      },
    ]);
    expect(error).toBeInstanceOf(SearchKeywordReextractionError);
    expect((error as Error).cause).toBe(failure);
    expect((error as Error).message).toBe(
      '日次の再抽出で1件の更新の要求と0件の検索対象の候補の取得に失敗しました',
    );
  });

  test('1つの検索対象の候補の取得が失敗しても残りの検索対象を続け、取得の失敗として要約に含める', async () => {
    const failure = new Error('D1に到達できません');
    const fakes = createFakes({
      candidates: {
        products: failure,
        comments: ['c1', 'c2'],
      },
    });

    const error: unknown = await jobOf(fakes)
      .run(CONTEXT)
      .catch((caught: unknown) => caught);

    expect(fakes.refreshes).toEqual([
      { target: 'comments', sourceId: 'c1' },
      { target: 'comments', sourceId: 'c2' },
    ]);
    expect(errorLogs().map(({ properties }) => properties)).toEqual([
      { error: failure, target: 'products' },
    ]);
    expect(summaryLogs().map(({ properties }) => properties)).toEqual([
      {
        targets: [
          {
            target: 'products',
            status: 'lookup-failed',
            found: 0,
            requested: 0,
            failed: 0,
          },
          {
            target: 'comments',
            status: 'completed',
            found: 2,
            requested: 2,
            failed: 0,
          },
        ],
        requested: 2,
        failed: 0,
      },
    ]);
    expect(error).toBeInstanceOf(SearchKeywordReextractionError);
    expect((error as Error).cause).toBe(failure);
    expect((error as Error).message).toBe(
      '日次の再抽出で0件の更新の要求と1件の検索対象の候補の取得に失敗しました',
    );
  });

  test('同じ日に2回実行しても、同じ候補の更新を重ねて要求するだけで失敗しない', async () => {
    const fakes = createFakes({ candidates: { products: ['p1'] } });
    const job = jobOf(fakes);

    await job.run(CONTEXT);
    await job.run(CONTEXT);

    expect(fakes.refreshes).toEqual([
      { target: 'products', sourceId: 'p1' },
      { target: 'products', sourceId: 'p1' },
    ]);
  });

  test('識別子に束縛すると、コンテナが検索のポートと時計を注入したジョブを返す', async () => {
    const fakes = createFakes({ candidates: { products: ['p1'] } });
    const container = new Container({ defaultScope: 'Transient' });
    container
      .bind<SearchTargetCatalog>(SEARCH_TYPES.TargetCatalog)
      .toConstantValue(fakes.catalog);
    container
      .bind<SearchIndexStore>(SEARCH_TYPES.IndexStore)
      .toConstantValue(fakes.store);
    container
      .bind<SearchIndexRefreshRequester>(SEARCH_TYPES.RefreshRequester)
      .toConstantValue(fakes.requester);
    container.bind<Clock>(PLATFORM_TYPES.Clock).toConstantValue(fakes.clock);
    container
      .bind<ScheduledJobHandler>(SEARCH_TYPES.ReextractionJob)
      .to(SearchKeywordReextractionJob);

    await container
      .get<ScheduledJobHandler>(SEARCH_TYPES.ReextractionJob)
      .run(CONTEXT);

    expect(fakes.refreshes).toEqual([{ target: 'products', sourceId: 'p1' }]);
  });
});
