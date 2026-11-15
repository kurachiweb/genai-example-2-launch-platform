import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { AccountGuard } from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import {
  type CustomerDirectory,
  type StripeGateway,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import type { PaymentsEnv } from '../../../lib/core/payments/purchase-kind-contract.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { ULTRAS_TYPES } from '../../../lib/core/ultras/identifiers.ts';
import type { SubscriptionStore } from '../../../lib/core/ultras/ports.ts';
import { paymentsError } from '../payments/payments-errors.ts';
import type { PortalSessionLimits } from './portal-ports.ts';
import { ultrasError } from './ultras-errors.ts';
import { API_ULTRAS_TYPES } from './ultras-types.ts';

// プラン管理画面はこのクエリで、Portalでの操作がWebhookで反映されるまでの反映待ちの表示を出す
export const ULTRAS_PORTAL_RETURN_PATH = '/settings/plan?portal=returned';

export interface PortalSessionStarter {
  // 未ログイン・停止中・退会済みの拒否は利用者の確認が、回数の超過は回数制限がAppErrorで投げる
  start(session: SessionView): Promise<{ readonly url: string }>;
}

@injectable()
export class DefaultPortalSessionStarter implements PortalSessionStarter {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(API_ULTRAS_TYPES.PortalSessionLimits)
    private readonly limits: PortalSessionLimits,
    @inject(ULTRAS_TYPES.SubscriptionStore)
    private readonly subscriptions: SubscriptionStore,
    @inject(PAYMENTS_TYPES.CustomerDirectory)
    private readonly customers: CustomerDirectory,
    @inject(PAYMENTS_TYPES.StripeGateway)
    private readonly gateway: StripeGateway,
    @inject(PLATFORM_TYPES.Env) private readonly env: PaymentsEnv,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async start(session: SessionView): Promise<{ readonly url: string }> {
    const { user } = await this.guard.requireWritableUser(session);
    await this.limits.consume(user.id, this.clock.now());
    const customerId = await this.portalCustomerIdOf(user.id);
    try {
      const { url } = await this.gateway.createPortalSession({
        customerId,
        returnUrl: `${this.env.CLIENT_SITE_ORIGIN}${ULTRAS_PORTAL_RETURN_PATH}`,
      });
      return { url };
    } catch (error: unknown) {
      if (error instanceof StripeUnavailableError) {
        throw paymentsError('payments_unavailable');
      }
      throw error;
    }
  }

  // 他の購入でCustomerだけを持つ利用者にはUltrasの管理する対象が無いため、有効化された加入とCustomerの両方を求める
  private async portalCustomerIdOf(userId: string): Promise<string> {
    const subscription = await this.subscriptions.findLatestActivated(userId);
    const customerId = await this.customers.findCustomerId(userId);
    if (subscription === undefined || customerId === undefined) {
      throw ultrasError('ultras_portal_unavailable');
    }
    return customerId;
  }
}
