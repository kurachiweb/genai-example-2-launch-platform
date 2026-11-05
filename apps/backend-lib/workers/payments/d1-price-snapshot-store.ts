import { inArray, sql } from 'drizzle-orm';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { paymentPriceSnapshots } from '../../../db/schema/payments/payment-price-snapshots.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  PriceSnapshot,
  PriceSnapshotStore,
  StripePrice,
} from '../../core/payments/ports.ts';

const snapshots = paymentPriceSnapshots;

const MAX_BOUND_PARAMETERS = 100;

// 1行は主キー・作成日時・更新日時を含む9列のバインド変数を使うため、上限に収まる行数ずつ追加する
const ROWS_PER_INSERT = 10;

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function excluded(column: { readonly name: string }) {
  return sql`excluded.${sql.identifier(column.name)}`;
}

@injectable()
export class D1PriceSnapshotStore implements PriceSnapshotStore {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findMany(
    lookupKeys: readonly string[],
  ): Promise<readonly PriceSnapshot[]> {
    const parts = await Promise.all(
      chunk(lookupKeys, MAX_BOUND_PARAMETERS).map((keys) =>
        this.db
          .select({
            lookupKey: snapshots.lookupKey,
            priceId: snapshots.stripePriceId,
            unitAmount: snapshots.unitAmount,
            currency: snapshots.currency,
            recurringInterval: snapshots.recurringInterval,
            fetchedAt: snapshots.fetchedAt,
          })
          .from(snapshots)
          .where(inArray(snapshots.lookupKey, keys)),
      ),
    );
    return parts.flat();
  }

  async saveMany(
    prices: readonly StripePrice[],
    fetchedAt: Date,
  ): Promise<void> {
    const [first, ...rest] = chunk(prices, ROWS_PER_INSERT).map((part) =>
      this.db
        .insert(snapshots)
        .values(
          part.map((price) => ({
            lookupKey: price.lookupKey,
            stripePriceId: price.priceId,
            unitAmount: price.unitAmount,
            currency: price.currency,
            recurringInterval: price.recurringInterval,
            fetchedAt,
          })),
        )
        .onConflictDoUpdate({
          target: snapshots.lookupKey,
          set: {
            stripePriceId: excluded(snapshots.stripePriceId),
            unitAmount: excluded(snapshots.unitAmount),
            currency: excluded(snapshots.currency),
            recurringInterval: excluded(snapshots.recurringInterval),
            fetchedAt: excluded(snapshots.fetchedAt),
          },
        }),
    );
    if (first !== undefined) {
      await this.db.batch([first, ...rest]);
    }
  }
}
