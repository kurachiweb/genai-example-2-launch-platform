import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { PAYMENTS_TYPES } from '../../../../lib/core/payments/identifiers.ts';
import type {
  NoticeOutcome,
  PaymentReflector,
  PaymentRefunds,
  PurchaseNotifier,
  PurchaseStore,
  RefundStore,
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
import {
  reconcilePurchases,
  type ReconciliationTally,
} from './purchase-reconciliation.ts';

const MINUTE_MS = 60_000;

// 決済セッションの有効期限の直後はStripeの通知が届く途中のため、1時間待ってから突合する
const STALE_AFTER_MS = 60 * MINUTE_MS;

// 依頼の直後の送信・メールの依頼は呼び出し元が続けて行うため、10分待ってから送り直す
const PENDING_AFTER_MS = 10 * MINUTE_MS;

// Workersの実時間に収めるため1回の起動で扱う件数を区切り、残りは翌日の起動に任せる
export const STALE_CHECKOUT_LIMIT = 200;

export const UNDISPATCHED_REFUND_LIMIT = 100;

// 購入確認メールと自動返金の通知のそれぞれの上限
export const PENDING_NOTICE_LIMIT = 100;

export const PENDING_CHECKOUT_SWEEP_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'payments.pending-checkout-sweep',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 400,
    handler: API_PAYMENTS_TYPES.PendingCheckoutSweepJob,
  });

const JOB = PENDING_CHECKOUT_SWEEP_JOB_DEFINITION.name;

const logger = getAppLogger(['api', 'payments', 'pending-checkout-sweep']);

interface NoticeRequests {
  readonly requested: number;
  // 依頼できず依頼待ちのまま残ったID
  readonly unrequested: readonly string[];
}

async function requestEach(
  ids: readonly string[],
  notify: (id: string) => Promise<NoticeOutcome>,
): Promise<NoticeRequests> {
  let requested = 0;
  const unrequested: string[] = [];
  for (const id of ids) {
    try {
      const outcome = await notify(id);
      if (outcome === 'requested') {
        requested += 1;
      } else if (outcome === 'failed') {
        unrequested.push(id);
      }
    } catch (error: unknown) {
      logger.warn('依頼待ちのメールを依頼できませんでした', { id, error });
      unrequested.push(id);
    }
  }
  return { requested, unrequested };
}

interface RefundTally {
  readonly targets: number;
  readonly failed: number;
}

interface NoticeTally {
  readonly targets: number;
  readonly requested: number;
  readonly failed: number;
}

@injectable()
export class PendingCheckoutSweepJob implements ScheduledJobHandler {
  constructor(
    @inject(PAYMENTS_TYPES.PurchaseStore)
    private readonly purchases: PurchaseStore,
    @inject(PAYMENTS_TYPES.RefundStore)
    private readonly refundStore: RefundStore,
    @inject(PAYMENTS_TYPES.StripeGateway)
    private readonly gateway: StripeGateway,
    @inject(PAYMENTS_TYPES.PaymentReflector)
    private readonly reflector: PaymentReflector,
    @inject(PAYMENTS_TYPES.PaymentRefunds)
    private readonly refunds: PaymentRefunds,
    @inject(PAYMENTS_TYPES.PurchaseNotifier)
    private readonly notifier: PurchaseNotifier,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
    @inject(API_PAYMENTS_TYPES.PaymentsJobIncidentReporter)
    private readonly incidents: PaymentsJobIncidentReporter,
  ) {}

  async run({ scheduledTime }: ScheduledJobContext): Promise<void> {
    const pendingBefore = new Date(scheduledTime.getTime() - PENDING_AFTER_MS);
    const reconciliation = await this.reconcileStale(scheduledTime);
    const refunds = await this.redispatchRefunds(pendingBefore);
    const notices = await this.requestNotices(pendingBefore);
    logger.info('未完了の購入と依頼待ちの返金・メールを確認しました', {
      reconciliation,
      refunds,
      notices,
    });
  }

  private async reconcileStale(
    scheduledTime: Date,
  ): Promise<ReconciliationTally> {
    const stale = await this.purchases.findStaleOpen({
      expiredBefore: new Date(scheduledTime.getTime() - STALE_AFTER_MS),
      limit: STALE_CHECKOUT_LIMIT,
    });
    return reconcilePurchases(
      {
        job: JOB,
        gateway: this.gateway,
        reflector: this.reflector,
        clock: this.clock,
        incidents: this.incidents,
      },
      stale,
    );
  }

  // 送信済みの依頼は送り直さないため、同じ依頼を2回送らない
  private async redispatchRefunds(createdBefore: Date): Promise<RefundTally> {
    const undispatched = await this.refundStore.findUndispatched({
      createdBefore,
      limit: UNDISPATCHED_REFUND_LIMIT,
    });
    let failed = 0;
    for (const { id } of undispatched) {
      try {
        await this.refunds.dispatch(id);
      } catch (error: unknown) {
        failed += 1;
        this.incidents.report({
          kind: 'refund-dispatch-failed',
          job: JOB,
          refundRequestId: id,
          error,
        });
      }
    }
    return { targets: undispatched.length, failed };
  }

  // 依頼待ちの行だけを依頼するため、依頼を記録したメールを再び依頼しない
  private async requestNotices(pendingBefore: Date): Promise<NoticeTally> {
    const confirmations = await this.purchases.findPendingConfirmations({
      reflectedBefore: pendingBefore,
      limit: PENDING_NOTICE_LIMIT,
    });
    const refundNotices = await this.refundStore.findPendingNotices({
      updatedBefore: pendingBefore,
      limit: PENDING_NOTICE_LIMIT,
    });
    const purchaseResults = await requestEach(
      confirmations.map(({ id }) => id),
      (purchaseId) => this.notifier.notifyPurchase(purchaseId),
    );
    const refundResults = await requestEach(
      refundNotices.map(({ id }) => id),
      (refundRequestId) => this.notifier.notifyAutomaticRefund(refundRequestId),
    );
    const failed =
      purchaseResults.unrequested.length + refundResults.unrequested.length;
    if (failed > 0) {
      this.incidents.report({
        kind: 'notice-request-failed',
        job: JOB,
        purchaseIds: purchaseResults.unrequested,
        refundRequestIds: refundResults.unrequested,
      });
    }
    return {
      targets: confirmations.length + refundNotices.length,
      requested: purchaseResults.requested + refundResults.requested,
      failed,
    };
  }
}
