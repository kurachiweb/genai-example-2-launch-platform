import { inject, injectable } from 'inversify';

import { checkCheckoutSessionId } from '../../../common-lib/payments/payment-input-rules.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import {
  type PaymentReflector,
  type PurchaseStore,
  type StripeGateway,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  type CheckoutSessionLookup,
  type CheckoutView,
  checkoutViewOf,
  isOwnPurchase,
} from './checkout-view.ts';
import {
  checkoutSessionIdRejectedError,
  paymentsError,
} from './payments-errors.ts';

export interface CheckoutReturnResult {
  readonly checkout: CheckoutView;
}

export interface CheckoutReturnConfirmer {
  // 他人・存在しない決済セッションはcheckout_not_found。Stripeに到達できなければ未完了の購入を処理中として返す
  confirm(
    session: SessionView,
    sessionId: string,
  ): Promise<CheckoutReturnResult>;
}

@injectable()
export class StripeCheckoutReturnConfirmer implements CheckoutReturnConfirmer {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(PAYMENTS_TYPES.PurchaseStore)
    private readonly purchases: PurchaseStore,
    @inject(PAYMENTS_TYPES.StripeGateway)
    private readonly gateway: StripeGateway,
    @inject(PAYMENTS_TYPES.PaymentReflector)
    private readonly reflector: PaymentReflector,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async confirm(
    session: SessionView,
    sessionId: string,
  ): Promise<CheckoutReturnResult> {
    const { user } = await this.guard.requireUser(session);
    const issue = checkCheckoutSessionId(sessionId);
    if (issue !== undefined) {
      throw checkoutSessionIdRejectedError(issue);
    }
    const found = await this.purchases.findBySessionId(sessionId);
    if (!isOwnPurchase(found, user.id)) {
      throw paymentsError('checkout_not_found');
    }
    const lookup = await this.reflect(sessionId);
    const purchase = await this.purchases.findById(found.id);
    if (purchase === undefined) {
      throw paymentsError('checkout_not_found');
    }
    return {
      checkout: checkoutViewOf({
        purchase,
        now: this.clock.now(),
        lookup,
        whenUnreachable: 'processing',
      }),
    };
  }

  // 反映は冪等なため、同じ決済セッションを何度確かめても記録と権利の付与は1回だけになる
  private async reflect(sessionId: string): Promise<CheckoutSessionLookup> {
    try {
      const snapshot = await this.gateway.retrieveCheckoutSession(sessionId);
      await this.reflector.reflectCheckoutSnapshot(snapshot, this.clock.now());
      return { kind: 'retrieved', snapshot };
    } catch (error: unknown) {
      if (error instanceof StripeUnavailableError) {
        return { kind: 'unreachable' };
      }
      throw error;
    }
  }
}
