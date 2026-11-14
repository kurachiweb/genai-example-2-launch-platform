import { asc } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { beforeEach, describe, expect, test } from 'vitest';

import { productLaunches } from '../../../db/schema/product/product-launches.ts';
import type {
  UserLifecycleEvent,
  UserLifecycleEventType,
} from '../../../lib/core/identity/user-lifecycle.ts';
import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import { eventIdOf } from '../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  after,
  clearProductTables,
  db,
  insertLaunches,
  insertProduct,
  insertUser,
  launchIdOf,
  T0,
  userIdOf,
} from '../../../lib/workers/product/testing/product-fixtures.ts';
import { LaunchCancellationSyncHandler } from './launch-cancellation-sync-handler.ts';

const TARGET = 1;
const OTHER = 2;

const TARGET_PRODUCT = 1;
const TARGET_SECOND_PRODUCT = 2;
const TARGET_DELETED_PRODUCT = 3;
const OTHER_PRODUCT = 4;

const TODAY_LAUNCH = 1;
const TOMORROW_LAUNCH = 2;
const FINISHED_LAUNCH = 3;
const EARLIER_CANCELLED_LAUNCH = 4;
const DELETED_PRODUCT_LAUNCH = 5;
const OTHER_LAUNCH = 6;

// 業務日付2026-11-10の業務時刻23:59。翌日のローンチは予選の組み合わせの直前でも未開始として取り消す
const AT = fromBusinessDateTime(parseBusinessDate('2026-11-10'), {
  hour: 23,
  minute: 59,
});
const EARLIER = after(1_000);

function eventOf(type: UserLifecycleEventType): UserLifecycleEvent {
  return {
    id: eventIdOf(1),
    userId: userIdOf(TARGET),
    type,
    occurredAt: AT,
  };
}

async function readCancellation() {
  return db
    .select({
      id: productLaunches.id,
      cancelledAt: productLaunches.cancelledAt,
      updatedAt: productLaunches.updatedAt,
    })
    .from(productLaunches)
    .orderBy(asc(productLaunches.id));
}

async function commitAll(
  statements: readonly BatchItem<'sqlite'>[],
): Promise<void> {
  const [first, ...rest] = statements;
  if (first === undefined) {
    throw new Error('文が返されませんでした');
  }
  await db.batch([first, ...rest]);
}

function untouched(index: number, cancelledAt: Date | null = null) {
  return { id: launchIdOf(index), cancelledAt, updatedAt: T0 };
}

const UNTOUCHED_LAUNCHES = [
  untouched(TODAY_LAUNCH),
  untouched(TOMORROW_LAUNCH),
  untouched(FINISHED_LAUNCH),
  untouched(EARLIER_CANCELLED_LAUNCH, EARLIER),
  untouched(DELETED_PRODUCT_LAUNCH),
  untouched(OTHER_LAUNCH),
];

beforeEach(async () => {
  await clearProductTables();
  await insertUser(TARGET);
  await insertUser(OTHER);
  await insertProduct(TARGET_PRODUCT, TARGET);
  await insertProduct(TARGET_SECOND_PRODUCT, TARGET);
  await insertProduct(TARGET_DELETED_PRODUCT, TARGET, { deletedAt: EARLIER });
  await insertProduct(OTHER_PRODUCT, OTHER);
  await insertLaunches([
    {
      index: TODAY_LAUNCH,
      productIndex: TARGET_PRODUCT,
      columns: { launchDate: '2026-11-10' },
    },
    {
      index: TOMORROW_LAUNCH,
      productIndex: TARGET_SECOND_PRODUCT,
      columns: { launchDate: '2026-11-11' },
    },
    {
      index: FINISHED_LAUNCH,
      productIndex: TARGET_PRODUCT,
      columns: { launchDate: '2026-11-03', outcome: 'won', decidedAt: T0 },
    },
    {
      index: EARLIER_CANCELLED_LAUNCH,
      productIndex: TARGET_SECOND_PRODUCT,
      columns: { launchDate: '2026-11-08', cancelledAt: EARLIER },
    },
    {
      index: DELETED_PRODUCT_LAUNCH,
      productIndex: TARGET_DELETED_PRODUCT,
      columns: { launchDate: '2026-11-12' },
    },
    {
      index: OTHER_LAUNCH,
      productIndex: OTHER_PRODUCT,
      columns: { launchDate: '2026-11-12' },
    },
  ]);
});

describe('LaunchCancellationSyncHandler', () => {
  describe('statementsFor', () => {
    test('停止では1文を返し、実行すると停止した利用者の未削除のプロダクトの、ローンチ日が停止の業務日付より後の未確定のローンチだけを停止の日時で取り消す', async () => {
      const statements =
        await new LaunchCancellationSyncHandler().statementsFor(
          eventOf('suspended'),
          db,
        );

      expect(statements).toHaveLength(1);
      await expect(readCancellation()).resolves.toEqual(UNTOUCHED_LAUNCHES);

      await commitAll(statements);

      await expect(readCancellation()).resolves.toEqual([
        untouched(TODAY_LAUNCH),
        { id: launchIdOf(TOMORROW_LAUNCH), cancelledAt: AT, updatedAt: AT },
        untouched(FINISHED_LAUNCH),
        untouched(EARLIER_CANCELLED_LAUNCH, EARLIER),
        untouched(DELETED_PRODUCT_LAUNCH),
        untouched(OTHER_LAUNCH),
      ]);
    });

    test.each(['withdrawn', 'unsuspended', 'purge_due'] as const)(
      '%sでは文を返さない',
      async (type) => {
        const statements =
          await new LaunchCancellationSyncHandler().statementsFor(
            eventOf(type),
            db,
          );

        expect(statements).toEqual([]);
        await expect(readCancellation()).resolves.toEqual(UNTOUCHED_LAUNCHES);
      },
    );
  });
});
