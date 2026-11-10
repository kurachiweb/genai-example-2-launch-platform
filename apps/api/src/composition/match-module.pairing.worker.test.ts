import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { qualifierPairings } from '../../db/schema/match/qualifier-pairings.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../lib/core/ids/id-generator.ts';
import { MATCH_PLATFORM_TYPES } from '../../lib/core/match/identifiers.ts';
import { qualifierWindow } from '../../lib/core/match/match-model.ts';
import type { MatchScheduler } from '../../lib/core/match/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type { ScheduledLaunchDirectory } from '../../lib/core/product/ports.ts';
import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import { systemClock } from '../../lib/core/time/clock.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  readEntryRows,
  readMatchEvents,
  readMatchRows,
} from '../../lib/workers/match/testing/event-fixtures.ts';
import {
  clearMatchTables,
  MATCH_DATE,
} from '../../lib/workers/match/testing/match-fixtures.ts';
import {
  after,
  db,
  insertLaunch,
  insertLaunches,
  insertProduct,
  insertProducts,
  insertUser,
  launchIdOf,
} from '../../lib/workers/product/testing/product-fixtures.ts';
import { MATCH_TYPES } from '../application/match/match-types.ts';
import type { PairingStore } from '../application/match/ports.ts';
import {
  type QualifierPairingService,
  StoreQualifierPairingService,
} from '../application/match/qualifier-pairing-service.ts';
import { CryptoRandomSource } from '../infrastructure/match/crypto-random-source.ts';
import { D1PairingStore } from '../infrastructure/match/d1-pairing-store.ts';
import { MODULES } from './modules.ts';

const DATE = parseBusinessDate(MATCH_DATE);

const ACTIVE_OWNER = 1;
const SUSPENDED_OWNER = 2;

