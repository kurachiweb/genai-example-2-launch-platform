import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  type SQL,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { PurchaseKind } from '../../../common-lib/payments/purchase-kinds.ts';
import type { PurchaseStatus } from '../../../common-lib/payments/purchase-states.ts';
import type { Database } from '../../../db/client.ts';
import { paymentPurchases } from '../../../db/schema/payments/payment-purchases.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { CheckoutSummaryText } from '../../core/payments/purchase-kind-contract.ts';
import type {
  NewPurchase,
  AloneAdvanceTarget,
  PurchaseAdvance,
  PurchaseRecord,
  PurchaseStore,
} from '../../core/payments/ports.ts';
import type { PurchaseStatements } from './statement-contracts.ts';

type PurchaseRow = typeof paymentPurchases.$inferSelect;

const purchases = paymentPurchases;

// 利用者の決済セッションの失効の対象。処理中はStripe上で失効できないが、失効の操作で反映に回す。置き換え済みは旧セッションの失効が失敗していればStripe上で支払えるまま残る
const OPEN_FOR_USER: readonly PurchaseStatus[] = [
  'open',
  'processing',
  'superseded',
];

// 置き換え済みの購入も、旧セッションの失効の前に支払いが確定し得るため突合する
const RECONCILABLE: readonly PurchaseStatus[] = [
  'open',
  'processing',
  'superseded',
];

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function parseSummary(purchaseId: string, json: string): CheckoutSummaryText {
  const value: unknown = JSON.parse(json);
  if (
    typeof value === 'object' &&
    value !== null &&
    'itemName' in value &&
    typeof value.itemName === 'string' &&
    'quantityLabel' in value &&
    typeof value.quantityLabel === 'string' &&
    'serviceTiming' in value &&
    typeof value.serviceTiming === 'string' &&
    'additionalNotes' in value &&
    isStringArray(value.additionalNotes)
  ) {
    return {
      itemName: value.itemName,
      quantityLabel: value.quantityLabel,
      serviceTiming: value.serviceTiming,
      additionalNotes: value.additionalNotes,
    };
  }
  throw new TypeError(`購入${purchaseId}の表示事項の形式が不正です。`);
}

function toRecord(row: PurchaseRow): PurchaseRecord {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    targetId: row.targetId,
    relatedId: row.relatedId,
    exclusivityKey: row.exclusivityKey,
    stateToken: row.stateToken,
    priceLookupKey: row.priceLookupKey,
    stripePriceId: row.stripePriceId,
    unitAmount: row.unitAmount,
    quantity: row.quantity,
    amountTotal: row.amountTotal,
    summary: parseSummary(row.id, row.summaryJson),
    deadlineAt: row.deadlineAt,
    acceptUntil: row.acceptUntil,
    fulfillableUntil: row.fulfillableUntil,
    expiresAt: row.expiresAt,
    status: row.status,
    rejectionReason: row.rejectionReason,
    stripeCheckoutSessionId: row.stripeCheckoutSessionId,
    stripePaymentIntentId: row.stripePaymentIntentId,
    stripeInvoiceId: row.stripeInvoiceId,
    stripeSubscriptionId: row.stripeSubscriptionId,
    consentedAt: row.consentedAt,
    consentVersion: row.consentVersion,
    paidAt: row.paidAt,
    reflectedAt: row.reflectedAt,
    confirmationEmailStatus: row.confirmationEmailStatus,
    lastEventAt: row.lastEventAt,
    createdAt: row.createdAt,
  };
}

@injectable()
export class D1PurchaseStore implements PurchaseStore, PurchaseStatements {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findById(purchaseId: string): Promise<PurchaseRecord | undefined> {
    return this.findOne(eq(purchases.id, purchaseId));
  }

  async findBySessionId(
    sessionId: string,
  ): Promise<PurchaseRecord | undefined> {
    return this.findOne(eq(purchases.stripeCheckoutSessionId, sessionId));
  }

  async findByPaymentIntentId(
    paymentIntentId: string,
  ): Promise<PurchaseRecord | undefined> {
    return this.findOne(eq(purchases.stripePaymentIntentId, paymentIntentId));
  }

  async findFulfilledByExclusivityKey(
    exclusivityKey: string,
  ): Promise<PurchaseRecord | undefined> {
    return this.findOne(
      and(
        eq(purchases.exclusivityKey, exclusivityKey),
        eq(purchases.status, 'fulfilled'),
      ),
    );
  }

  async attachSession(input: {
    readonly purchaseId: string;
    readonly sessionId: string;
    readonly expiresAt: Date;
  }): Promise<void> {
    await this.db
      .update(purchases)
      .set({
        stripeCheckoutSessionId: input.sessionId,
        expiresAt: input.expiresAt,
      })
      .where(eq(purchases.id, input.purchaseId));
  }

