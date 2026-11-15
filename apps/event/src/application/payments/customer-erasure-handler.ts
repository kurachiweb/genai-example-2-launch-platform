import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type {
  CustomerStore,
  StripeGateway,
} from '../../../lib/core/payments/ports.ts';
import { EVENT_PAYMENTS_TYPES } from './event-payments-types.ts';
import type { PaymentAccountDataEraser } from './payment-account-data-eraser.ts';

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'payments', 'customer-erasure']);

// Customerの対応の行はStripeの削除の後に消すため、Stripeの一時的な失敗で例外になった再試行でも同じCustomerを削除し直せる。対応の行を消した後の再配信はStripeを呼ばずに終わる
@injectable()
export class CustomerErasureHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(PAYMENTS_TYPES.CustomerStore)
    private readonly customers: CustomerStore,
    @inject(PAYMENTS_TYPES.StripeGateway)
    private readonly gateway: StripeGateway,
    @inject(EVENT_PAYMENTS_TYPES.PaymentAccountDataEraser)
    private readonly eraser: PaymentAccountDataEraser,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const customerId = await this.customers.find(event.userId);
    if (customerId !== undefined) {
      const result = await this.gateway.deleteCustomer(customerId);
      logger.info('物理削除する利用者のStripeのCustomerを削除しました', {
        eventId: event.id,
        userId: event.userId,
        result,
      });
    }
    await this.eraser.erase(event.userId);
    return DONE;
  }
}
