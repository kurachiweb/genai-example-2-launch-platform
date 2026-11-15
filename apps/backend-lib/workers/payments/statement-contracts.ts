import type { BatchItem } from 'drizzle-orm/batch';

import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import type {
  RefundRequestStatus,
  RejectionReason,
} from '../../../common-lib/payments/purchase-states.ts';
import type {
  NewPaymentRecord,
  NewPurchase,
  NewRefundRequest,
  PurchaseAdvance,
  RefundRequestInput,
  RefundRequestResult,
} from '../../core/payments/ports.ts';

// 一括の書き込みの先頭に置く業務の行の挿入。版が一致しなければ検査の列にNULLを入れ、NOT NULLの違反で一括の書き込み全体を取り消す
export interface GuardedStatement {
  readonly statement: BatchItem<'sqlite'>;
  readonly guardColumn:
    'payment_records.pseudonymous_id' | 'payment_stripe_objects.last_event_at';
}

export interface GuardedBatch {
  // 検査の列のNOT NULLの違反だけをguard_failedにし、他の制約の違反(部分一意索引・後続specの文)をconstraint_failedにする
  run(input: {
    readonly guarded: GuardedStatement;
    readonly rest: readonly BatchItem<'sqlite'>[];
  }): Promise<'committed' | 'guard_failed' | 'constraint_failed'>;
}

export interface PurchaseStatements {
  create(record: NewPurchase): BatchItem<'sqlite'>;
  advance(input: PurchaseAdvance): BatchItem<'sqlite'>;
  deleteByUser(userId: string): BatchItem<'sqlite'>;
}

export interface PaymentRecordStatements {
  // 購入のstate_tokenが読み取った版と一致するときだけpseudonymous_idに値が入る。SQLiteはNOT NULLを一意性より先に確かめるため、一意キーの衝突は無視できる
  insertCheckoutRecordGuarded(
    record: NewPaymentRecord,
    guard: { readonly purchaseId: string; readonly expectedToken: string },
  ): GuardedStatement;
  // 記録済みの発生時刻が受け取った発生時刻より新しくないときだけ更新する(古い通知で巻き戻さない。請求・返金)
  upsertByReference(record: NewPaymentRecord): BatchItem<'sqlite'>;
  // (stripe_reference, kind, status)の一意キーで重複を無視する
  insertDisputeStage(record: NewPaymentRecord): BatchItem<'sqlite'>;
  // 記録済みの行のLinkの資金源のグループが空のときだけ埋める(定期課金の初回の請求の通知が決済セッションの反映より先に記録した行)
  fillLinkFundingSourceGroup(input: {
    readonly recordId: string;
    readonly linkFundingSourceGroup: string;
  }): BatchItem<'sqlite'>;
}

export interface StripeObjectStatements {
  // object_idの一意索引でupsertし、より新しい発生時刻が記録済みならlast_event_atにNULLを入れる(同じか新しい通知だけが通る)
  advanceGuarded(input: {
    readonly objectId: string;
    readonly objectType: 'subscription';
    readonly occurredAt: Date;
  }): GuardedStatement;
}

export interface RefundStatements {
  // request_keyの一意制約で、まだ確定していない同じ依頼キーの2つ目の一括の書き込みは失敗する
  insert(record: NewRefundRequest): BatchItem<'sqlite'>;
  // 依頼の状態がfromにあり、状態か返金のIDが変わるときだけ更新する。更新日時は自動返金の通知の返金の日時になるため、同じ状態の通知では変えない
  reflectStripeStatus(input: {
    readonly refundRequestId: string;
    readonly status: RefundRequestStatus;
    readonly from: readonly RefundRequestStatus[];
    readonly stripeRefundId: string;
    // 省くと変えない
    readonly failureCode?: string | null;
  }): BatchItem<'sqlite'>;
  deleteByUser(userId: string): BatchItem<'sqlite'>;
}

export interface CustomerStatements {
  deleteByUser(userId: string): BatchItem<'sqlite'>;
}

export interface PaymentRefundStatements {
  // 依頼元の一括の書き込みに含める文を返し、確定の後に依頼元がPaymentRefunds.dispatchを呼ぶ。同じ依頼キーの既存の依頼はduplicateが真で文は空
  prepare(input: RefundRequestInput): Promise<
    | {
        readonly kind: 'accepted';
        readonly refundRequestId: string;
        readonly duplicate: boolean;
        readonly statements: readonly BatchItem<'sqlite'>[];
      }
    | Extract<RefundRequestResult, { kind: 'rejected' }>
  >;
  // 購入をrejectedへ前進させる同じ一括の書き込みで確定する前提で、読み取りを行わず、購入の状態とPaymentIntentのIDの検査を省いて全額の依頼の行を作る
  prepareForReflection(input: {
    readonly purchaseId: string;
    readonly amountPaid: MinorUnitAmount;
    readonly reason: RejectionReason;
    // 'reflection:<購入ID>'
    readonly requestKey: string;
  }): {
    readonly refundRequestId: string;
    readonly statements: readonly BatchItem<'sqlite'>[];
  };
}
