import type {
  PurchaseKindRegistration,
  SubscriptionEventSinkRegistration,
} from './fulfillment-contract.ts';
import { SMOKE_PURCHASE_REGISTRATION } from './smoke-purchase.ts';

// 購入種別を受け持つ後続specは、自分の登録をここへ追記し、offerとfulfillmentの識別子を両アプリのモジュールで束縛する
export const PURCHASE_KIND_REGISTRATIONS: readonly PurchaseKindRegistration[] =
  Object.freeze([SMOKE_PURCHASE_REGISTRATION]);

// 定期課金の状態を受け取る後続specは、自分の受け取り口を<spec名>.<名詞句>の名前でここへ追記する
export const SUBSCRIPTION_EVENT_SINKS: readonly SubscriptionEventSinkRegistration[] =
  Object.freeze([]);
