import type { Logger } from '@logtape/logtape';
import type { BatchItem } from 'drizzle-orm/batch';

import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import type {
  PurchaseStatus,
  RejectionReason,
} from '../../../common-lib/payments/purchase-states.ts';
import type { Database } from '../../../db/client.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type {
  PaymentRefunds,
  PurchaseRecord,
  PurchaseStore,
  RefundRequestInput,
  RefundRequestResult,
  RefundStore,
} from '../../core/payments/ports.ts';
import { PAYMENTS_REFUND_MESSAGE } from '../../core/payments/refund-message.ts';
import {
  isAcceptableRequestKey,
  isRefundReason,
  reflectionRequestKeyOf,
  validateRefundAmount,
} from '../../core/payments/refund-rules.ts';
import type { Clock } from '../../core/time/clock.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  type MessagePublisher,
  MessagePublishError,
} from '../messaging/queue-publisher.ts';
import type {
  PaymentRefundStatements,
  RefundStatements,
} from './statement-contracts.ts';

export interface D1PaymentRefundsDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly db: Database;
  readonly purchases: PurchaseStore;
  readonly refunds: RefundStore;
  readonly refundStatements: RefundStatements;
  readonly publisher: MessagePublisher;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

type PreparedRefund = Awaited<ReturnType<PaymentRefundStatements['prepare']>>;

type RefundRejection = Extract<RefundRequestResult, { kind: 'rejected' }>;

// 反映の前進の文がPaymentIntentのIDと支払額を保存する状態
const PAID_STATUSES: readonly PurchaseStatus[] = ['fulfilled', 'rejected'];

function isPaid(purchase: PurchaseRecord): boolean {
  return (
    PAID_STATUSES.includes(purchase.status) &&
    purchase.stripePaymentIntentId !== null
  );
}

