import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
} from '../../../lib/core/messaging/message-contract.ts';
import type { RetryPolicy } from '../../../lib/core/messaging/retry-policy.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import {
  type PurchaseRecord,
  type PurchaseStore,
  type RefundRequestRecord,
  type RefundStore,
  type StripeGateway,
  StripeNotFoundError,
  StripeRejectedError,
} from '../../../lib/core/payments/ports.ts';
import type { RefundPaymentBody } from '../../../lib/core/payments/refund-message.ts';
import { toStripeRefundReason } from '../../../lib/core/payments/refund-rules.ts';
import { EVENT_PAYMENTS_TYPES } from './event-payments-types.ts';
import type {
  RefundIncident,
  RefundIncidentReporter,
} from './refund-incidents.ts';

// Stripeの障害が解けるまで待てるよう、既定より長い間隔(60・120・240・480秒)で再試行し、上限に達すればデッドレターの通知で運営者へ知らせる
export const REFUND_PAYMENT_RETRY_POLICY = Object.freeze({
  maxAttempts: 5,
  baseDelaySeconds: 60,
  maxDelaySeconds: 3600,
} as const) satisfies RetryPolicy;

export const MISSING_PAYMENT_INTENT_FAILURE_CODE = 'missing_payment_intent';

// Stripeの対象が無いエラーは拒否のコードを持たないため、Stripeの同じ意味のコードで記録する
const STRIPE_NOT_FOUND_CODE = 'resource_missing';

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const logger = getAppLogger(['event', 'payments', 'refund-payment']);

// 依頼キーは依頼ごとに一意で、同じ依頼の再配信・再送信でもStripeの返金を1回に保てる
export function refundIdempotencyKeyOf(requestKey: string): string {
  return `refund:${requestKey}`;
}

type StripeOperation = Extract<
  RefundIncident,
  { kind: 'stripe-rejected' }
>['operation'];

class PermanentStripeFailure extends Error {
  override readonly name = 'PermanentStripeFailure';
  readonly operation: StripeOperation;
  readonly stripeErrorCode: string;

  constructor(operation: StripeOperation, stripeErrorCode: string) {
    super(`Stripeが返金の処理を拒否しました(${operation}・${stripeErrorCode})`);
    this.operation = operation;
    this.stripeErrorCode = stripeErrorCode;
  }
}

// 一時的な失敗(StripeUnavailableErrorなど)はそのまま投げて再試行させ、再試行で解消しない拒否だけを恒久的な失敗に変える
async function classifyStripe<T>(
  operation: StripeOperation,
  call: () => Promise<T>,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof StripeRejectedError) {
      throw new PermanentStripeFailure(operation, error.stripeErrorCode);
    }
    if (error instanceof StripeNotFoundError) {
      throw new PermanentStripeFailure(operation, STRIPE_NOT_FOUND_CODE);
    }
    throw error;
  }
}

@injectable()
export class RefundPaymentHandler implements MessageHandler<RefundPaymentBody> {
  constructor(
    @inject(PAYMENTS_TYPES.RefundStore)
    private readonly refunds: RefundStore,
    @inject(PAYMENTS_TYPES.PurchaseStore)
    private readonly purchases: PurchaseStore,
    @inject(PAYMENTS_TYPES.StripeGateway)
    private readonly gateway: StripeGateway,
    @inject(EVENT_PAYMENTS_TYPES.RefundIncidentReporter)
    private readonly incidents: RefundIncidentReporter,
  ) {}

  async handle(body: RefundPaymentBody): Promise<MessageHandlingResult> {
    const { refundRequestId } = body;
    const request = await this.refunds.findById(refundRequestId);
    if (request === undefined) {
      // 物理削除で依頼の行が消えた後にも届き得るため、失敗にせず終える
      logger.warn('存在しない返金の依頼のメッセージを受け取りました', {
        refundRequestId,
      });
      return DONE;
    }
    // 提出済み・成功の後に届いた重複の配信や、失敗を記録した後の再配信では、Stripeを呼び直さない
    if (request.status !== 'requested') {
      logger.info('返金の依頼は処理済みです', {
        refundRequestId,
        status: request.status,
      });
      return DONE;
    }
    const purchase = await this.purchases.findById(request.purchaseId);
    const paymentIntentId = purchase?.stripePaymentIntentId ?? null;
    if (purchase === undefined || paymentIntentId === null) {
      await this.fail(request, MISSING_PAYMENT_INTENT_FAILURE_CODE, {
        kind: 'missing-payment-intent',
        refundRequestId,
      });
      return DONE;
    }
    try {
      await this.cancelRejectedSubscription(purchase);
      await this.createRefund(request, paymentIntentId);
    } catch (error) {
      if (!(error instanceof PermanentStripeFailure)) {
        throw error;
      }
      await this.fail(request, error.stripeErrorCode, {
        kind: 'stripe-rejected',
        refundRequestId,
        operation: error.operation,
        stripeErrorCode: error.stripeErrorCode,
      });
    }
    return DONE;
  }

  // 拒否した定期課金の購入は次の請求で再び課金されないよう、返金の前に即時に解約する
  private async cancelRejectedSubscription(
    purchase: PurchaseRecord,
  ): Promise<void> {
    const subscriptionId = purchase.stripeSubscriptionId;
    if (purchase.status !== 'rejected' || subscriptionId === null) {
      return;
    }
    const result = await classifyStripe('cancel_subscription', () =>
      this.gateway.cancelSubscription(subscriptionId, { atPeriodEnd: false }),
    );
    logger.info('拒否した購入の定期課金を解約しました', {
      purchaseId: purchase.id,
      subscriptionId,
      result,
    });
  }

  private async createRefund(
    request: RefundRequestRecord,
    paymentIntentId: string,
  ): Promise<void> {
    const refund = await classifyStripe('create_refund', () =>
      this.gateway.createRefund({
        paymentIntentId,
        amount: request.amount,
        reason: toStripeRefundReason(request.reason),
        refundRequestId: request.id,
        purchaseId: request.purchaseId,
        idempotencyKey: refundIdempotencyKeyOf(request.requestKey),
      }),
    );
    // Stripeの返金の通知の反映が先に依頼を進めていれば、その状態を提出済みへ戻さない
    const submitted = await this.refunds.updateStatus({
      refundRequestId: request.id,
      status: 'submitted',
      stripeRefundId: refund.id,
      from: ['requested'],
    });
    logger.info('返金を作成しました', {
      refundRequestId: request.id,
      purchaseId: request.purchaseId,
      stripeRefundId: refund.id,
      recorded: submitted,
    });
  }

  private async fail(
    request: RefundRequestRecord,
    failureCode: string,
    incident: RefundIncident,
  ): Promise<void> {
    const recorded = await this.refunds.updateStatus({
      refundRequestId: request.id,
      status: 'failed',
      failureCode,
      from: ['requested'],
    });
    // 並行して届いた同じメッセージが先に記録したときは、重ねて知らせない
    if (recorded) {
      this.incidents.report(incident);
    }
  }
}
