import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import {
  type PurchaseRecord,
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
  isPayableOpen,
} from './checkout-view.ts';
import { paymentsError } from './payments-errors.ts';

export interface CheckoutReader {
  // 他人・存在しない購入はAppError(not_found, checkout_not_found)
  read(session: SessionView, purchaseId: string): Promise<CheckoutView>;
}

@injectable()
export class StripeCheckoutReader implements CheckoutReader {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(PAYMENTS_TYPES.PurchaseStore)
    private readonly purchases: PurchaseStore,
    @inject(PAYMENTS_TYPES.StripeGateway)
    private readonly gateway: StripeGateway,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async read(session: SessionView, purchaseId: string): Promise<CheckoutView> {
    const { user } = await this.guard.requireUser(session);
    const purchase = await this.purchases.findById(purchaseId);
    if (!isOwnPurchase(purchase, user.id)) {
      throw paymentsError('checkout_not_found');
    }
    const now = this.clock.now();
    const lookup = isPayableOpen(purchase, now)
      ? await this.lookUpSession(purchase)
      : ({ kind: 'missing' } as const);
    return checkoutViewOf({
      purchase,
      now,
      lookup,
      whenUnreachable: 'unavailable',
    });
  }

  private async lookUpSession(
    purchase: PurchaseRecord,
  ): Promise<CheckoutSessionLookup> {
    if (purchase.stripeCheckoutSessionId === null) {
      return { kind: 'missing' };
    }
    try {
      const snapshot = await this.gateway.retrieveCheckoutSession(
        purchase.stripeCheckoutSessionId,
      );
      return { kind: 'retrieved', snapshot };
    } catch (error: unknown) {
      if (error instanceof StripeUnavailableError) {
        return { kind: 'unreachable' };
      }
      throw error;
    }
  }
}
