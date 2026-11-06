import { eq } from 'drizzle-orm';

import { ultrasActivations } from '../../../../db/schema/ultras/ultras-activations.ts';
import { ultrasNotices } from '../../../../db/schema/ultras/ultras-notices.ts';
import { ultrasSubscriptions } from '../../../../db/schema/ultras/ultras-subscriptions.ts';
import type { SubscriptionRow } from '../../../core/ultras/ports.ts';
import { EMPTY_SUBSCRIPTION_SNAPSHOT } from '../../../core/ultras/subscription-transition.ts';
import {
  clearIdentityTables,
  db,
  T0,
  userIdOf,
} from '../../identity/testing/identity-store-fixtures.ts';
import { purchaseIdOf } from '../../payments/testing/payment-store-fixtures.ts';

export {
  after,
  db,
  insertUser,
  insertUsers,
  T0,
  userIdOf,
} from '../../identity/testing/identity-store-fixtures.ts';
export { purchaseIdOf } from '../../payments/testing/payment-store-fixtures.ts';

type SubscriptionTableRow = typeof ultrasSubscriptions.$inferSelect;

export function subscriptionIdOf(index: number): string {
  return `01JC0SUBSCRIPTION${String(index).padStart(9, '0')}`;
}

export function stripeSubscriptionIdOf(index: number): string {
  return `sub_ultras_${String(index).padStart(4, '0')}`;
}

// 初回の支払いを反映する前にsinkが作る、有効化されていない加入の行
export function newSubscriptionRow(
  index: number,
  overrides: Partial<SubscriptionRow> = {},
): SubscriptionRow {
  return {
    ...EMPTY_SUBSCRIPTION_SNAPSHOT,
    id: subscriptionIdOf(index),
    stripeSubscriptionId: stripeSubscriptionIdOf(index),
    userId: userIdOf(1),
    purchaseId: null,
    ...overrides,
  };
}

// 支払いの確定で有効化され、特典の継続期間が右に開いた加入の行
export function activatedSubscriptionRow(
  index: number,
  overrides: Partial<SubscriptionRow> = {},
): SubscriptionRow {
  return newSubscriptionRow(index, {
    purchaseId: purchaseIdOf(index),
    stripeStatus: 'active',
    startedAt: T0,
    ...overrides,
  });
}

export async function insertSubscriptionRows(
  rows: readonly SubscriptionRow[],
  columns: Partial<Pick<SubscriptionTableRow, 'createdAt' | 'updatedAt'>> = {},
): Promise<void> {
  const [first, ...rest] = rows.map((row) =>
    db
      .insert(ultrasSubscriptions)
      .values({ ...row, createdAt: T0, updatedAt: T0, ...columns }),
  );
  if (first !== undefined) {
    await db.batch([first, ...rest]);
  }
}

export async function insertSubscriptionRow(
  row: SubscriptionRow,
  columns: Partial<Pick<SubscriptionTableRow, 'createdAt' | 'updatedAt'>> = {},
): Promise<void> {
  await insertSubscriptionRows([row], columns);
}

export async function readSubscriptionRow(
  stripeSubscriptionId: string,
): Promise<SubscriptionTableRow | undefined> {
  const [row] = await db
    .select()
    .from(ultrasSubscriptions)
    .where(eq(ultrasSubscriptions.stripeSubscriptionId, stripeSubscriptionId));
  return row;
}

// 機能フラグの初期行(ultras_settings)はマイグレーションが入れるため消さない
export async function clearUltrasTables(): Promise<void> {
  await db.delete(ultrasNotices);
  await db.delete(ultrasActivations);
  await db.delete(ultrasSubscriptions);
  await clearIdentityTables();
}
