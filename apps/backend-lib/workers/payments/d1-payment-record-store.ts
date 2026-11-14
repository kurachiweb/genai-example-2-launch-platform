import { and, asc, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { PaymentRecordKind } from '../../../common-lib/payments/payment-record-values.ts';
import type { Database } from '../../../db/client.ts';
import { paymentRecords } from '../../../db/schema/payments/payment-records.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type {
  NewPaymentRecord,
  PaymentRecordCursor,
  PaymentRecordRow,
  PaymentRecordStore,
} from '../../core/payments/ports.ts';
import { checkoutRecordGuardedInsert } from './checkout-record-guard.ts';
import type {
  GuardedStatement,
  PaymentRecordStatements,
} from './statement-contracts.ts';

const records = paymentRecords;

const ROW_COLUMNS = {
  id: records.id,
  kind: records.kind,
  purpose: records.purpose,
  amount: records.amount,
  currency: records.currency,
  quantity: records.quantity,
  status: records.status,
  stripeReference: records.stripeReference,
  relatedId: records.relatedId,
  occurredAt: records.occurredAt,
};

function excluded(column: { readonly name: string }) {
  return sql`excluded.${sql.identifier(column.name)}`;
}

// 後の通知が持たない値(決済セッションの反映だけが知る同意など)を、記録済みの値のまま残す
function keepRecorded(column: { readonly name: string }) {
  return sql`coalesce(${sql.identifier(column.name)}, ${excluded(column)})`;
}

function olderThan(cursor: PaymentRecordCursor) {
  return or(
    lt(records.occurredAt, cursor.occurredAt),
    and(eq(records.occurredAt, cursor.occurredAt), lt(records.id, cursor.id)),
  );
}

@injectable()
export class D1PaymentRecordStore
  implements PaymentRecordStore, PaymentRecordStatements
{
  constructor(@inject(PLATFORM_TYPES.Database) private readonly db: Database) {}

  async listByPseudonymousId(input: {
    readonly pseudonymousId: string;
    readonly first: number;
    readonly after: PaymentRecordCursor | null;
  }): Promise<readonly PaymentRecordRow[]> {
    return this.db
      .select(ROW_COLUMNS)
      .from(records)
      .where(
        and(
          eq(records.pseudonymousId, input.pseudonymousId),
          input.after === null ? undefined : olderThan(input.after),
        ),
      )
      .orderBy(desc(records.occurredAt), desc(records.id))
      .limit(input.first);
  }

  async listAllByPseudonymousId(
    pseudonymousId: string,
  ): Promise<readonly PaymentRecordRow[]> {
    return this.db
      .select(ROW_COLUMNS)
      .from(records)
      .where(eq(records.pseudonymousId, pseudonymousId))
      .orderBy(asc(records.occurredAt), asc(records.id));
  }

  async deleteRecordedBefore(threshold: Date, limit: number): Promise<number> {
    const expiredIds = this.db
      .select({ id: records.id })
      .from(records)
      .where(lt(records.recordedAt, threshold))
      .orderBy(asc(records.recordedAt), asc(records.id))
      .limit(limit);
    const result = await this.db
      .delete(records)
      .where(inArray(records.id, expiredIds));
    return result.meta.changes;
  }

  async findIdByReference(input: {
    readonly stripeReference: string;
    readonly kind: Exclude<PaymentRecordKind, 'dispute'>;
  }): Promise<string | undefined> {
    const [row] = await this.db
      .select({ id: records.id })
      .from(records)
      .where(
        and(
          eq(records.stripeReference, input.stripeReference),
          eq(records.kind, input.kind),
        ),
      )
      .limit(1);
    return row?.id;
  }

  insertCheckoutRecordGuarded(
    record: NewPaymentRecord,
    guard: { readonly purchaseId: string; readonly expectedToken: string },
  ): GuardedStatement {
    return checkoutRecordGuardedInsert(this.db, record, guard);
  }

  upsertByReference(record: NewPaymentRecord): BatchItem<'sqlite'> {
    if (record.kind === 'dispute') {
      throw new TypeError(
        'チャージバックの記録はinsertDisputeStageで追加します。',
      );
    }
    return this.db
      .insert(records)
      .values(record)
      .onConflictDoUpdate({
        target: [records.stripeReference, records.kind],
        // 部分一意索引を衝突の対象にするには、索引と同じ条件を値の埋め込みで書く
        targetWhere: sql`${sql.identifier(records.kind.name)} <> 'dispute'`,
        set: {
          status: excluded(records.status),
          amount: excluded(records.amount),
          quantity: excluded(records.quantity),
          occurredAt: excluded(records.occurredAt),
          lastEventAt: excluded(records.lastEventAt),
          relatedId: keepRecorded(records.relatedId),
          purchaseId: keepRecorded(records.purchaseId),
          consentedAt: keepRecorded(records.consentedAt),
          consentVersion: keepRecorded(records.consentVersion),
          linkFundingSourceGroup: keepRecorded(records.linkFundingSourceGroup),
        },
        setWhere: sql`${records.lastEventAt} <= ${excluded(records.lastEventAt)}`,
      });
  }

  insertDisputeStage(record: NewPaymentRecord): BatchItem<'sqlite'> {
    if (record.kind !== 'dispute') {
      throw new TypeError(
        'チャージバック以外の記録はupsertByReferenceで記録します。',
      );
    }
    return this.db.insert(records).values(record).onConflictDoNothing();
  }

  fillLinkFundingSourceGroup(input: {
    readonly recordId: string;
    readonly linkFundingSourceGroup: string;
  }): BatchItem<'sqlite'> {
    return this.db
      .update(records)
      .set({
        linkFundingSourceGroup: sql`coalesce(${records.linkFundingSourceGroup}, ${input.linkFundingSourceGroup})`,
      })
      .where(eq(records.id, input.recordId));
  }
}
