import { asc, eq } from 'drizzle-orm';

import { paymentCustomers } from '../../../../db/schema/payments/payment-customers.ts';
import { paymentPriceSnapshots } from '../../../../db/schema/payments/payment-price-snapshots.ts';
import { paymentPurchases } from '../../../../db/schema/payments/payment-purchases.ts';
import { paymentRecords } from '../../../../db/schema/payments/payment-records.ts';
import { paymentRefunds } from '../../../../db/schema/payments/payment-refunds.ts';
import { paymentStripeObjects } from '../../../../db/schema/payments/payment-stripe-objects.ts';
import { sponsorshipDisplayStops } from '../../../../db/schema/sponsorship/sponsorship-display-stops.ts';
import { sponsorships } from '../../../../db/schema/sponsorship/sponsorships.ts';
import { SPONSORSHIP_PRICE_LOOKUP_KEYS } from '../../../../common-lib/sponsorship/sponsorship-tiers.ts';
import type { IdGenerator } from '../../../core/ids/id-generator.ts';
import type { DisplayStopSubject } from '../../../core/sponsorship/ports.ts';
import {
  clearProductTables,
  db,
  insertLaunch,
  insertProduct,
  insertUser,
  launchIdOf,
  productIdOf,
  T0,
  userIdOf,
} from '../../product/testing/product-fixtures.ts';

export { db, productIdOf, T0, userIdOf };

// 1行が30個前後のバインド変数を使うため、上限(100)に収まる行数ずつ追加する
const ROWS_PER_INSERT = 3;

// 1件のプロダクトに作れるローンチの数。ローンチのIDの番号をプロダクトごとに分ける
const LAUNCHES_PER_PRODUCT = 10;

// 基準時刻(UTC-08:00)の2026-11-25 0:00
export const NOW = new Date('2026-11-25T08:00:00.000Z');

export const TODAY = '2026-11-25';

export const DEFAULT_AMOUNT_TOTAL = 7_000;

type SponsorshipRow = typeof sponsorships.$inferInsert;
type PurchaseRow = typeof paymentPurchases.$inferInsert;

export type FixtureUserState = 'active' | 'suspended' | 'withdrawn';

export type FixtureProductState = 'visible' | 'hidden' | 'deleted';

export type FixtureLaunchState =
  'before_kickoff' | 'canceled' | 'in_progress' | 'finished';

export function sponsorshipIdOf(index: number): string {
  return `01JD0SP0NS${String(index).padStart(16, '0')}`;
}

export function sponsorshipPurchaseIdOf(index: number): string {
  return `01JD0SPVRCH${String(index).padStart(15, '0')}`;
}

export function sponsorshipPaymentRecordIdOf(index: number): string {
  return `01JD0SPREC${String(index).padStart(16, '0')}`;
}

export function sponsorshipRefundIdOf(index: number): string {
  return `01JD0SPRFND${String(index).padStart(15, '0')}`;
}

export function displayStopIdOf(index: number): string {
  return `01JD0SPST0P${String(index).padStart(15, '0')}`;
}

export function sponsorshipLaunchIdOf(
  productIndex: number,
  position: number,
): string {
  return launchIdOf(productIndex * LAUNCHES_PER_PRODUCT + position);
}

// 作成の検証で作った行の識別子を予測できるよう、指定した番号から順に申込のIDを作る
export function createSequentialSponsorshipIds(start = 1000): IdGenerator {
  let next = start;
  return {
    generate: () => {
      const id = sponsorshipIdOf(next);
      next += 1;
      return id;
    },
  };
}

export interface SponsorshipFixture {
  readonly index: number;
  readonly owner: number;
  readonly product: number;
  readonly columns?: Partial<SponsorshipRow>;
}

