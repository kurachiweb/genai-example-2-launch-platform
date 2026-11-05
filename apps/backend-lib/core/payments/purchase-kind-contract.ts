import type { ServiceIdentifier } from 'inversify';

import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import type { PurchaseKind } from '../../../common-lib/payments/purchase-kinds.ts';

export interface PaymentsEnv {
  // staging・prodだけで必須。未設定なら決済の機能だけが縮退する。環境の型と検証の結果は省略可能なプロパティのため、省略可能にする
  readonly STRIPE_API_KEY?: string | undefined;
  readonly PAYMENTS_SMOKE_ENABLED: 'true' | 'false';
  readonly CLIENT_SITE_ORIGIN: string;
}

export interface PurchaseOfferRequest {
  readonly userId: string;
  // 購入種別を受け持つ機能の対象(申込のID・ローンチのIDなど)
  readonly targetId: string | null;
  readonly now: Date;
}

// 最終確認画面と購入確認メールに載せる表示事項
export interface CheckoutSummaryText {
  readonly itemName: string;
  // 分量。例「1件」「7日間(2026年11月1日〜7日)」
  readonly quantityLabel: string;
  readonly serviceTiming: string;
  // 自動更新・解約方法など、購入種別ごとの追加事項。無ければ空
  readonly additionalNotes: readonly string[];
}

// 不変条件: deadlineAtがあればacceptUntilとfulfillableUntilもあり、acceptUntil ≤ deadlineAt ≤ fulfillableUntil
export interface PurchaseOffer {
  // Stripeの価格のlookup_key
  readonly priceLookupKey: string;
  // 1〜366の整数。都度決済の日数か1
  readonly quantity: number;
  // 決済履歴に写す関連のID(ローンチ・広告のIDなど)
  readonly relatedId: string | null;
  // 二重決済の判定の鍵。完了した購入のうち同じ鍵は高々1つ
  readonly exclusivityKey: string | null;
  readonly deadlineAt: Date | null;
  readonly acceptUntil: Date | null;
  readonly fulfillableUntil: Date | null;
  readonly summary: CheckoutSummaryText;
  readonly requiresBotVerification: boolean;
}

export type PurchaseOfferDecision =
  | { readonly kind: 'available'; readonly offer: PurchaseOffer }
  | {
      readonly kind: 'unavailable';
      readonly code: string;
      readonly message: string;
    };

export interface PurchaseOfferPolicy {
  describe(request: PurchaseOfferRequest): Promise<PurchaseOfferDecision>;
}

export interface FulfillablePurchase {
  readonly purchaseId: string;
  readonly userId: string;
  readonly kind: PurchaseKind;
  readonly targetId: string | null;
  readonly relatedId: string | null;
  readonly quantity: number;
  readonly amountTotal: MinorUnitAmount;
  // 決済履歴の記録のID。購入種別を受け持つ機能が保存してよい。定期課金の初回の請求の通知が先に記録した行はそのID。ただし請求の通知の記録と決済セッションの反映が同時に進むと、どの行も指さないIDになり得るため、行の存在を前提にしない
  readonly paymentRecordId: string;
  readonly paidAt: Date;
  readonly stripeSubscriptionId: string | null;
}

// 購入種別の登録のうちapplication層が使う部分。権利の付与(fulfillment)はD1の文を返すため、workersの登録の型が加える
export interface PurchaseOfferRegistration {
  readonly kind: PurchaseKind;
  readonly offer: ServiceIdentifier<PurchaseOfferPolicy>;
  // 省略すると常に有効
  readonly enabled?: (env: PaymentsEnv) => boolean;
}

export type StripeSubscriptionStatus =
  | 'incomplete'
  | 'incomplete_expired'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'paused';

export interface SubscriptionChange {
  readonly subscriptionId: string;
  // 利用者の物理削除の後はnull
  readonly userId: string | null;
  readonly pseudonymousId: string;
  readonly purchaseId: string | null;
  readonly status: StripeSubscriptionStatus;
  readonly cancelAtPeriodEnd: boolean;
  // 柔軟な請求モードの期間末の解約は、cancelAtPeriodEndが偽のままこの解約の予定時刻だけで表される
  readonly cancelAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly endedAt: Date | null;
  readonly occurredAt: Date;
}

// application層は既定の型引数で、workersの反映はfulfillmentを加えた登録の型で、同じ束縛を受け取る
export interface PurchaseKindRegistry<
  TRegistration extends PurchaseOfferRegistration = PurchaseOfferRegistration,
> {
  // 無効・未登録の購入種別はundefined
  resolve(kind: PurchaseKind, env: PaymentsEnv): TRegistration | undefined;
}
