import { inject, injectable } from 'inversify';

import type {
  PaymentRecordKind,
  PaymentRecordStatus,
} from '../../../common-lib/payments/payment-record-values.ts';
import {
  checkPaymentHistoryPageSize,
  PAYMENT_HISTORY_PAGE_SIZE_DEFAULT,
} from '../../../common-lib/payments/payment-input-rules.ts';
import type { PurchaseKind } from '../../../common-lib/payments/purchase-kinds.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type {
  PaymentRecordRow,
  PaymentRecordStore,
} from '../../../lib/core/payments/ports.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { CheckoutMoney } from './checkout-view.ts';
import {
  decodePaymentHistoryCursor,
  encodePaymentHistoryCursor,
} from './payment-history-cursor.ts';
import { paymentHistoryPageSizeRejectedError } from './payments-errors.ts';

// 画面に出す項目だけにし、Stripe側のIDと関連する対象のIDを含めない
export interface PaymentHistoryEntry {
  readonly id: string;
  readonly kind: PaymentRecordKind;
  readonly purpose: PurchaseKind;
  // 返金・チャージバックの引き落としは負
  readonly amount: CheckoutMoney;
  readonly quantity: number | null;
  readonly status: PaymentRecordStatus;
  readonly occurredAt: Date;
}

export interface PaymentHistoryPage {
  readonly edges: readonly {
    readonly cursor: string;
    readonly node: PaymentHistoryEntry;
  }[];
  readonly pageInfo: {
    readonly hasNextPage: boolean;
    readonly endCursor: string | null;
  };
}

export interface PaymentHistoryPageInput {
  // 1〜50。省略すると20
  readonly first?: number | undefined;
  readonly after?: string | undefined;
}

export interface PaymentHistoryReader {
  // 発生時刻の新しい順。件数の範囲外はvalidation_error、カーソルの誤りはinvalid_cursor
  list(
    session: SessionView,
    input: PaymentHistoryPageInput,
  ): Promise<PaymentHistoryPage>;
}

const entryOf = (row: PaymentRecordRow): PaymentHistoryEntry => ({
  id: row.id,
  kind: row.kind,
  purpose: row.purpose,
  amount: { amount: row.amount, currency: row.currency },
  quantity: row.quantity,
  status: row.status,
  occurredAt: row.occurredAt,
});

function pageSizeOf(first: number | undefined): number {
  if (first === undefined) {
    return PAYMENT_HISTORY_PAGE_SIZE_DEFAULT;
  }
  const issue = checkPaymentHistoryPageSize(first);
  if (issue !== undefined) {
    throw paymentHistoryPageSizeRejectedError(issue);
  }
  return first;
}

@injectable()
export class StorePaymentHistoryReader implements PaymentHistoryReader {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(PAYMENTS_TYPES.PaymentRecordStore)
    private readonly records: PaymentRecordStore,
  ) {}

  async list(
    session: SessionView,
    input: PaymentHistoryPageInput,
  ): Promise<PaymentHistoryPage> {
    const { user } = await this.guard.requireUser(session);
    const first = pageSizeOf(input.first);
    const after =
      input.after === undefined
        ? null
        : decodePaymentHistoryCursor(input.after);
    // 続きの有無を知るため1件多く読む
    const rows = await this.records.listByPseudonymousId({
      pseudonymousId: user.pseudonymousId,
      first: first + 1,
      after,
    });
    const edges = rows.slice(0, first).map((row) => ({
      cursor: encodePaymentHistoryCursor(row),
      node: entryOf(row),
    }));
    return {
      edges,
      pageInfo: {
        hasNextPage: rows.length > first,
        endCursor: edges.at(-1)?.cursor ?? null,
      },
    };
  }
}
