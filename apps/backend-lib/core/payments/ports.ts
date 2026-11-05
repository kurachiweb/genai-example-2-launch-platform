import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import type {
  PaymentRecordKind,
  PaymentRecordStatus,
} from '../../../common-lib/payments/payment-record-values.ts';
import type {
  PurchaseKind,
  PurchaseMode,
} from '../../../common-lib/payments/purchase-kinds.ts';
import type {
  EmailRequestStatus,
  PurchaseStatus,
  RefundRequestStatus,
  RejectionReason,
} from '../../../common-lib/payments/purchase-states.ts';
import type {
  CheckoutSummaryText,
  StripeSubscriptionStatus,
} from './purchase-kind-contract.ts';
import type { StripeRefundReason } from './refund-rules.ts';

// Stripeとの通信の結果は反映に要る項目だけの読み取り専用の形にし、Stripeの型を外へ出さない

export interface StripeCheckoutSessionInput {
  readonly purchaseId: string;
  readonly mode: PurchaseMode;
  readonly customerId: string;
  readonly priceId: string;
  readonly quantity: number;
  readonly expiresAt: Date;
  readonly metadata: Readonly<{
    purchase_id: string;
    purchase_kind: PurchaseKind;
    pseudonymous_id: string;
  }>;
}

export interface StripeCheckoutSessionSnapshot {
  readonly id: string;
  readonly status: 'open' | 'complete' | 'expired';
  readonly paymentStatus: 'paid' | 'unpaid' | 'no_payment_required';
  readonly clientSecret: string | null;
  readonly amountTotal: MinorUnitAmount | null;
  readonly currency: string | null;
  readonly expiresAt: Date;
  // 定期課金は初回の請求の支払いから解決する
  readonly paymentIntentId: string | null;
  readonly invoiceId: string | null;
  readonly subscriptionId: string | null;
  readonly linkFundingSourceGroup: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StripePrice {
  readonly lookupKey: string;
  readonly priceId: string;
  readonly unitAmount: MinorUnitAmount;
  readonly currency: 'usd';
  readonly recurringInterval: 'month' | null;
}

export type StripeInvoiceStatus =
  'draft' | 'open' | 'paid' | 'uncollectible' | 'void';

export interface StripeInvoiceSnapshot {
  readonly id: string;
  readonly status: StripeInvoiceStatus;
  readonly amountPaid: MinorUnitAmount;
  readonly amountDue: MinorUnitAmount;
  readonly currency: string;
  readonly paymentIntentId: string | null;
  readonly subscriptionId: string | null;
  // 持ち主の特定に使う定期課金のメタデータ。定期課金の請求でなければ空
  readonly subscriptionMetadata: Readonly<Record<string, string>>;
}

export type StripeRefundStatus =
  'pending' | 'requires_action' | 'succeeded' | 'failed' | 'canceled';

export interface StripeRefundSnapshot {
  readonly id: string;
  readonly status: StripeRefundStatus;
  readonly amount: MinorUnitAmount;
  readonly currency: string;
  readonly paymentIntentId: string | null;
  readonly failureReason: string | null;
  readonly metadata: Readonly<Record<string, string>>;
}

// 符号付きの資金の移動。引き落としは負、戻りは正で、手数料を含めない
export interface StripeDisputeBalanceTransaction {
  readonly id: string;
  readonly amount: MinorUnitAmount;
}

export interface StripeDisputeSnapshot {
  readonly id: string;
  // 不服申し立ての状態や今後加わる未知の値でも取得と反映が失敗しないよう、文字列で受ける
  readonly status: string;
  readonly amount: MinorUnitAmount;
  readonly currency: string;
  readonly paymentIntentId: string | null;
  readonly balanceTransactions: readonly StripeDisputeBalanceTransaction[];
}

export interface StripeSubscriptionSnapshot {
  readonly id: string;
  readonly status: StripeSubscriptionStatus;
  readonly cancelAtPeriodEnd: boolean;
  readonly cancelAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly endedAt: Date | null;
  readonly customerId: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface StripePaymentOwnerHint {
  readonly paymentIntentId: string;
  readonly metadata: Readonly<Record<string, string>>;
  // 請求の支払いのとき、その定期課金のメタデータ。それ以外はnull
  readonly subscriptionMetadata: Readonly<Record<string, string>> | null;
}

// STRIPE_API_KEYが未設定なら、各操作はStripeを呼ばずにStripeUnavailableErrorを投げる
export interface StripeGateway {
  ensureCustomer(input: {
    readonly existingCustomerId: string | null;
    readonly email: string;
    readonly pseudonymousId: string;
  }): Promise<{ readonly customerId: string; readonly created: boolean }>;
  deleteCustomer(customerId: string): Promise<'deleted' | 'already_deleted'>;
  resolvePrices(lookupKeys: readonly string[]): Promise<readonly StripePrice[]>;
  createCheckoutSession(
    input: StripeCheckoutSessionInput,
  ): Promise<StripeCheckoutSessionSnapshot>;
  retrieveCheckoutSession(
    sessionId: string,
  ): Promise<StripeCheckoutSessionSnapshot>;
  expireCheckoutSession(sessionId: string): Promise<'expired' | 'not_open'>;
  retrieveInvoice(invoiceId: string): Promise<StripeInvoiceSnapshot>;
  retrieveRefund(refundId: string): Promise<StripeRefundSnapshot>;
  retrieveDispute(disputeId: string): Promise<StripeDisputeSnapshot>;
  retrieveSubscription(
    subscriptionId: string,
  ): Promise<StripeSubscriptionSnapshot>;
  createRefund(input: {
    readonly paymentIntentId: string;
    readonly amount: MinorUnitAmount | null;
    readonly reason: StripeRefundReason;
    readonly refundRequestId: string;
    readonly purchaseId: string;
    readonly idempotencyKey: string;
  }): Promise<StripeRefundSnapshot>;
  cancelSubscription(
    subscriptionId: string,
    options: { readonly atPeriodEnd: boolean },
  ): Promise<'canceled' | 'already_canceled'>;
  createPortalSession(input: {
    readonly customerId: string;
    readonly returnUrl: string;
  }): Promise<{ readonly url: string }>;
  retrievePaymentIntentOwner(
    paymentIntentId: string,
  ): Promise<StripePaymentOwnerHint>;
}

export interface VerifiedStripeEvent {
  readonly id: string;
  readonly type: string;
  // 秒
  readonly created: number;
  readonly data: { readonly object: { readonly id: string } };
}

export interface StripeWebhookVerifier {
  // 署名の不正はStripeSignatureError、署名の秘密が未設定ならStripeUnavailableError
  verify(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<VerifiedStripeEvent>;
}

export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

// 例外の分類は、application層の返金の実行・Webhookの受け付け・決済の開始が判定に使う

// 接続の失敗・レート制限・Stripe側の障害・キーの未設定など、再試行で解消し得る失敗
export class StripeUnavailableError extends Error {
  override readonly name = 'StripeUnavailableError';
}

export class StripeNotFoundError extends Error {
  override readonly name = 'StripeNotFoundError';
}

// 再試行で解消しない要求の拒否
export class StripeRejectedError extends Error {
  override readonly name = 'StripeRejectedError';
  readonly stripeErrorCode: string;

