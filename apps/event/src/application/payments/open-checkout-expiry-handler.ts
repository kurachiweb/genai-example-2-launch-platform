import { inject, injectable } from 'inversify';

import type {
  LifecycleHandlerOutcome,
  UserLifecycleAsyncHandler,
  UserLifecycleEvent,
} from '../../../lib/core/identity/user-lifecycle.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import type { OpenCheckoutExpirer } from '../../../lib/core/payments/ports.ts';

export const OPEN_CHECKOUT_EXPIRY_LIMIT = 50;

const DONE: LifecycleHandlerOutcome = Object.freeze({ kind: 'done' });

const CONTINUE: LifecycleHandlerOutcome = Object.freeze({ kind: 'continue' });

// 失効の部品が残りの未完了の購入を毎回D1から選び直すため、再試行・送り直し・続きの再開で同じイベントを何度処理しても結果が変わらない
@injectable()
export class OpenCheckoutExpiryHandler implements UserLifecycleAsyncHandler {
  constructor(
    @inject(PAYMENTS_TYPES.OpenCheckoutExpirer)
    private readonly expirer: OpenCheckoutExpirer,
  ) {}

  async handle(event: UserLifecycleEvent): Promise<LifecycleHandlerOutcome> {
    const { remaining } = await this.expirer.expireOpen({
      userId: event.userId,
      kinds: 'all',
      limit: OPEN_CHECKOUT_EXPIRY_LIMIT,
    });
    return remaining ? CONTINUE : DONE;
  }
}
