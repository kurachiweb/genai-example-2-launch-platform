import type { ServiceIdentifier } from 'inversify';

import type { NewPurchase } from '../../../lib/core/payments/ports.ts';
import type { PurchaseOfferPolicy } from '../../../lib/core/payments/purchase-kind-contract.ts';

export interface CheckoutStartLimits {
  // 超過はAppError(rate_limited, rate_limit_exceeded, retryAfterSeconds)
  consume(userId: string, now: Date): Promise<void>;
}

export interface CheckoutPurchaseWriter {
  // 同じ対象のopenの購入をsupersededへ前進させ、新しい購入を挿入する。1回の一括の書き込みで確定する
  replaceOpen(input: {
    readonly purchase: NewPurchase;
    // 購入ID。openでなくなった購入は変えない
    readonly supersede: readonly string[];
  }): Promise<void>;
  // Stripeの失敗のとき、openの購入をexpiredへ前進させる
  expire(purchaseId: string): Promise<void>;
}

// 購入の可否の口は購入種別を受け持つ機能のモジュールが束縛するため、合成ルートが処理単位のコンテナから解決する関数を渡す
export interface PurchaseOfferPolicyResolver {
  resolve(
    identifier: ServiceIdentifier<PurchaseOfferPolicy>,
  ): PurchaseOfferPolicy;
}
