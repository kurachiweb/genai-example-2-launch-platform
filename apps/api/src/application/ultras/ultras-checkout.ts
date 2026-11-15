import { inject, injectable } from 'inversify';

import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { CheckoutStarter } from '../payments/checkout-starter.ts';
import { API_PAYMENTS_TYPES } from '../payments/payments-types.ts';

export interface UltrasCheckout {
  // 利用者の状態・回数制限・加入の可否の拒否は決済の開始がAppErrorで投げる
  start(session: SessionView): Promise<{ readonly purchaseId: string }>;
}

@injectable()
export class DefaultUltrasCheckout implements UltrasCheckout {
  constructor(
    @inject(API_PAYMENTS_TYPES.CheckoutStarter)
    private readonly starter: CheckoutStarter,
  ) {}

  // Ultrasはbot判定を求めないため、bot判定の口を渡さない
  start(session: SessionView): Promise<{ readonly purchaseId: string }> {
    return this.starter.start({ session, kind: 'ultras', targetId: null });
  }
}