  async findOpenByUser(userId: string): Promise<readonly PurchaseRecord[]> {
    const rows = await this.db
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, userId),
          inArray(purchases.status, OPEN_FOR_USER),
        ),
      )
      .orderBy(asc(purchases.createdAt), asc(purchases.id));
    return rows.map(toRecord);
  }

  async findOpenByTarget(input: {
    readonly userId: string;
    readonly kind: PurchaseKind;
    readonly targetId: string | null;
  }): Promise<readonly PurchaseRecord[]> {
    const rows = await this.db
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.userId, input.userId),
          eq(purchases.kind, input.kind),
          input.targetId === null
            ? isNull(purchases.targetId)
            : eq(purchases.targetId, input.targetId),
          eq(purchases.status, 'open'),
        ),
      )
      .orderBy(asc(purchases.createdAt), asc(purchases.id));
    return rows.map(toRecord);
  }

  // 決済セッションのIDが無い購入はStripeから取得できないため対象にしない
  async findReconcilable(input: {
    readonly deadlineFrom: Date;
    readonly deadlineTo: Date;
    readonly limit: number;
  }): Promise<readonly PurchaseRecord[]> {
    const rows = await this.db
      .select()
      .from(purchases)
      .where(
        and(
          inArray(purchases.status, RECONCILABLE),
          gte(purchases.deadlineAt, input.deadlineFrom),
          lte(purchases.deadlineAt, input.deadlineTo),
          isNotNull(purchases.stripeCheckoutSessionId),
        ),
      )
      .orderBy(asc(purchases.deadlineAt), asc(purchases.id))
      .limit(input.limit);
    return rows.map(toRecord);
  }

  async findStaleOpen(input: {
    readonly expiredBefore: Date;
    readonly limit: number;
  }): Promise<readonly PurchaseRecord[]> {
    const rows = await this.db
      .select()
      .from(purchases)
      .where(
        and(
          inArray(purchases.status, RECONCILABLE),
          lt(purchases.expiresAt, input.expiredBefore),
          isNotNull(purchases.stripeCheckoutSessionId),
        ),
      )
      .orderBy(asc(purchases.expiresAt), asc(purchases.id))
      .limit(input.limit);
    return rows.map(toRecord);
  }

  async recordConsent(input: {
    readonly purchaseId: string;
    readonly userId: string;
    readonly consentedAt: Date;
    readonly version: string;
  }): Promise<'recorded' | 'not_open'> {
    const result = await this.db
      .update(purchases)
      .set({ consentedAt: input.consentedAt, consentVersion: input.version })
      .where(
        and(
          eq(purchases.id, input.purchaseId),
          eq(purchases.userId, input.userId),
          eq(purchases.status, 'open'),
        ),
      );
    return result.meta.changes > 0 ? 'recorded' : 'not_open';
  }

  async advanceAlone(
    input: PurchaseAdvance & { readonly to: AloneAdvanceTarget },
  ): Promise<boolean> {
    const result = await this.advanceQuery(input);
    return result.meta.changes > 0;
  }

  async findPendingConfirmations(input: {
    readonly reflectedBefore: Date;
    readonly limit: number;
  }): Promise<readonly PurchaseRecord[]> {
    const rows = await this.db
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.confirmationEmailStatus, 'pending'),
          lt(purchases.reflectedAt, input.reflectedBefore),
        ),
      )
      .orderBy(asc(purchases.reflectedAt), asc(purchases.id))
      .limit(input.limit);
    return rows.map(toRecord);
  }

  async markConfirmationEmail(input: {
    readonly purchaseId: string;
    readonly to: 'requested' | 'skipped';
  }): Promise<boolean> {
    const result = await this.db
      .update(purchases)
      .set({ confirmationEmailStatus: input.to })
      .where(
        and(
          eq(purchases.id, input.purchaseId),
          eq(purchases.confirmationEmailStatus, 'pending'),
        ),
      );
    return result.meta.changes > 0;
  }

  create(record: NewPurchase): BatchItem<'sqlite'> {
    const { summary, ...columns } = record;
    return this.db
      .insert(purchases)
      .values({ ...columns, summaryJson: JSON.stringify(summary) });
  }

  advance(input: PurchaseAdvance): BatchItem<'sqlite'> {
    return this.advanceQuery(input);
  }

  deleteByUser(userId: string): BatchItem<'sqlite'> {
    return this.db.delete(purchases).where(eq(purchases.userId, userId));
  }

  private advanceQuery(input: PurchaseAdvance) {
    return this.db
      .update(purchases)
      .set({ ...input.patch, status: input.to, stateToken: input.nextToken })
      .where(
        and(
          eq(purchases.id, input.purchaseId),
          inArray(purchases.status, input.from),
        ),
      );
  }

  private async findOne(
    condition: SQL | undefined,
  ): Promise<PurchaseRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(purchases)
      .where(condition)
      .limit(1);
    return row === undefined ? undefined : toRecord(row);
  }
}