  constructor(
    input: { readonly message: string; readonly stripeErrorCode: string },
    options?: ErrorOptions,
  ) {
    super(input.message, options);
    this.stripeErrorCode = input.stripeErrorCode;
  }
}

export class StripeSignatureError extends Error {
  override readonly name = 'StripeSignatureError';
}

export interface NewPurchase {
  readonly id: string;
  readonly userId: string;
  readonly kind: PurchaseKind;
  readonly targetId: string | null;
  readonly relatedId: string | null;
  readonly exclusivityKey: string | null;
  readonly stateToken: string;
  readonly priceLookupKey: string;
  readonly stripePriceId: string;
  readonly unitAmount: MinorUnitAmount;
  readonly quantity: number;
  readonly amountTotal: MinorUnitAmount;
  readonly summary: CheckoutSummaryText;
  readonly deadlineAt: Date | null;
  readonly acceptUntil: Date | null;
  readonly fulfillableUntil: Date | null;
  readonly expiresAt: Date;
}

export interface PurchaseRecord extends NewPurchase {
  readonly status: PurchaseStatus;
  readonly rejectionReason: RejectionReason | null;
  readonly stripeCheckoutSessionId: string | null;
  readonly stripePaymentIntentId: string | null;
  readonly stripeInvoiceId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly consentedAt: Date | null;
  readonly consentVersion: string | null;
  readonly paidAt: Date | null;
  readonly reflectedAt: Date | null;
  readonly confirmationEmailStatus: EmailRequestStatus;
  readonly lastEventAt: Date | null;
  readonly createdAt: Date;
}

// 状態の前進と同じ文で保存する値。省略した項目は変えない
export interface PurchasePatch {
  readonly rejectionReason?: RejectionReason;
  readonly stripePaymentIntentId?: string | null;
  readonly stripeInvoiceId?: string | null;
  readonly stripeSubscriptionId?: string | null;
  readonly amountTotal?: MinorUnitAmount;
  readonly paidAt?: Date;
  readonly reflectedAt?: Date;
  readonly confirmationEmailStatus?: EmailRequestStatus;
  readonly lastEventAt?: Date;
}

// 版の検査を伴わずに進めてよい行き先。権利の付与・拒否は他の文と同じ一括の書き込みで版を検査する
export type AloneAdvanceTarget = Extract<
  PurchaseStatus,
  'processing' | 'expired'
>;

export interface PurchaseAdvance {
  readonly purchaseId: string;
  readonly to: PurchaseStatus;
  readonly from: readonly PurchaseStatus[];
  // 前進の後のstate_token(新しいULID)
  readonly nextToken: string;
  readonly patch: PurchasePatch;
}

export interface PurchaseStore {
  findById(purchaseId: string): Promise<PurchaseRecord | undefined>;
  findBySessionId(sessionId: string): Promise<PurchaseRecord | undefined>;
  findByPaymentIntentId(
    paymentIntentId: string,
  ): Promise<PurchaseRecord | undefined>;
  attachSession(input: {
    readonly purchaseId: string;
    readonly sessionId: string;
    readonly expiresAt: Date;
  }): Promise<void>;
  findOpenByUser(userId: string): Promise<readonly PurchaseRecord[]>;
  findOpenByTarget(input: {
    readonly userId: string;
    readonly kind: PurchaseKind;
    readonly targetId: string | null;
  }): Promise<readonly PurchaseRecord[]>;
  findReconcilable(input: {
    readonly deadlineFrom: Date;
    readonly deadlineTo: Date;
    readonly limit: number;
  }): Promise<readonly PurchaseRecord[]>;
  findStaleOpen(input: {
    readonly expiredBefore: Date;
    readonly limit: number;
  }): Promise<readonly PurchaseRecord[]>;
  // 同じ購入の再記録は最新の日時で上書きする
  recordConsent(input: {
    readonly purchaseId: string;
    readonly userId: string;
    readonly consentedAt: Date;
    readonly version: string;
  }): Promise<'recorded' | 'not_open'>;
  // 他の文を伴わない前進(失効・処理中への前進)。前進の元の状態のときだけ進め、進めたかを返す
  advanceAlone(
    input: PurchaseAdvance & { readonly to: AloneAdvanceTarget },
  ): Promise<boolean>;
  // 購入確認メールが依頼待ちのまま、反映から指定の日時より前の購入
  findPendingConfirmations(input: {
    readonly reflectedBefore: Date;
    readonly limit: number;
  }): Promise<readonly PurchaseRecord[]>;
  // 依頼待ちのときだけ進め、進めたかを返す
  markConfirmationEmail(input: {
    readonly purchaseId: string;
    readonly to: 'requested' | 'skipped';
  }): Promise<boolean>;
}

export interface NewPaymentRecord {
  readonly id: string;
  readonly pseudonymousId: string;
  readonly kind: PaymentRecordKind;
  readonly purpose: PurchaseKind;
  readonly status: PaymentRecordStatus;
  // 返金・チャージバックの引き落としは負
  readonly amount: MinorUnitAmount;
  readonly currency: 'usd';
  readonly quantity: number | null;
  readonly stripeReference: string;
  readonly relatedId: string | null;
  readonly purchaseId: string | null;
  readonly consentedAt: Date | null;
  readonly consentVersion: string | null;
  readonly linkFundingSourceGroup: string | null;
  readonly occurredAt: Date;
  readonly lastEventAt: Date;
  readonly recordedAt: Date;
}

// 決済履歴の一覧とデータエクスポートが使う項目
export interface PaymentRecordRow {
  readonly id: string;
  readonly kind: PaymentRecordKind;
  readonly purpose: PurchaseKind;
  readonly amount: MinorUnitAmount;
  readonly currency: 'usd';
  readonly quantity: number | null;
  readonly status: PaymentRecordStatus;
  readonly stripeReference: string;
  readonly relatedId: string | null;
  readonly occurredAt: Date;
}

// 発生時刻の降順・IDの降順の一覧の続きの位置。この行を含まず、より前の行から返す
export interface PaymentRecordCursor {
  readonly occurredAt: Date;
  readonly id: string;
}

export interface PaymentRecordStore {
  listByPseudonymousId(input: {
    readonly pseudonymousId: string;
    readonly first: number;
    readonly after: PaymentRecordCursor | null;
  }): Promise<readonly PaymentRecordRow[]>;
  listAllByPseudonymousId(
    pseudonymousId: string,
  ): Promise<readonly PaymentRecordRow[]>;
  // 消した件数を返す
  deleteRecordedBefore(threshold: Date, limit: number): Promise<number>;
}

export interface StripeObjectStore {
  findLastEventAt(objectId: string): Promise<Date | undefined>;
}

export interface NewRefundRequest {
  readonly id: string;
  readonly purchaseId: string;
  readonly requestKey: string;
  readonly amount: MinorUnitAmount;
  readonly reason: string;
  // 自動返金の通知を送る依頼はpending、それ以外はnone
  readonly noticeStatus: EmailRequestStatus;
}

export interface RefundRequestRecord extends NewRefundRequest {
  readonly status: RefundRequestStatus;
  readonly stripeRefundId: string | null;
  readonly failureCode: string | null;
  readonly dispatchedAt: Date | null;
  readonly createdAt: Date;
}

export interface RefundStore {
  findById(refundRequestId: string): Promise<RefundRequestRecord | undefined>;
  findByRequestKey(
    requestKey: string,
  ): Promise<RefundRequestRecord | undefined>;
  findByStripeRefundId(
    stripeRefundId: string,
  ): Promise<RefundRequestRecord | undefined>;
  // 失敗・取り消し以外の依頼の金額の合計
  sumRequested(purchaseId: string): Promise<MinorUnitAmount>;
  // 未送信のときだけ送信の日時を記録する
  markDispatched(refundRequestId: string, at: Date): Promise<void>;
  updateStatus(input: {
    readonly refundRequestId: string;
    readonly status: RefundRequestStatus;
    readonly stripeRefundId?: string;
    readonly failureCode?: string | null;
  }): Promise<void>;
  // 作成から指定の日時より前で、まだ送っていない依頼
  findUndispatched(input: {
    readonly createdBefore: Date;
    readonly limit: number;
  }): Promise<readonly RefundRequestRecord[]>;
  // 依頼待ちのときだけ進め、進めたかを返す
  markNotice(input: {
    readonly refundRequestId: string;
    readonly to: 'requested' | 'skipped';
  }): Promise<boolean>;
  // 返金が成功したまま、通知が依頼待ちで、更新から指定の日時より前の依頼
  findPendingNotices(input: {
    readonly updatedBefore: Date;
    readonly limit: number;
  }): Promise<readonly RefundRequestRecord[]>;
}

export interface CustomerStore {
  // StripeのCustomerのID
  find(userId: string): Promise<string | undefined>;
  save(userId: string, customerId: string): Promise<void>;
}

export interface CustomerDirectory {
  findCustomerId(userId: string): Promise<string | undefined>;
}

export interface PriceSnapshot extends StripePrice {
  readonly fetchedAt: Date;
}

export interface PriceSnapshotStore {
  findMany(lookupKeys: readonly string[]): Promise<readonly PriceSnapshot[]>;
  // lookup_keyでupsertする
  saveMany(prices: readonly StripePrice[], fetchedAt: Date): Promise<void>;
}

export interface PriceCatalogResult {
  readonly prices: readonly StripePrice[];
  // Stripeに到達できず、以前に照会した値を返したときに真
  readonly stale: boolean;
}

export interface PriceCatalog {
  // 値が1つも無くStripeにも到達できなければAppError(unavailable, payments_unavailable)
  getPrices(lookupKeys: readonly string[]): Promise<PriceCatalogResult>;
}

// 日時はミリ秒までのUTCのISO 8601
export interface PaymentHistoryExportItem {
  readonly id: string;
  readonly kind: PaymentRecordKind;
  readonly purpose: PurchaseKind;
  readonly amount: MinorUnitAmount;
  readonly currency: 'usd';
  readonly quantity: number | null;
  readonly status: PaymentRecordStatus;
  readonly stripeReference: string;
  readonly relatedId: string | null;
  readonly occurredAt: string;
}

export interface PaymentHistoryExport {
  // 発生時刻の昇順
  listAll(pseudonymousId: string): Promise<readonly PaymentHistoryExportItem[]>;
}

export type ReflectionInstruction =
  | {
      readonly kind: 'checkout_session';
      readonly sessionId: string;
      readonly occurredAt: Date;
    }
  | {
      readonly kind: 'invoice';
      readonly invoiceId: string;
      readonly occurredAt: Date;
    }
  | {
      readonly kind: 'refund';
      readonly refundId: string;
      readonly occurredAt: Date;
    }
  | {
      readonly kind: 'dispute';
      readonly disputeId: string;
      readonly stage: 'funds_withdrawn' | 'funds_reinstated' | 'closed';
      readonly occurredAt: Date;
    }
  | {
      readonly kind: 'subscription';
      readonly subscriptionId: string;
      readonly occurredAt: Date;
    }
  | { readonly kind: 'ignored'; readonly eventType: string };

export type ReflectionOutcome =
  | { readonly kind: 'applied'; readonly purchaseStatus?: PurchaseStatus }
  | {
      readonly kind: 'already_applied';
      readonly purchaseStatus?: PurchaseStatus;
    }
  // 記録済みより古い発生時刻の通知
  | { readonly kind: 'stale' }
  // 本サービスの購入・利用者に結び付かない
  | { readonly kind: 'unresolved' }
  | { readonly kind: 'ignored' };

export interface PaymentReflector {
  // 一時的な失敗は例外で返し、部分的な書き込みを残さない
  reflect(instruction: ReflectionInstruction): Promise<ReflectionOutcome>;
  // 戻りの画面と突合が取得した決済セッションを反映する
  reflectCheckoutSnapshot(
    snapshot: StripeCheckoutSessionSnapshot,
    occurredAt: Date,
  ): Promise<ReflectionOutcome>;
}

export interface OpenCheckoutExpirer {
  // Stripeの一時的な失敗は例外
  expireOpen(input: {
    readonly userId: string;
    readonly kinds: readonly PurchaseKind[] | 'all';
    readonly targetId?: string;
    // 1〜50
    readonly limit: number;
  }): Promise<{ readonly expired: number; readonly remaining: boolean }>;
}

export interface RefundRequestInput {
  readonly purchaseId: string;
  // nullは残りの全額
  readonly amount: MinorUnitAmount | null;
  // 小文字・数字・_の1〜64文字。例 'entitlement_lost'・'late'・'duplicate'
  readonly reason: string;
  // 依頼元が定める一意な鍵(1〜128文字)。reflection:で始まる鍵は自動返金だけが使う
  readonly requestKey: string;
}

export type RefundRequestResult =
  | {
      readonly kind: 'accepted';
      readonly refundRequestId: string;
      // 真なら同じ依頼キーの既存の依頼
      readonly duplicate: boolean;
    }
  | {
      readonly kind: 'rejected';
      readonly code:
        | 'purchase_not_found'
        | 'not_paid'
        | 'invalid_amount'
        | 'amount_exceeds_refundable'
        | 'invalid_request_key';
    };

export interface PaymentRefunds {
  // 依頼の記録と送信まで行う
  request(input: RefundRequestInput): Promise<RefundRequestResult>;
  // 送信済みなら何もしない。送信の失敗はログだけにし、日次の確認で送り直す
  dispatch(refundRequestId: string): Promise<void>;
}

export type NoticeOutcome = 'requested' | 'skipped' | 'not_pending';

export interface PurchaseNotifier {
  notifyPurchase(purchaseId: string): Promise<NoticeOutcome>;
  notifyAutomaticRefund(refundRequestId: string): Promise<NoticeOutcome>;
}

export interface RevenuePeriod {
  // 含む
  readonly from: Date;
  // 含まない
  readonly to: Date;
}

export interface PaymentRevenueReport {
  // 1〜60期間。結果は入力の順で、該当が無い期間は0
  netRevenue(
    periods: readonly RevenuePeriod[],
  ): Promise<readonly MinorUnitAmount[]>;
}
