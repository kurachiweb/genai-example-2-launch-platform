import { asc, eq } from 'drizzle-orm';

import { ULTRAS_PROMOTION_FLAG_KEY } from '../../../../common-lib/ultras/promotion-flag.ts';
import { ultrasActivations } from '../../../../db/schema/ultras/ultras-activations.ts';
import { ultrasNotices } from '../../../../db/schema/ultras/ultras-notices.ts';
import { ultrasSettings } from '../../../../db/schema/ultras/ultras-settings.ts';
import { ultrasSubscriptions } from '../../../../db/schema/ultras/ultras-subscriptions.ts';
import type {
  SubscriptionRow,
  UltrasActivationRow,
  UltrasNoticeRow,
} from '../../../core/ultras/ports.ts';
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
type ActivationTableRow = typeof ultrasActivations.$inferSelect;
type NoticeTableRow = typeof ultrasNotices.$inferSelect;
type SettingsTableRow = typeof ultrasSettings.$inferSelect;

const SEED_TIMESTAMP = new Date(1_793_923_200_000);

// マイグレーション(_seed)が入れる機能フラグの初期行と同じ固定のIDと日時
export const ULTRAS_PROMOTION_SEED_ROW: SettingsTableRow = {
  id: '01M6Q2FD000000000000000001',
  settingKey: ULTRAS_PROMOTION_FLAG_KEY,
  enabled: false,
  version: 0,
  updatedByAdminId: null,
  createdAt: SEED_TIMESTAMP,
  updatedAt: SEED_TIMESTAMP,
};

// IDはCrockfordのBase32(I・L・O・Uを含まない)の26文字にし、z.ulid()の検証を通す。番号は0で埋めて辞書順と番号順をそろえる
export function subscriptionIdOf(index: number): string {
  return `01JC0SBSCRPTN${String(index).padStart(13, '0')}`;
}

export function stripeSubscriptionIdOf(index: number): string {
  return `sub_ultras_${String(index).padStart(4, '0')}`;
}

export function activationIdOf(index: number): string {
  return `01JC0ACTVTN${String(index).padStart(15, '0')}`;
}

export function noticeIdOf(index: number): string {
  return `01JC0NTC${String(index).padStart(18, '0')}`;
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

// 有効化の直後に作られ、まだ送り出していない知らせの行
export function newActivationRow(
  index: number,
  overrides: Partial<UltrasActivationRow> = {},
): UltrasActivationRow {
  return {
    id: activationIdOf(index),
    userId: userIdOf(1),
    stripeSubscriptionId: stripeSubscriptionIdOf(index),
    activatedAt: T0,
    dispatchedAt: null,
    completedAt: null,
    createdAt: T0,
    ...overrides,
  };
}

// 支払いの失敗を知らせる、まだ依頼していないメールの依頼の行
export function newNoticeRow(
  index: number,
  overrides: Partial<UltrasNoticeRow> = {},
): UltrasNoticeRow {
  return {
    id: noticeIdOf(index),
    userId: userIdOf(1),
    stripeSubscriptionId: stripeSubscriptionIdOf(index),
    kind: 'payment_failed',
    dedupeKey: `payment_failed:${stripeSubscriptionIdOf(index)}:${String(T0.getTime())}`,
    payload: { acceptedAt: T0.toISOString() },
    status: 'pending',
    finishedAt: null,
    createdAt: T0,
    ...overrides,
  };
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

export async function insertActivationRows(
  rows: readonly UltrasActivationRow[],
): Promise<void> {
  const [first, ...rest] = rows.map((row) =>
    db.insert(ultrasActivations).values({ ...row, updatedAt: T0 }),
  );
  if (first !== undefined) {
    await db.batch([first, ...rest]);
  }
}

export async function insertActivationRow(
  row: UltrasActivationRow,
): Promise<void> {
  await insertActivationRows([row]);
}

export async function readActivationRow(
  id: string,
): Promise<ActivationTableRow | undefined> {
  const [row] = await db
    .select()
    .from(ultrasActivations)
    .where(eq(ultrasActivations.id, id));
  return row;
}

export async function readActivationIds(): Promise<string[]> {
  const rows = await db
    .select({ id: ultrasActivations.id })
    .from(ultrasActivations)
    .orderBy(asc(ultrasActivations.id));
  return rows.map(({ id }) => id);
}

export async function insertNoticeRows(
  rows: readonly UltrasNoticeRow[],
  columns: Partial<Pick<NoticeTableRow, 'payloadJson' | 'updatedAt'>> = {},
): Promise<void> {
  const [first, ...rest] = rows.map(({ payload, ...row }) =>
    db.insert(ultrasNotices).values({
      ...row,
      payloadJson: JSON.stringify(payload),
      updatedAt: T0,
      ...columns,
    }),
  );
  if (first !== undefined) {
    await db.batch([first, ...rest]);
  }
}

export async function insertNoticeRow(
  row: UltrasNoticeRow,
  columns: Partial<Pick<NoticeTableRow, 'payloadJson' | 'updatedAt'>> = {},
): Promise<void> {
  await insertNoticeRows([row], columns);
}

export async function readNoticeRow(
  id: string,
): Promise<NoticeTableRow | undefined> {
  const [row] = await db
    .select()
    .from(ultrasNotices)
    .where(eq(ultrasNotices.id, id));
  return row;
}

export async function readNoticeIds(): Promise<string[]> {
  const rows = await db
    .select({ id: ultrasNotices.id })
    .from(ultrasNotices)
    .orderBy(asc(ultrasNotices.id));
  return rows.map(({ id }) => id);
}

// 機能フラグの初期行を書き換えるテストの前に、マイグレーションと同じ固定のIDと日時の行へ戻す
export async function restoreUltrasSettingsSeed(): Promise<void> {
  await db.delete(ultrasSettings);
  await db.insert(ultrasSettings).values(ULTRAS_PROMOTION_SEED_ROW);
}

// 機能フラグの初期行(ultras_settings)はマイグレーションが入れるため消さない
export async function clearUltrasTables(): Promise<void> {
  await db.delete(ultrasNotices);
  await db.delete(ultrasActivations);
  await db.delete(ultrasSubscriptions);
  await clearIdentityTables();
}
