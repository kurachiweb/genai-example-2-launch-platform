import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { qualifierPairings } from '../../../db/schema/match/qualifier-pairings.ts';
import {
  clearMatchTables,
  insertMatches,
  MATCH_DATE,
} from '../../../lib/workers/match/testing/match-fixtures.ts';
import {
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { parseBusinessDate } from '../../../lib/core/time/business-time.ts';
import { D1PairingStore } from './d1-pairing-store.ts';

const DATE = parseBusinessDate(MATCH_DATE);
const OTHER_DATE = parseBusinessDate('2026-11-21');
const BEGUN_AT = new Date('2026-11-20T07:45:05.000Z');
const COMPLETED_AT = new Date('2026-11-20T07:45:09.000Z');
const RERUN_AT = new Date('2026-11-20T08:00:03.000Z');

const store = new D1PairingStore(db);

async function readDays() {
  return db
    .select({
      matchDate: qualifierPairings.matchDate,
      status: qualifierPairings.status,
      launchCount: qualifierPairings.launchCount,
      matchCount: qualifierPairings.matchCount,
      completedAt: qualifierPairings.completedAt,
      createdAt: qualifierPairings.createdAt,
      updatedAt: qualifierPairings.updatedAt,
    })
    .from(qualifierPairings);
}

beforeEach(async () => {
  await clearMatchTables();
});

describe('D1PairingStore.beginDay', () => {
  test('記録が無い日は未完了の記録を作ってbegunを返す', async () => {
    expect(await store.beginDay(DATE, BEGUN_AT)).toBe('begun');

    expect(await readDays()).toEqual([
      {
        matchDate: MATCH_DATE,
        status: 'pending',
        launchCount: null,
        matchCount: null,
        completedAt: null,
        createdAt: BEGUN_AT,
        updatedAt: BEGUN_AT,
      },
    ]);
  });

  test('未完了の記録がある日は記録を変えずにbegunを返す', async () => {
    await store.beginDay(DATE, BEGUN_AT);

    expect(await store.beginDay(DATE, RERUN_AT)).toBe('begun');
    expect(await readDays()).toEqual([
      expect.objectContaining({ status: 'pending', updatedAt: BEGUN_AT }),
    ]);
  });

  test('完了済みの日は記録を変えずにalready-completedを返す', async () => {
    await store.beginDay(DATE, BEGUN_AT);
    await store.completeDay(DATE, { launches: 3, matches: 2 }, COMPLETED_AT);
    const before = await readDays();

    expect(await store.beginDay(DATE, RERUN_AT)).toBe('already-completed');
    expect(await readDays()).toEqual(before);
  });
});

describe('D1PairingStore.completeDay', () => {
  test('未完了の記録を完了にし、件数と完了の日時を書く', async () => {
    await store.beginDay(DATE, BEGUN_AT);

    await store.completeDay(DATE, { launches: 3, matches: 2 }, COMPLETED_AT);

    expect(await readDays()).toEqual([
      {
        matchDate: MATCH_DATE,
        status: 'completed',
        launchCount: 3,
        matchCount: 2,
        completedAt: COMPLETED_AT,
        createdAt: BEGUN_AT,
        updatedAt: COMPLETED_AT,
      },
    ]);
  });

  test('完了済みの記録は最初の完了の日時を保ち、件数を足す', async () => {
    await store.beginDay(DATE, BEGUN_AT);
    await store.completeDay(DATE, { launches: 3, matches: 2 }, COMPLETED_AT);

    await store.completeDay(DATE, { launches: 2, matches: 1 }, RERUN_AT);

    expect(await readDays()).toEqual([
      expect.objectContaining({
        status: 'completed',
        launchCount: 5,
        matchCount: 3,
        completedAt: COMPLETED_AT,
        updatedAt: RERUN_AT,
      }),
    ]);
  });

  test('記録の無い日も完了の記録を作る', async () => {
    await store.completeDay(DATE, { launches: 0, matches: 0 }, COMPLETED_AT);

    expect(await readDays()).toEqual([
      expect.objectContaining({
        status: 'completed',
        launchCount: 0,
        matchCount: 0,
        completedAt: COMPLETED_AT,
      }),
    ]);
  });
});

describe('D1PairingStore.isDayCompleted', () => {
  test('完了の記録がある日だけ真を返す', async () => {
    await store.beginDay(DATE, BEGUN_AT);
    expect(await store.isDayCompleted(DATE)).toBe(false);
    expect(await store.isDayCompleted(OTHER_DATE)).toBe(false);

    await store.completeDay(DATE, { launches: 0, matches: 0 }, COMPLETED_AT);

    expect(await store.isDayCompleted(DATE)).toBe(true);
    expect(await store.isDayCompleted(OTHER_DATE)).toBe(false);
    expect(
      await db
        .select({ id: qualifierPairings.id })
        .from(qualifierPairings)
        .where(eq(qualifierPairings.matchDate, OTHER_DATE)),
    ).toEqual([]);
  });
});

describe('D1PairingStore.pairedLaunchIds', () => {
  test('実施日の予選の側のローンチだけを返し、別の日・トーナメント・紐付けを解除した側を含めない', async () => {
    await insertUser(1);
    for (const index of [1, 2, 3, 4, 5]) {
      await insertProduct(index, 1);
      await insertLaunch(index, index);
    }
    await insertMatches([
      {
        index: 1,
        entries: [
          { index: 11, launch: 1, product: 1, owner: 1 },
          { index: 12, launch: 2, product: 2, owner: 1 },
        ],
      },
      { index: 2, entries: [{ index: 21, launch: 3, product: 3, owner: 1 }] },
      {
        index: 3,
        entries: [{ index: 31, launch: null, product: null, owner: null }],
      },
      {
        index: 4,
        columns: { matchDate: OTHER_DATE },
        entries: [{ index: 41, launch: 4, product: 4, owner: 1 }],
      },
      {
        index: 5,
        columns: { kind: 'week', round: 1 },
        entries: [{ index: 51, launch: 5, product: 5, owner: 1 }],
      },
    ]);

    const paired = await store.pairedLaunchIds(DATE);

    expect([...paired].toSorted()).toEqual([
      launchIdOf(1),
      launchIdOf(2),
      launchIdOf(3),
    ]);
  });

  test('予選の無い日は空を返す', async () => {
    expect((await store.pairedLaunchIds(DATE)).size).toBe(0);
  });
});
