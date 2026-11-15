import { resetSync } from '@logtape/logtape';
import {
  applyD1Migrations,
  createExecutionContext,
  type D1Migration,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
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

import { productLaunches } from '../../db/schema/product/product-launches.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type {
  LaunchRecord,
  ProductDirectory,
} from '../../lib/core/product/ports.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearDirectoryTables } from '../../lib/workers/directory/testing/directory-listing-fixtures.ts';
import {
  AFTER_DECISION,
  DECIDED_AT,
  ENDS_AT,
  STARTS_AT,
} from '../../lib/workers/match/testing/directory-fixtures.ts';
import {
  insertMatchEvents,
  matchEventIdOf,
  readHandlerRuns,
  readMatchEvent,
} from '../../lib/workers/match/testing/event-fixtures.ts';
import { insertMatch } from '../../lib/workers/match/testing/match-fixtures.ts';
import { seedMatchPlatformSample } from '../../lib/workers/match/testing/match-platform-fixtures.ts';
import {
  db,
  launchIdOf,
  productIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { MODULES } from './modules.ts';
import {
  dispatchMatchEvent,
  matchEventEnvelope,
} from './testing/match-event-queue.ts';

// TEST_MIGRATIONSはvitest.worker.config.tsだけが渡すテスト用のバインディングで、実行時の環境の型には含めない
const testEnv = env as Env & { readonly TEST_MIGRATIONS: D1Migration[] };

const SAMPLE_MATCH = 1;

const EARLY_END_MATCH = 2;

const EVENT = 10;

const EARLY_ENDED_AT = new Date(STARTS_AT.getTime() + 3_600_000);

// 同じ予選の確定のイベントで他の機能が登録した処理も動くため、予選の結果の記録の処理の完了だけを読む
async function readQualifierOutcomeRuns() {
  const runs = await readHandlerRuns();
  return runs.filter(
    ({ handlerName }) => handlerName === 'match-engine.qualifier-outcome',
  );
}

// product-launchの照会の口で、ローンチの記録された結果と照会の時点の状態を読む
async function readLaunch(
  productIndex: number,
  launchIndex: number,
): Promise<LaunchRecord | undefined> {
  const directory = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'queue',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  ).get<ProductDirectory>(PRODUCT_PLATFORM_TYPES.ProductDirectory);
  const launches = await directory.listLaunches(
    [productIdOf(productIndex)],
    AFTER_DECISION,
  );
  return launches
    .get(productIdOf(productIndex))
    ?.find(({ launchId }) => launchId === launchIdOf(launchIndex));
}

async function updateLaunch(
  index: number,
  columns: Partial<typeof productLaunches.$inferInsert>,
): Promise<void> {
  await db
    .update(productLaunches)
    .set(columns)
    .where(eq(productLaunches.id, launchIdOf(index)));
}

// ローンチ2(該当した側の相手で勝利)とローンチ4(該当して敗北)の、開始から1時間で即時に終了した予選
async function insertEarlyEndedMatch(
  firstLaunch: number | null = 2,
): Promise<void> {
  await insertMatch({
    index: EARLY_END_MATCH,
    columns: {
      startedAt: STARTS_AT,
      decidedAt: EARLY_ENDED_AT,
      endedEarlyAt: EARLY_ENDED_AT,
      decision: 'walkover',
    },
    entries: [
      {
        index: 21,
        launch: firstLaunch,
        product: firstLaunch,
        owner: firstLaunch === null ? null : 1,
        columns: { result: 'walkover' },
      },
      {
        index: 22,
        launch: 4,
        product: 4,
        owner: 2,
        columns: { result: 'lost', forfeitedAt: EARLY_ENDED_AT },
      },
    ],
  });
  await insertMatchEvents([
    {
      index: EVENT,
      match: EARLY_END_MATCH,
      type: 'decided',
      occurredAt: EARLY_ENDED_AT,
    },
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, testEnv.TEST_MIGRATIONS);
});