export class D1PaymentRefunds
  implements PaymentRefunds, PaymentRefundStatements
{
  private readonly db: Database;
  private readonly purchases: PurchaseStore;
  private readonly refunds: RefundStore;
  private readonly refundStatements: RefundStatements;
  private readonly publisher: MessagePublisher;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(dependencies: D1PaymentRefundsDependencies) {
    this.db = dependencies.db;
    this.purchases = dependencies.purchases;
    this.refunds = dependencies.refunds;
    this.refundStatements = dependencies.refundStatements;
    this.publisher = dependencies.publisher;
    this.ids = dependencies.ids;
    this.clock = dependencies.clock;
    this.logger = getAppLogger([dependencies.appName, 'payments', 'refunds']);
  }

  async request(input: RefundRequestInput): Promise<RefundRequestResult> {
    const prepared = await this.prepare(input);
    if (prepared.kind === 'rejected') {
      return prepared;
    }
    const { refundRequestId, duplicate } = prepared.duplicate
      ? prepared
      : await this.commit(prepared.refundRequestId, prepared.statements, input);
    // 既存の依頼でも、前回の送信が失敗していれば送り直す
    await this.dispatch(refundRequestId);
    return { kind: 'accepted', refundRequestId, duplicate };
  }

  async dispatch(refundRequestId: string): Promise<void> {
    const refund = await this.refunds.findById(refundRequestId);
    if (refund === undefined) {
      this.logger.warn('存在しない返金の依頼は送りませんでした', {
        refundRequestId,
      });
      return;
    }
    if (refund.dispatchedAt !== null) {
      return;
    }
    let stage: 'publish' | 'mark_dispatched' = 'publish';
    try {
      await this.publisher.publish(PAYMENTS_REFUND_MESSAGE, {
        refundRequestId,
      });
      stage = 'mark_dispatched';
      await this.refunds.markDispatched(refundRequestId, this.clock.now());
    } catch (error) {
      if (error instanceof MessagePublishError) {
        throw error;
      }
      // 送信の日時が空の依頼は日次の確認が送り直す。送信の後の記録の失敗では同じ依頼が2回送られ得るが、返金の処理はStripeの冪等キーで冪等
      this.logger.warn(
        stage === 'publish'
          ? '返金の依頼を送れませんでした'
          : '返金の依頼の送信の日時を記録できませんでした',
        { error, refundRequestId, stage },
      );
    }
  }

  async prepare(input: RefundRequestInput): Promise<PreparedRefund> {
    // 既存のreflection:の依頼を重複として返さないよう、形式の検査を依頼キーの照会より先に行う
    if (!isAcceptableRequestKey(input.requestKey)) {
      return { kind: 'rejected', code: 'invalid_request_key' };
    }
    if (!isRefundReason(input.reason)) {
      throw new RangeError(
        `返金の理由は小文字・数字・_の1〜64文字で指定してください: ${JSON.stringify(input.reason)}`,
      );
    }
    // 既存の依頼の金額は残りの額に数えられるため、金額の検証より先に照会し、2回目を超過として拒否しない
    const existing = await this.refunds.findByRequestKey(input.requestKey);
    if (existing !== undefined) {
      return {
        kind: 'accepted',
        refundRequestId: existing.id,
        duplicate: true,
        statements: [],
      };
    }
    const amount = await this.validate(input);
    if (typeof amount !== 'number') {
      return amount;
    }
    const refundRequestId = this.ids.generate();
    return {
      kind: 'accepted',
      refundRequestId,
      duplicate: false,
      statements: [
        this.refundStatements.insert({
          id: refundRequestId,
          purchaseId: input.purchaseId,
          requestKey: input.requestKey,
          amount,
          reason: input.reason,
          noticeStatus: 'none',
        }),
      ],
    };
  }

  prepareForReflection(input: {
    readonly purchaseId: string;
    readonly amountPaid: MinorUnitAmount;
    readonly reason: RejectionReason;
    readonly requestKey: string;
  }): {
    readonly refundRequestId: string;
    readonly statements: readonly BatchItem<'sqlite'>[];
  } {
    if (input.requestKey !== reflectionRequestKeyOf(input.purchaseId)) {
      throw new RangeError(
        `反映の返金の依頼キーは${reflectionRequestKeyOf(input.purchaseId)}で指定してください: ${JSON.stringify(input.requestKey)}`,
      );
    }
    const refundRequestId = this.ids.generate();
    return {
      refundRequestId,
      statements: [
        this.refundStatements.insert({
          id: refundRequestId,
          purchaseId: input.purchaseId,
          requestKey: input.requestKey,
          amount: input.amountPaid,
          reason: input.reason,
          noticeStatus: 'pending',
        }),
      ],
    };
  }

  private async validate(
    input: RefundRequestInput,
  ): Promise<MinorUnitAmount | RefundRejection> {
    const purchase = await this.purchases.findById(input.purchaseId);
    if (purchase === undefined) {
      return { kind: 'rejected', code: 'purchase_not_found' };
    }
    if (!isPaid(purchase)) {
      return { kind: 'rejected', code: 'not_paid' };
    }
    const validation = validateRefundAmount({
      requested: input.amount,
      paid: purchase.amountTotal,
      alreadyRequested: await this.refunds.sumRequested(input.purchaseId),
    });
    return validation.kind === 'ok'
      ? validation.amount
      : { kind: 'rejected', code: validation.code };
  }

  private async commit(
    refundRequestId: string,
    statements: readonly BatchItem<'sqlite'>[],
    input: RefundRequestInput,
  ): Promise<{
    readonly refundRequestId: string;
    readonly duplicate: boolean;
  }> {
    const [first, ...rest] = statements;
    if (first === undefined) {
      return { refundRequestId, duplicate: false };
    }
    try {
      await this.db.batch([first, ...rest]);
      return { refundRequestId, duplicate: false };
    } catch (error) {
      // 同じ依頼キーの依頼が先に確定していれば、一意制約の違反をその依頼の重複として返す
      const existing = await this.refunds.findByRequestKey(input.requestKey);
      if (existing === undefined) {
        throw error;
      }
      return { refundRequestId: existing.id, duplicate: true };
    }
  }
}
