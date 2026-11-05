import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { PAYMENTS_TYPES } from '../../../../lib/core/payments/identifiers.ts';
import type {
  PaymentReflector,
  PurchaseStore,
  StripeGateway,
} from '../../../../lib/core/payments/ports.ts';
import type {
  ScheduledJobContext,
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import { API_PAYMENTS_TYPES } from '../payments-types.ts';
import type { PaymentsJobIncidentReporter } from './payments-job-incidents.ts';
import { reconcilePurchases } from './purchase-reconciliation.ts';

const RECONCILIATION_WINDOW_MS = 24 * 60 * 60 * 1000;

// 週ごとの予選の勝者の数を超えない想定の上限。超えた分は翌日4:21の日次の確認が拾う
export const CHECKOUT_RECONCILIATION_LIMIT = 200;

// 同じ時刻のマッチの確定(23:40)より先に動かすため、23:40の他のジョブはorderを10より大きくする
export const CHECKOUT_RECONCILIATION_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'payments.checkout-reconciliation',
    at: Object.freeze({ hour: 23, minute: 40 }),
    order: 10,
    handler: API_PAYMENTS_TYPES.CheckoutReconciliationJob,
  });

const logger = getAppLogger(['api', 'payments', 'checkout-reconciliation']);

@injectable()
export class CheckoutReconciliationJob implements ScheduledJobHandler {
  constructor(
    @inject(PAYMENTS_TYPES.PurchaseStore)
    private readonly purchases: PurchaseStore,
    @inject(PAYMENTS_TYPES.StripeGateway)
    private readonly gateway: StripeGateway,
    @inject(PAYMENTS_TYPES.PaymentReflector)
    private readonly reflector: PaymentReflector,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
    @inject(API_PAYMENTS_TYPES.PaymentsJobIncidentReporter)
    private readonly incidents: PaymentsJobIncidentReporter,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    // 上限を1件超えて読み、上限を超えたかを知る
    const found = await this.purchases.findReconcilable({
      deadlineFrom: new Date(
        scheduledTime.getTime() - RECONCILIATION_WINDOW_MS,
      ),
      deadlineTo: scheduledTime,
      limit: CHECKOUT_RECONCILIATION_LIMIT + 1,
    });
    const limitReached = found.length > CHECKOUT_RECONCILIATION_LIMIT;
    if (limitReached) {
      logger.warn(
        '突合の対象が上限を超え、超えた分を翌日の日次の確認に残しました',
        { limit: CHECKOUT_RECONCILIATION_LIMIT },
      );
    }
    const tally = await reconcilePurchases(
      {
        job: CHECKOUT_RECONCILIATION_JOB_DEFINITION.name,
        gateway: this.gateway,
        reflector: this.reflector,
        clock: this.clock,
        incidents: this.incidents,
      },
      found.slice(0, CHECKOUT_RECONCILIATION_LIMIT),
    );
    logger.info('決済期限を過ぎた購入を突合しました', {
      ...tally,
      limitReached,
    });
  }
}
