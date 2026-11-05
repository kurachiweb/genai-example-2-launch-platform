import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  notInArray,
  or,
  sum,
} from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import type { RefundRequestStatus } from '../../../common-lib/payments/purchase-states.ts';
import type { Database } from '../../../db/client.ts';
import { paymentPurchases } from '../../../db/schema/payments/payment-purchases.ts';
import { paymentRefunds } from '../../../db/schema/payments/payment-refunds.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  NewRefundRequest,
  RefundRequestRecord,
  RefundStore,
} from '../../core/payments/ports.ts';
import type { RefundStatements } from './statement-contracts.ts';

const refunds = paymentRefunds;

type RefundRow = typeof paymentRefunds.$inferSelect;

// 失敗・取り消しの依頼は返金されないため、返金できる残りの額に数えない
const NOT_COUNTED: readonly RefundRequestStatus[] = ['failed', 'canceled'];

function toRecord(row: RefundRow): RefundRequestRecord {
  return {
    id: row.id,
    purchaseId: row.purchaseId,
    requestKey: row.requestKey,
    amount: row.amount,
    reason: row.reason,
    noticeStatus: row.noticeStatus,
    status: row.status,
    stripeRefundId: row.stripeRefundId,
    failureCode: row.failureCode,
    dispatchedAt: row.dispatchedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@injectable()
export class D1RefundStore implements RefundStore, RefundStatements {
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async findById(
    refundRequestId: string,
  ): Promise<RefundRequestRecord | undefined> {
    return this.findOne(eq(refunds.id, refundRequestId));
  }

  async findByRequestKey(
    requestKey: string,
  ): Promise<RefundRequestRecord | undefined> {
    return this.findOne(eq(refunds.requestKey, requestKey));
  }

  async findByStripeRefundId(
    stripeRefundId: string,
  ): Promise<RefundRequestRecord | undefined> {
    return this.findOne(eq(refunds.stripeRefundId, stripeRefundId));
  }

  async sumRequested(purchaseId: string): Promise<MinorUnitAmount> {
    const [row] = await this.db
      .select({ total: sum(refunds.amount).mapWith(Number) })
      .from(refunds)
      .where(
        and(
          eq(refunds.purchaseId, purchaseId),
          notInArray(refunds.status, [...NOT_COUNTED]),
        ),
      );
    return row?.total ?? 0;
  }

  async markDispatched(refundRequestId: string, at: Date): Promise<void> {
    await this.db
      .update(refunds)
      .set({ dispatchedAt: at })
      .where(
        and(eq(refunds.id, refundRequestId), isNull(refunds.dispatchedAt)),
      );
  }

  async updateStatus(input: {
    readonly refundRequestId: string;
    readonly status: RefundRequestStatus;
    readonly stripeRefundId?: string;
    readonly failureCode?: string | null;
  }): Promise<void> {
    await this.db
      .update(refunds)
      .set({
        status: input.status,
        stripeRefundId: input.stripeRefundId,
        failureCode: input.failureCode,
      })
      .where(eq(refunds.id, input.refundRequestId));
  }

  async findUndispatched(input: {
    readonly createdBefore: Date;
    readonly limit: number;
  }): Promise<readonly RefundRequestRecord[]> {
    const rows = await this.db
      .select()
      .from(refunds)
      .where(
        and(
          isNull(refunds.dispatchedAt),
          lt(refunds.createdAt, input.createdBefore),
        ),
      )
      .orderBy(asc(refunds.createdAt), asc(refunds.id))
      .limit(input.limit);
    return rows.map(toRecord);
  }

  async markNotice(input: {
    readonly refundRequestId: string;
    readonly to: 'requested' | 'skipped';
  }): Promise<boolean> {
    const result = await this.db
      .update(refunds)
      .set({ noticeStatus: input.to })
      .where(
        and(
          eq(refunds.id, input.refundRequestId),
          eq(refunds.noticeStatus, 'pending'),
        ),
      );
    return result.meta.changes > 0;
  }

  async findPendingNotices(input: {
    readonly updatedBefore: Date;
    readonly limit: number;
  }): Promise<readonly RefundRequestRecord[]> {
    const rows = await this.db
      .select()
      .from(refunds)
      .where(
        and(
          eq(refunds.status, 'succeeded'),
          eq(refunds.noticeStatus, 'pending'),
          lt(refunds.updatedAt, input.updatedBefore),
        ),
      )
      .orderBy(asc(refunds.updatedAt), asc(refunds.id))
      .limit(input.limit);
    return rows.map(toRecord);
  }

  insert(record: NewRefundRequest): BatchItem<'sqlite'> {
    return this.db.insert(refunds).values(record);
  }

  reflectStripeStatus(input: {
    readonly refundRequestId: string;
    readonly status: RefundRequestStatus;
    readonly from: readonly RefundRequestStatus[];
    readonly stripeRefundId: string;
    readonly failureCode?: string | null;
  }): BatchItem<'sqlite'> {
    return this.db
      .update(refunds)
      .set({
        status: input.status,
        stripeRefundId: input.stripeRefundId,
        failureCode: input.failureCode,
      })
      .where(
        and(
          eq(refunds.id, input.refundRequestId),
          inArray(refunds.status, [...input.from]),
          or(
            ne(refunds.status, input.status),
            isNull(refunds.stripeRefundId),
            ne(refunds.stripeRefundId, input.stripeRefundId),
          ),
        ),
      );
  }

  deleteByUser(userId: string): BatchItem<'sqlite'> {
    const userPurchaseIds = this.db
      .select({ id: paymentPurchases.id })
      .from(paymentPurchases)
      .where(eq(paymentPurchases.userId, userId));
    return this.db
      .delete(refunds)
      .where(inArray(refunds.purchaseId, userPurchaseIds));
  }

  private async findOne(
    condition: ReturnType<typeof eq>,
  ): Promise<RefundRequestRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(refunds)
      .where(condition)
      .limit(1);
    return row === undefined ? undefined : toRecord(row);
  }
}
