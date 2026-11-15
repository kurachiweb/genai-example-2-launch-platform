import { PURCHASE_KIND_LABELS } from '../../../common-lib/payments/purchase-kinds.ts';
import { PAYMENTS_TYPES } from '../../core/payments/identifiers.ts';
import type {
  PaymentsEnv,
  PurchaseOffer,
  PurchaseOfferDecision,
  PurchaseOfferPolicy,
} from '../../core/payments/purchase-kind-contract.ts';
import type {
  FulfillmentPlan,
  PurchaseFulfillment,
  PurchaseKindRegistration,
} from './fulfillment-contract.ts';

// 1USDの1回限りの価格。開発用とデプロイ先検証用のStripeのsandboxにだけ作る
export const SMOKE_PURCHASE_LOOKUP_KEY = 'payments_smoke';

const SMOKE_PURCHASE_OFFER: PurchaseOffer = Object.freeze({
  priceLookupKey: SMOKE_PURCHASE_LOOKUP_KEY,
  quantity: 1,
  relatedId: null,
  exclusivityKey: null,
  deadlineAt: null,
  acceptUntil: null,
  fulfillableUntil: null,
  summary: Object.freeze({
    itemName: PURCHASE_KIND_LABELS.payments_smoke,
    quantityLabel: '1件',
    serviceTiming: '提供する役務はありません',
    additionalNotes: Object.freeze([
      '決済の疎通確認のための購入です。開発と検証の環境だけで受け付け、権利は付与されません。',
    ]),
  }),
  requiresBotVerification: false,
});

export class SmokePurchaseOfferPolicy implements PurchaseOfferPolicy {
  describe(): Promise<PurchaseOfferDecision> {
    return Promise.resolve({ kind: 'available', offer: SMOKE_PURCHASE_OFFER });
  }
}

export class SmokePurchaseFulfillment implements PurchaseFulfillment {
  prepare(): Promise<FulfillmentPlan> {
    return Promise.resolve({ kind: 'fulfill', statements: [] });
  }
}

export const SMOKE_PURCHASE_REGISTRATION: PurchaseKindRegistration =
  Object.freeze({
    kind: 'payments_smoke',
    offer: PAYMENTS_TYPES.SmokePurchaseOffer,
    fulfillment: PAYMENTS_TYPES.SmokePurchaseFulfillment,
    enabled: (env: PaymentsEnv) => env.PAYMENTS_SMOKE_ENABLED === 'true',
  });
