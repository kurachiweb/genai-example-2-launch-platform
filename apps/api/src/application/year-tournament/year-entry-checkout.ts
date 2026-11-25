import { inject, injectable } from 'inversify';

import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { CheckoutStarter } from '../payments/checkout-starter.ts';
import { API_PAYMENTS_TYPES } from '../payments/payments-types.ts';

export interface YearEntryCheckout {
  // 枠の判定・受付期限・利用者の状態・回数制限の拒否は決済の開始がAppErrorで投げる
  start(
    session: SessionView,
    launchId: string,
  ): Promise<{ readonly purchaseId: string }>;
}

@injectable()
export class DefaultYearEntryCheckout implements YearEntryCheckout {
  constructor(
    @inject(API_PAYMENTS_TYPES.CheckoutStarter)
    private readonly starter: CheckoutStarter,
  ) {}

  // 参加費はbot判定を求めないため、bot判定の口を渡さない
  start(
    session: SessionView,
    launchId: string,
  ): Promise<{ readonly purchaseId: string }> {
    return this.starter.start({
      session,
      kind: 'year_tournament_entry',
      targetId: launchId,
    });
  }
}
