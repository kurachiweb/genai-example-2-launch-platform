import { inject, injectable } from 'inversify';

import { CHECKOUT_CONSENT_VERSION } from '../../../common-lib/payments/checkout-consent.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type { PurchaseStore } from '../../../lib/core/payments/ports.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type { CheckoutReader } from './checkout-reader.ts';
import {
  type CheckoutView,
  isOwnPurchase,
  isPayableOpen,
} from './checkout-view.ts';
import { paymentsError } from './payments-errors.ts';
import { API_PAYMENTS_TYPES } from './payments-types.ts';

export interface CheckoutConsentRecorder {
  // 支払いの確定の前に呼ぶ。他人・存在しない購入はcheckout_not_found、支払える状態でなければcheckout_not_open
  record(session: SessionView, purchaseId: string): Promise<CheckoutView>;
}

@injectable()
export class StoreCheckoutConsentRecorder implements CheckoutConsentRecorder {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(PAYMENTS_TYPES.PurchaseStore)
    private readonly purchases: PurchaseStore,
    @inject(API_PAYMENTS_TYPES.CheckoutReader)
    private readonly reader: CheckoutReader,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async record(
    session: SessionView,
    purchaseId: string,
  ): Promise<CheckoutView> {
    // 停止の波及処理による決済セッションの失効は非同期のため、その間に停止中の利用者が支払いを確定できないよう同意の記録で拒否する
    const { user } = await this.guard.requireWritableUser(session);
    const purchase = await this.purchases.findById(purchaseId);
    if (!isOwnPurchase(purchase, user.id)) {
      throw paymentsError('checkout_not_found');
    }
    const now = this.clock.now();
    if (!isPayableOpen(purchase, now)) {
      throw paymentsError('checkout_not_open');
    }
    // 読んだ後に反映が購入を進めても、ストアがopenの購入にだけ記録する
    const result = await this.purchases.recordConsent({
      purchaseId: purchase.id,
      userId: user.id,
      consentedAt: now,
      version: CHECKOUT_CONSENT_VERSION,
    });
    if (result === 'not_open') {
      throw paymentsError('checkout_not_open');
    }
    return this.reader.read(session, purchase.id);
  }
}