// 決済済みの申込の列。購入の行はinsertSponsorshipPurchaseで同じ番号に作る
export function paidColumnsOf(
  index: number,
  columns: Partial<SponsorshipRow> = {},
): Partial<SponsorshipRow> {
  return {
    state: 'paid',
    purchaseId: sponsorshipPurchaseIdOf(index),
    paymentRecordId: sponsorshipPaymentRecordIdOf(index),
    amountTotal: DEFAULT_AMOUNT_TOTAL,
    paidAt: T0,
    ...columns,
  };
}

export function terminatedColumnsOf(
  index: number,
  columns: Partial<SponsorshipRow> = {},
): Partial<SponsorshipRow> {
  return paidColumnsOf(index, {
    state: 'terminated',
    terminatedAt: T0,
    terminationReason: '規約に反する広告のため',
    ...columns,
  });
}

function sponsorshipRowOf(fixture: SponsorshipFixture): SponsorshipRow {
  return {
    id: sponsorshipIdOf(fixture.index),
    userId: userIdOf(fixture.owner),
    productId: productIdOf(fixture.product),
    tier: 'gold',
    startsOn: '2026-12-01',
    endsOn: '2026-12-07',
    days: 7,
    state: 'pending_payment',
    createdAt: T0,
    updatedAt: T0,
    ...fixture.columns,
  };
}

export async function insertSponsorships(
  fixtures: readonly SponsorshipFixture[],
): Promise<void> {
  const rows = fixtures.map(sponsorshipRowOf);
  for (let start = 0; start < rows.length; start += ROWS_PER_INSERT) {
    await db
      .insert(sponsorships)
      .values(rows.slice(start, start + ROWS_PER_INSERT));
  }
}

export async function readSponsorshipRow(
  index: number,
): Promise<typeof sponsorships.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(sponsorships)
    .where(eq(sponsorships.id, sponsorshipIdOf(index)));
  return row;
}

export async function readSponsorshipIds(): Promise<string[]> {
  const rows = await db
    .select({ id: sponsorships.id })
    .from(sponsorships)
    .orderBy(asc(sponsorships.id));
  return rows.map(({ id }) => id);
}

const USER_STATE_COLUMNS = {
  active: {},
  suspended: { status: 'suspended', suspendedAt: T0 },
  withdrawn: { deletedAt: T0 },
} as const;

export async function insertSponsorUser(
  index: number,
  state: FixtureUserState = 'active',
): Promise<void> {
  await insertUser(index, USER_STATE_COLUMNS[state]);
}

const PRODUCT_STATE_COLUMNS = {
  visible: {},
  hidden: { hiddenAt: T0 },
  deleted: { deletedAt: T0 },
} as const;

// NOWの時点の状態になるローンチの列
const LAUNCH_STATE_COLUMNS = {
  before_kickoff: { launchDate: '2026-11-28' },
  canceled: { launchDate: '2026-11-20', cancelledAt: T0 },
  in_progress: { launchDate: TODAY },
  finished: {
    launchDate: '2026-11-18',
    outcome: 'won',
    decidedAt: new Date('2026-11-19T07:45:00.000Z'),
  },
} as const;

export interface SponsorProductFixture {
  readonly index: number;
  readonly owner: number;
  readonly state?: FixtureProductState;
  // 確定・取消のローンチは何件でも、キックオフ前とマッチ中は合わせて1件まで(進行中のローンチの一意索引)
  readonly launches?: readonly FixtureLaunchState[];
}

export async function insertSponsorProduct({
  index,
  owner,
  state = 'visible',
  launches = ['finished'],
}: SponsorProductFixture): Promise<void> {
  await insertProduct(index, owner, PRODUCT_STATE_COLUMNS[state]);
  for (const [position, launch] of launches.entries()) {
    await insertLaunch(
      index * LAUNCHES_PER_PRODUCT + position,
      index,
      LAUNCH_STATE_COLUMNS[launch],
    );
  }
}

