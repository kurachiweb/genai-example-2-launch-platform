import { sql } from 'drizzle-orm';

import type { Database } from '../../../db/client.ts';
import { paymentPurchases } from '../../../db/schema/payments/payment-purchases.ts';
import { paymentRecords } from '../../../db/schema/payments/payment-records.ts';
import type { NewPaymentRecord } from '../../core/payments/ports.ts';
import type { GuardedStatement } from './statement-contracts.ts';

// 購入のstate_tokenが読み取った版と異なる(購入が無い場合を含む)と仮名化IDがNULLになり、NOT NULL制約の違反で一括の書き込み全体が取り消される。SQLiteはNOT NULLを一意性より先に確かめるため、記録済みの行との衝突を無視しても検査は働く
export function checkoutRecordGuardedInsert(
  db: Database,
  record: NewPaymentRecord,
  guard: { readonly purchaseId: string; readonly expectedToken: string },
): GuardedStatement {
  const currentToken = sql`(SELECT ${paymentPurchases.stateToken} FROM ${paymentPurchases} WHERE ${paymentPurchases.id} = ${guard.purchaseId})`;
  return {
    statement: db
      .insert(paymentRecords)
      .values({
        ...record,
        pseudonymousId: sql`CASE WHEN ${currentToken} = ${guard.expectedToken} THEN ${record.pseudonymousId} ELSE NULL END`,
      })
      .onConflictDoNothing(),
    guardColumn: 'payment_records.pseudonymous_id',
  };
}
