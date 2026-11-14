import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import { PRODUCT_CATEGORY_OTHER_ID } from '../../../common-lib/product/product-category-constants.ts';
import type { OutcomeEntry } from '../../core/product/ports.ts';
import { parseBusinessDate } from '../../core/time/business-time.ts';
import {
  createRecordingDatabase,
  expectSplitWithinBindLimit,
} from '../identity/testing/identity-store-fixtures.ts';
import {
  D1LaunchOutcomeRecorder,
  D1ScheduledLaunchDirectory,
} from './d1-launch-schedule.ts';
import {
  after,
  categoryIdOf,
  clearProductTables,
  db,
  insertCategory,
  insertLaunch,
  insertLaunches,
  insertProduct,
  insertProducts,
  insertUser,
  launchIdOf,
  productIdOf,
  userIdOf,
} from './testing/product-fixtures.ts';

const LAUNCH_DATE = parseBusinessDate('2026-11-20');
const BULK_LAUNCH_COUNT = 200;

const schedule = new D1ScheduledLaunchDirectory(db);
const recorder = new D1LaunchOutcomeRecorder(db);

async function readLaunch(index: number) {
  const [row] = await db
    .select({
      outcome: productLaunches.outcome,
      decidedAt: productLaunches.decidedAt,
    })
    .from(productLaunches)
    .where(eq(productLaunches.id, launchIdOf(index)));
  return row;
}

beforeEach(async () => {
  await clearProductTables();
  await insertUser(1, { handle: 'alice' });
  await insertUser(2, {
    handle: 'bob',
    status: 'suspended',
    suspendedAt: after(1),
  });
  await insertUser(3, { handle: 'carol', deletedAt: after(2) });
  await insertCategory(1, { name: '開発ツール', handle: 'dev-tools' });
});

describe('listForDate', () => {
  test('取消・結果の確定・非公開化・論理削除・停止中と退会済みの投稿者のローンチと、別の日のローンチを除いて返す', async () => {
    await insertProduct(1, 1, { categoryId: categoryIdOf(1) });
    await insertLaunch(8, 1, { launchDate: LAUNCH_DATE });
    await insertProduct(2, 1, { hiddenAt: after(3) });
    await insertLaunch(2, 2, { launchDate: LAUNCH_DATE });
    await insertProduct(3, 2);
    await insertLaunch(3, 3, { launchDate: LAUNCH_DATE });
    await insertProduct(4, 1, { deletedAt: after(4) });
    await insertLaunch(4, 4, { launchDate: LAUNCH_DATE });
    await insertProduct(5, 1);
    await insertLaunch(5, 5, {
      launchDate: LAUNCH_DATE,
      cancelledAt: after(5),
    });
    await insertProduct(6, 1);
    await insertLaunch(6, 6, {
      launchDate: LAUNCH_DATE,
      outcome: 'won',
      decidedAt: after(6),
    });
    await insertProduct(7, 1);
    await insertLaunch(7, 7, { launchDate: '2026-11-21' });
    await insertProduct(9, 3);
    await insertLaunch(9, 9, { launchDate: LAUNCH_DATE });
    await insertProduct(10, 1);
    await insertLaunch(1, 10, { launchDate: LAUNCH_DATE });

    const page = await schedule.listForDate({
      launchDate: LAUNCH_DATE,
      after: undefined,
      limit: 10,
    });

    expect(page).toEqual({
      launches: [
        {
          launchId: launchIdOf(1),
          productId: productIdOf(10),
          ownerUserId: userIdOf(1),
          categoryId: PRODUCT_CATEGORY_OTHER_ID,
        },
        {
          launchId: launchIdOf(8),
          productId: productIdOf(1),
          ownerUserId: userIdOf(1),
          categoryId: categoryIdOf(1),
        },
      ],
      next: undefined,
    });
  });

  test('ローンチのIDの順に上限件数ずつ返し、続きがある時だけ最後のローンチのIDを示す', async () => {
    await insertProducts([1, 2, 3, 4], 1);
    await insertLaunches(
      [4, 2, 3, 1].map((index) => ({
        index,
        productIndex: index,
        columns: { launchDate: LAUNCH_DATE },
      })),
    );

    const first = await schedule.listForDate({
      launchDate: LAUNCH_DATE,
      after: undefined,
      limit: 2,
    });
    const second = await schedule.listForDate({
      launchDate: LAUNCH_DATE,
      after: first.next,
      limit: 2,
    });
    const rest = await schedule.listForDate({
      launchDate: LAUNCH_DATE,
      after: launchIdOf(3),
      limit: 2,
    });

    expect(first.launches.map((launch) => launch.launchId)).toEqual([
      launchIdOf(1),
      launchIdOf(2),
    ]);
    expect(first.next).toBe(launchIdOf(2));
    expect(second.launches.map((launch) => launch.launchId)).toEqual([
      launchIdOf(3),
      launchIdOf(4),
    ]);
    expect(second.next).toBeUndefined();
    expect(rest).toEqual({
      launches: [expect.objectContaining({ launchId: launchIdOf(4) })],
      next: undefined,
    });
  });

  test('上限件数は1〜500の整数だけを受け付ける', async () => {
    for (const limit of [0, 501, 1.5]) {
      await expect(
        schedule.listForDate({
          launchDate: LAUNCH_DATE,
          after: undefined,
          limit,
        }),
      ).rejects.toThrow(RangeError);
    }
    await expect(
      schedule.listForDate({
        launchDate: LAUNCH_DATE,
        after: undefined,
        limit: 500,
      }),
    ).resolves.toEqual({ launches: [], next: undefined });
  });
});