export interface SponsorshipPurchaseFixture {
  // 申込と同じ番号。購入のIDはpaidColumnsOfの購入のIDと同じになる
  readonly index: number;
  readonly owner: number;
  readonly amountTotal?: number;
  // 管理者の返金など、既に返金を依頼済みの額
  readonly refundedAmount?: number;
  readonly columns?: Partial<PurchaseRow>;
}

// 決済の機能が反映を終えた購入の行を、テストのためだけに直接作る
export async function insertSponsorshipPurchase({
  index,
  owner,
  amountTotal = DEFAULT_AMOUNT_TOTAL,
  refundedAmount = 0,
  columns = {},
}: SponsorshipPurchaseFixture): Promise<void> {
  const purchaseId = sponsorshipPurchaseIdOf(index);
  const sponsorshipId = sponsorshipIdOf(index);
  await db.insert(paymentPurchases).values({
    id: purchaseId,
    userId: userIdOf(owner),
    kind: 'sponsorship',
    targetId: sponsorshipId,
    relatedId: sponsorshipId,
    exclusivityKey: `sponsorship:${sponsorshipId}`,
    status: 'fulfilled',
    stateToken: `sponsorship-state-${String(index)}`,
    priceLookupKey: SPONSORSHIP_PRICE_LOOKUP_KEYS.gold,
    stripePriceId: 'price_sponsorship_gold',
    unitAmount: 1_000,
    quantity: 7,
    amountTotal,
    summaryJson: JSON.stringify({
      itemName: 'スポンサー広告(Gold)',
      quantityLabel: '7日間',
      serviceTiming: '選んだ掲載期間',
      additionalNotes: [],
    }),
    expiresAt: T0,
    stripeCheckoutSessionId: `cs_test_sponsorship_${String(index)}`,
    stripePaymentIntentId: `pi_test_sponsorship_${String(index)}`,
    paidAt: T0,
    reflectedAt: T0,
    lastEventAt: T0,
    createdAt: T0,
    updatedAt: T0,
    ...columns,
  });
  if (refundedAmount > 0) {
    await db.insert(paymentRefunds).values({
      id: sponsorshipRefundIdOf(index),
      purchaseId,
      requestKey: `admin:${purchaseId}`,
      amount: refundedAmount,
      reason: 'admin_refund',
      status: 'succeeded',
      createdAt: T0,
      updatedAt: T0,
    });
  }
}

export interface DisplayStopFixture {
  readonly index: number;
  readonly subject: DisplayStopSubject;
  readonly startedAt: Date;
  // 継続中の区間はnull
  readonly endedAt?: Date | null;
}

export async function insertDisplayStops(
  fixtures: readonly DisplayStopFixture[],
): Promise<void> {
  for (const fixture of fixtures) {
    await db.insert(sponsorshipDisplayStops).values({
      id: displayStopIdOf(fixture.index),
      subjectKind: fixture.subject.kind,
      subjectId:
        fixture.subject.kind === 'product'
          ? fixture.subject.productId
          : fixture.subject.userId,
      startedAt: fixture.startedAt,
      endedAt: fixture.endedAt ?? null,
      createdAt: fixture.startedAt,
      updatedAt: fixture.startedAt,
    });
  }
}

export async function readDisplayStopRows(): Promise<
  (typeof sponsorshipDisplayStops.$inferSelect)[]
> {
  return db
    .select()
    .from(sponsorshipDisplayStops)
    .orderBy(asc(sponsorshipDisplayStops.id));
}

// 外部キーの参照元から先に消す
export async function clearSponsorshipTables(): Promise<void> {
  await db.delete(sponsorshipDisplayStops);
  await db.delete(sponsorships);
  await db.delete(paymentRefunds);
  await db.delete(paymentRecords);
  await db.delete(paymentStripeObjects);
  await db.delete(paymentPriceSnapshots);
  await db.delete(paymentPurchases);
  await db.delete(paymentCustomers);
  await clearProductTables();
}