beforeEach(async () => {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation(() => {});
  }
  await clearDirectoryTables();
  await seedMatchPlatformSample();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(() => {
  resetSync();
});

describe('予選の結果の記録の処理(match-engine.qualifier-outcome)', () => {
  test('確定のイベントで、勝った側のローンチに勝利・負けた側に敗北を確定の日時とともに記録し、ローンチの状態が終了になる', async () => {
    await insertMatchEvents([
      {
        index: EVENT,
        match: SAMPLE_MATCH,
        type: 'decided',
        occurredAt: DECIDED_AT,
      },
    ]);

    const outcome = await dispatchMatchEvent(
      matchEventEnvelope(matchEventIdOf(EVENT)),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(readLaunch(1, 1)).resolves.toMatchObject({
      status: 'finished',
      outcome: 'won',
      decidedAt: DECIDED_AT,
    });
    await expect(readLaunch(3, 3)).resolves.toMatchObject({
      status: 'finished',
      outcome: 'lost',
      decidedAt: DECIDED_AT,
    });
    await expect(readQualifierOutcomeRuns()).resolves.toMatchObject([
      {
        eventId: matchEventIdOf(EVENT),
        handlerName: 'match-engine.qualifier-outcome',
      },
    ]);
    await expect(readMatchEvent(matchEventIdOf(EVENT))).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('即時に終了した予選では、相手の該当による勝利を勝利として即時の終了の日時で記録する', async () => {
    await insertEarlyEndedMatch();

    const outcome = await dispatchMatchEvent(
      matchEventEnvelope(matchEventIdOf(EVENT)),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(readLaunch(2, 2)).resolves.toMatchObject({
      status: 'finished',
      outcome: 'won',
      decidedAt: EARLY_ENDED_AT,
    });
    await expect(readLaunch(4, 4)).resolves.toMatchObject({
      status: 'finished',
      outcome: 'lost',
      decidedAt: EARLY_ENDED_AT,
    });
  });

  test('取消のローンチと異なる結果が記録済みのローンチは書き換えず、イベントを完了にしてackする', async () => {
    await insertEarlyEndedMatch();
    await updateLaunch(2, { outcome: 'lost', decidedAt: ENDS_AT });
    await updateLaunch(4, { cancelledAt: STARTS_AT });

    const outcome = await dispatchMatchEvent(
      matchEventEnvelope(matchEventIdOf(EVENT)),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(readLaunch(2, 2)).resolves.toMatchObject({
      outcome: 'lost',
      decidedAt: ENDS_AT,
    });
    await expect(readLaunch(4, 4)).resolves.toMatchObject({
      status: 'canceled',
      outcome: null,
      decidedAt: null,
    });
    await expect(readMatchEvent(matchEventIdOf(EVENT))).resolves.toMatchObject({
      status: 'completed',
    });
  });

  test('紐付けの解除された側を除き、残る側のローンチだけに記録する', async () => {
    await insertEarlyEndedMatch(null);

    const outcome = await dispatchMatchEvent(
      matchEventEnvelope(matchEventIdOf(EVENT)),
    );

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(readLaunch(4, 4)).resolves.toMatchObject({
      status: 'finished',
      outcome: 'lost',
    });
    await expect(readLaunch(2, 2)).resolves.toMatchObject({
      status: 'in_progress',
      outcome: null,
    });
  });

  test('同じイベントのメッセージが重ねて届いても、記録済みの結果を変えずにackする', async () => {
    await insertMatchEvents([
      {
        index: EVENT,
        match: SAMPLE_MATCH,
        type: 'decided',
        occurredAt: DECIDED_AT,
      },
    ]);
    const envelope = matchEventEnvelope(matchEventIdOf(EVENT));
    await dispatchMatchEvent(envelope);

    const outcome = await dispatchMatchEvent(envelope);

    expect(outcome).toStrictEqual({ acked: true, retried: false });
    await expect(readLaunch(1, 1)).resolves.toMatchObject({
      outcome: 'won',
      decidedAt: DECIDED_AT,
    });
    await expect(readQualifierOutcomeRuns()).resolves.toHaveLength(1);
  });
});