describe('record', () => {
  const DECIDED_AT = after(100);

  function entryOf(
    index: number,
    outcome: OutcomeEntry['outcome'],
  ): OutcomeEntry {
    return { launchId: launchIdOf(index), outcome, decidedAt: DECIDED_AT };
  }

  test('結果が未確定のローンチに結果と確定の日時を記録する。非公開化中と停止中の投稿者のプロダクトのローンチにも記録する', async () => {
    await insertProduct(1, 1);
    await insertLaunch(1, 1);
    await insertProduct(2, 1, { hiddenAt: after(3) });
    await insertLaunch(2, 2);
    await insertProduct(3, 2);
    await insertLaunch(3, 3);

    const results = await recorder.record([
      entryOf(1, 'won'),
      entryOf(2, 'lost'),
      entryOf(3, 'won'),
    ]);

    expect(results).toEqual(
      new Map([
        [launchIdOf(1), 'recorded'],
        [launchIdOf(2), 'recorded'],
        [launchIdOf(3), 'recorded'],
      ]),
    );
    expect(await readLaunch(1)).toEqual({
      outcome: 'won',
      decidedAt: DECIDED_AT,
    });
    expect(await readLaunch(2)).toEqual({
      outcome: 'lost',
      decidedAt: DECIDED_AT,
    });
  });

  test('確定した結果と同じ結果は記録済み、異なる結果は競合として返し、どちらも書き換えない', async () => {
    await insertProduct(1, 1);
    await insertLaunch(1, 1, { outcome: 'won', decidedAt: after(10) });
    await insertProduct(2, 1);
    await insertLaunch(2, 2, { outcome: 'lost', decidedAt: after(20) });

    const results = await recorder.record([
      entryOf(1, 'won'),
      entryOf(2, 'won'),
    ]);

    expect(results).toEqual(
      new Map([
        [launchIdOf(1), 'already-recorded'],
        [launchIdOf(2), 'conflict'],
      ]),
    );
    expect(await readLaunch(1)).toEqual({
      outcome: 'won',
      decidedAt: after(10),
    });
    expect(await readLaunch(2)).toEqual({
      outcome: 'lost',
      decidedAt: after(20),
    });
  });

  test('取消したローンチ・論理削除したプロダクトのローンチ・存在しないローンチは記録できないと返し、書き込まない', async () => {
    await insertProduct(1, 1);
    await insertLaunch(1, 1, { cancelledAt: after(5) });
    await insertProduct(2, 1, { deletedAt: after(6) });
    await insertLaunch(2, 2);
    await insertProduct(3, 1);
    await insertLaunch(3, 3, {
      outcome: 'won',
      decidedAt: after(7),
      cancelledAt: after(8),
    });

    const results = await recorder.record([
      entryOf(1, 'won'),
      entryOf(2, 'won'),
      entryOf(3, 'won'),
      entryOf(99, 'lost'),
    ]);

    expect(results).toEqual(
      new Map([
        [launchIdOf(1), 'not-recordable'],
        [launchIdOf(2), 'not-recordable'],
        [launchIdOf(3), 'not-recordable'],
        [launchIdOf(99), 'not-recordable'],
      ]),
    );
    expect(await readLaunch(1)).toEqual({ outcome: null, decidedAt: null });
    expect(await readLaunch(2)).toEqual({ outcome: null, decidedAt: null });
  });

  test('同じ記録を2回行うと、2回目は記録済みになり確定の日時を変えない', async () => {
    await insertProduct(1, 1);
    await insertLaunch(1, 1);

    await recorder.record([entryOf(1, 'won')]);
    const again = await recorder.record([
      { launchId: launchIdOf(1), outcome: 'won', decidedAt: after(500) },
    ]);

    expect(again).toEqual(new Map([[launchIdOf(1), 'already-recorded']]));
    expect(await readLaunch(1)).toEqual({
      outcome: 'won',
      decidedAt: DECIDED_AT,
    });
  });

  test('200件を記録し、読み直しはバインド変数の上限に収まるよう分ける', async () => {
    const indexes = Array.from(
      { length: BULK_LAUNCH_COUNT },
      (_, index) => index + 1,
    );
    await insertProducts(indexes, 1);
    await insertLaunches(
      indexes.map((index) => ({
        index,
        productIndex: index,
        columns: { outcome: 'won', decidedAt: after(10) },
      })),
    );
    const { database, placeholderCounts } = createRecordingDatabase();

    const results = await new D1LaunchOutcomeRecorder(database).record(
      indexes.map((index) => entryOf(index, 'won')),
    );

    expect(results.size).toBe(BULK_LAUNCH_COUNT);
    expect(new Set(results.values())).toEqual(new Set(['already-recorded']));
    expectSplitWithinBindLimit(placeholderCounts);
  });

  test('件数が1〜200でない記録と、同じローンチを2件含む記録を拒否する', async () => {
    await insertProduct(1, 1);
    await insertLaunch(1, 1);
    const tooMany = Array.from({ length: BULK_LAUNCH_COUNT + 1 }, (_, index) =>
      entryOf(index + 1, 'won'),
    );

    await expect(recorder.record([])).rejects.toThrow(RangeError);
    await expect(recorder.record(tooMany)).rejects.toThrow(RangeError);
    await expect(
      recorder.record([entryOf(1, 'won'), entryOf(1, 'lost')]),
    ).rejects.toThrow(RangeError);
    expect(await readLaunch(1)).toEqual({ outcome: null, decidedAt: null });
  });
});