function createContainer(): Container {
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

async function readDay() {
  const [row] = await db
    .select({
      status: qualifierPairings.status,
      launchCount: qualifierPairings.launchCount,
      matchCount: qualifierPairings.matchCount,
      completedAt: qualifierPairings.completedAt,
    })
    .from(qualifierPairings)
    .where(eq(qualifierPairings.matchDate, MATCH_DATE));
  return row;
}

async function pairedLaunches(): Promise<string[]> {
  return (await readEntryRows()).flatMap((entry) =>
    entry.launchId === null ? [] : [entry.launchId],
  );
}

// 1〜countのプロダクトとローンチを、稼働中の投稿者の予定のローンチとして作る
async function seedScheduledLaunches(count: number): Promise<void> {
  const indexes = Array.from({ length: count }, (_, index) => index + 1);
  await insertProducts(indexes, ACTIVE_OWNER);
  await insertLaunches(
    indexes.map((index) => ({
      index,
      productIndex: index,
      columns: { launchDate: MATCH_DATE },
    })),
  );
}

beforeEach(async () => {
  await clearMatchTables();
  await insertUser(ACTIVE_OWNER);
  await insertUser(SUSPENDED_OWNER, {
    status: 'suspended',
    suspendedAt: after(1),
  });
});

describe('APIサーバーのマッチのモジュールのペアリングの束縛', () => {
  test('処理単位のコンテナから、ペアリングのストア・乱数・ユースケースをそれぞれの実装に解決する', () => {
    const container = createContainer();

    expect(
      container.get<PairingStore>(MATCH_TYPES.PairingStore),
    ).toBeInstanceOf(D1PairingStore);
    expect(container.get(MATCH_TYPES.RandomSource)).toBeInstanceOf(
      CryptoRandomSource,
    );
    expect(
      container.get<QualifierPairingService>(
        MATCH_TYPES.QualifierPairingService,
      ),
    ).toBeInstanceOf(StoreQualifierPairingService);
  });

  test('product-launchの予定のローンチから、取消・非公開化・停止中の投稿者のローンチと別の日のローンチを除いて組む', async () => {
    await seedScheduledLaunches(3);
    await insertProduct(4, ACTIVE_OWNER);
    await insertLaunch(4, 4, { launchDate: MATCH_DATE, cancelledAt: after(2) });
    await insertProduct(5, ACTIVE_OWNER, { hiddenAt: after(3) });
    await insertLaunch(5, 5, { launchDate: MATCH_DATE });
    await insertProduct(6, SUSPENDED_OWNER);
    await insertLaunch(6, 6, { launchDate: MATCH_DATE });
    await insertProduct(7, ACTIVE_OWNER);
    await insertLaunch(7, 7, { launchDate: '2026-11-21' });
    const service = createContainer().get<QualifierPairingService>(
      MATCH_TYPES.QualifierPairingService,
    );

    const counts = await service.pair(DATE);

    expect(counts).toEqual({ launches: 3, matches: 2 });
    expect((await pairedLaunches()).toSorted()).toEqual([
      launchIdOf(1),
      launchIdOf(2),
      launchIdOf(3),
    ]);
    const window = qualifierWindow(DATE);
    const rows = await readMatchRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        kind: 'qualifier',
        matchDate: MATCH_DATE,
        startsAt: window.startsAt,
        endsAt: window.endsAt,
        startedAt: null,
        decidedAt: null,
      });
    }
    expect((await readMatchEvents()).map((event) => event.type)).toEqual([
      'scheduled',
      'scheduled',
    ]);
    expect(await readDay()).toMatchObject({
      status: 'completed',
      launchCount: 3,
      matchCount: 2,
    });
  });

  test('途中の予定の書き込みで失敗した後の再実行は、組まれていない残りのローンチだけを組む', async () => {
    await seedScheduledLaunches(104);
    const container = createContainer();
    const scheduler = container.get<MatchScheduler>(
      MATCH_PLATFORM_TYPES.MatchScheduler,
    );
    let calls = 0;
    const failingOnSecondWrite: MatchScheduler = {
      schedule(inputs, at) {
        calls += 1;
        return calls === 1
          ? scheduler.schedule(inputs, at)
          : Promise.reject(new Error('D1の書き込みの失敗'));
      },
    };
    const interrupted = new StoreQualifierPairingService(
      container.get<PairingStore>(MATCH_TYPES.PairingStore),
      container.get<ScheduledLaunchDirectory>(
        PRODUCT_PLATFORM_TYPES.ScheduledLaunchDirectory,
      ),
      failingOnSecondWrite,
      new CryptoRandomSource(),
      systemClock,
      container.get<IdGenerator>(PLATFORM_TYPES.IdGenerator),
    );

    await expect(interrupted.pair(DATE)).rejects.toThrow('D1の書き込みの失敗');
    const firstLaunches = await pairedLaunches();
    expect(firstLaunches).toHaveLength(100);
    expect(await readDay()).toMatchObject({
      status: 'pending',
      completedAt: null,
    });

    const counts = await createContainer()
      .get<QualifierPairingService>(MATCH_TYPES.QualifierPairingService)
      .pair(DATE);

    expect(counts).toEqual({ launches: 4, matches: 2 });
    const allLaunches = await pairedLaunches();
    expect(allLaunches).toHaveLength(104);
    expect(new Set(allLaunches).size).toBe(104);
    expect(allLaunches).toEqual(expect.arrayContaining(firstLaunches));
    expect(await readMatchRows()).toHaveLength(52);
    expect(await readDay()).toMatchObject({ status: 'completed' });
  });

  test('完了した日に同じペアリングを再び行っても、マッチと記録を変えない', async () => {
    await seedScheduledLaunches(5);
    const service = createContainer().get<QualifierPairingService>(
      MATCH_TYPES.QualifierPairingService,
    );
    await service.pair(DATE);
    const matchesBefore = await readMatchRows();
    const dayBefore = await readDay();

    const counts = await service.pair(DATE);

    expect(counts).toEqual({ launches: 0, matches: 0 });
    expect(await readMatchRows()).toEqual(matchesBefore);
    expect(await readDay()).toEqual(dayBefore);
  });
});
