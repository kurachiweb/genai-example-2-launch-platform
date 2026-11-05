import type { Logger } from '@logtape/logtape';
import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import { PURCHASE_KIND_MODES } from '../../../common-lib/payments/purchase-kinds.ts';
import type {
  PurchaseStatus,
  RejectionReason,
} from '../../../common-lib/payments/purchase-states.ts';
import type { Database } from '../../../db/client.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  type NewPaymentRecord,
  type PaymentRefunds,
  type PurchaseNotifier,
  type PurchasePatch,
  type PurchaseRecord,
  type PurchaseStore,
  type ReflectionOutcome,
  type StripeCheckoutSessionSnapshot,
  type StripeGateway,
  StripeNotFoundError,
} from '../../core/payments/ports.ts';
import type {
  FulfillablePurchase,
  PaymentsEnv,
  PurchaseKindRegistry,
} from '../../core/payments/purchase-kind-contract.ts';
import {
  ADVANCEABLE_FROM,
  decideCompletion,
  type PurchaseAdvanceTarget,
} from '../../core/payments/purchase-rules.ts';
import { reflectionRequestKeyOf } from '../../core/payments/refund-rules.ts';
import type { Clock } from '../../core/time/clock.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type {
  PurchaseFulfillment,
  PurchaseKindRegistration,
} from './fulfillment-contract.ts';
import type {
  GuardedBatch,
  GuardedStatement,
  PaymentRecordStatements,
  PaymentRefundStatements,
  PurchaseStatements,
} from './statement-contracts.ts';

// 決済セッションの反映。反映の処理(PaymentReflector)が、Webhook・return_url・突合・日次の確認の入口から委ねる
export interface CheckoutSessionReflection {
  // Stripeから決済セッションを取得して反映する。Stripeの一時的な失敗は例外
  reflectSession(
    sessionId: string,
    occurredAt: Date,
  ): Promise<ReflectionOutcome>;
  // 取得済みの決済セッションを反映する。D1の一時的な失敗は例外で、部分的な書き込みを残さない
  reflectSnapshot(
    snapshot: StripeCheckoutSessionSnapshot,
    occurredAt: Date,
  ): Promise<ReflectionOutcome>;
}

export interface StripeCheckoutSessionReflectionDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly db: Database;
  readonly env: PaymentsEnv;
  readonly gateway: StripeGateway;
  readonly purchases: PurchaseStore;
  readonly purchaseStatements: PurchaseStatements;
  readonly recordStatements: PaymentRecordStatements;
  readonly guardedBatch: GuardedBatch;
  readonly registry: PurchaseKindRegistry<PurchaseKindRegistration>;
  readonly resolveFulfillment: (
    identifier: ServiceIdentifier<PurchaseFulfillment>,
  ) => PurchaseFulfillment;
  readonly refunds: PaymentRefunds;
  readonly refundStatements: PaymentRefundStatements;
  readonly notifier: PurchaseNotifier;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

// 支払いの確定を反映した購入は、他の入口が戻せない
const COMPLETED_STATUSES: readonly PurchaseStatus[] = [
  'fulfilled',
  'rejected',
  'expired',
];

// 決済セッションは支払いが失敗しても完了・未払いのままのため、PaymentIntentの状態で失敗(async_payment_failed)を見分ける
const FAILED_PAYMENT_INTENT_STATUSES: readonly string[] = [
  'requires_payment_method',
  'canceled',
];

// 権利の付与の文が制約に違反したら、口の状態の変化を拾うため1回だけ呼び直す
const MAX_FULFILLMENT_ATTEMPTS = 2;

type AfterCommitStage = 'purchase_notice' | 'refund_dispatch' | 'after_commit';

const AFTER_COMMIT_FAILURE_MESSAGES: Readonly<
  Record<AfterCommitStage, string>
> = {
  purchase_notice:
    '購入確認メールを依頼できませんでした。依頼待ちは日次の確認が依頼し直します',
  refund_dispatch:
    '返金の依頼を送れませんでした。送信待ちは日次の確認が送り直します',
  after_commit: '購入種別の確定後の処理が失敗しました。反映の結果は変えません',
};

// 支払いが確定した決済セッションの反映で、拒否と権利の付与が共有する値
interface PaidReflection {
  readonly purchase: PurchaseRecord;
  readonly snapshot: StripeCheckoutSessionSnapshot;
  readonly occurredAt: Date;
  readonly paidAt: Date;
  readonly amountPaid: MinorUnitAmount;
  readonly record: NewPaymentRecord;
}

function applied(purchaseStatus: PurchaseStatus): ReflectionOutcome {
  return { kind: 'applied', purchaseStatus };
}

function paymentPatchOf(
  snapshot: StripeCheckoutSessionSnapshot,
  amountTotal: MinorUnitAmount,
): PurchasePatch {
  return {
    stripePaymentIntentId: snapshot.paymentIntentId,
    stripeInvoiceId: snapshot.invoiceId,
    stripeSubscriptionId: snapshot.subscriptionId,
    amountTotal,
  };
}

export class StripeCheckoutSessionReflection implements CheckoutSessionReflection {
  private readonly db: Database;
  private readonly env: PaymentsEnv;
  private readonly gateway: StripeGateway;
  private readonly purchases: PurchaseStore;
  private readonly purchaseStatements: PurchaseStatements;
  private readonly recordStatements: PaymentRecordStatements;
  private readonly guardedBatch: GuardedBatch;
  private readonly registry: PurchaseKindRegistry<PurchaseKindRegistration>;
  private readonly resolveFulfillment: StripeCheckoutSessionReflectionDependencies['resolveFulfillment'];
  private readonly refunds: PaymentRefunds;
  private readonly refundStatements: PaymentRefundStatements;
  private readonly notifier: PurchaseNotifier;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(dependencies: StripeCheckoutSessionReflectionDependencies) {
    this.db = dependencies.db;
    this.env = dependencies.env;
    this.gateway = dependencies.gateway;
    this.purchases = dependencies.purchases;
    this.purchaseStatements = dependencies.purchaseStatements;
    this.recordStatements = dependencies.recordStatements;
    this.guardedBatch = dependencies.guardedBatch;
    this.registry = dependencies.registry;
    this.resolveFulfillment = dependencies.resolveFulfillment;
    this.refunds = dependencies.refunds;
    this.refundStatements = dependencies.refundStatements;
    this.notifier = dependencies.notifier;
    this.ids = dependencies.ids;
    this.clock = dependencies.clock;
    this.logger = getAppLogger([
      dependencies.appName,
      'payments',
      'reflection',
    ]);
  }

  async reflectSession(
    sessionId: string,
    occurredAt: Date,
  ): Promise<ReflectionOutcome> {
    let snapshot: StripeCheckoutSessionSnapshot;
    try {
      snapshot = await this.gateway.retrieveCheckoutSession(sessionId);
    } catch (error) {
      if (error instanceof StripeNotFoundError) {
        return this.unresolved(sessionId);
      }
      throw error;
    }
    return this.reflectSnapshot(snapshot, occurredAt);
  }

  async reflectSnapshot(
    snapshot: StripeCheckoutSessionSnapshot,
    occurredAt: Date,
  ): Promise<ReflectionOutcome> {
    const purchase = await this.findPurchase(snapshot);
    if (purchase === undefined) {
      return this.unresolved(snapshot.id);
    }
    if (
      COMPLETED_STATUSES.includes(purchase.status) ||
      snapshot.status === 'open'
    ) {
      return { kind: 'already_applied', purchaseStatus: purchase.status };
    }
    if (snapshot.status === 'expired') {
      return this.advanceAlone(purchase, 'expired', {
        lastEventAt: occurredAt,
      });
    }
    if (
      snapshot.paymentStatus === 'unpaid' &&
      snapshot.paymentIntentStatus !== null &&
      FAILED_PAYMENT_INTENT_STATUSES.includes(snapshot.paymentIntentStatus)
    ) {
      return this.advanceAlone(purchase, 'expired', {
        lastEventAt: occurredAt,
      });
    }
    if (snapshot.paymentStatus === 'unpaid') {
      return this.advanceAlone(purchase, 'processing', {
        ...paymentPatchOf(
          snapshot,
          snapshot.amountTotal ?? purchase.amountTotal,
        ),
        lastEventAt: occurredAt,
      });
    }
    return this.reflectPaid(
      this.paidReflectionOf(purchase, snapshot, occurredAt),
    );
  }

  // 決済セッションIDの保存より前に届いた通知は、作成時に付けたメタデータの購入IDで探す
  private async findPurchase(
    snapshot: StripeCheckoutSessionSnapshot,
  ): Promise<PurchaseRecord | undefined> {
    const bySession = await this.purchases.findBySessionId(snapshot.id);
    if (bySession !== undefined) {
      return bySession;
    }
    const purchaseId = snapshot.metadata.purchase_id;
    if (purchaseId === undefined || purchaseId === '') {
      return undefined;
    }
    const byMetadata = await this.purchases.findById(purchaseId);
    return byMetadata?.stripeCheckoutSessionId === null
      ? byMetadata
      : undefined;
  }

  private unresolved(sessionId: string): ReflectionOutcome {
    this.logger.warn(
      '本サービスの購入に結び付かない決済セッションを反映しませんでした',
      { sessionId },
    );
    return { kind: 'unresolved' };
  }

  private async current(purchaseId: string): Promise<ReflectionOutcome> {
    const purchase = await this.purchases.findById(purchaseId);
    return purchase === undefined
      ? { kind: 'already_applied' }
      : { kind: 'already_applied', purchaseStatus: purchase.status };
  }

  // 他の文を伴わない前進は版の検査を使わず、前進の元の状態を条件にする
  private async advanceAlone(
    purchase: PurchaseRecord,
    to: 'processing' | 'expired',
    patch: PurchasePatch,
  ): Promise<ReflectionOutcome> {
    const advanced = await this.purchases.advanceAlone({
      purchaseId: purchase.id,
      to,
      from: ADVANCEABLE_FROM[to],
      nextToken: this.ids.generate(),
      patch,
    });
    return advanced ? applied(to) : this.current(purchase.id);
  }

  private paidReflectionOf(
    purchase: PurchaseRecord,
    snapshot: StripeCheckoutSessionSnapshot,
    occurredAt: Date,
  ): PaidReflection {
    const paidAt = this.clock.now();
    const amountPaid = snapshot.amountTotal ?? purchase.amountTotal;
    const pseudonymousId = snapshot.metadata.pseudonymous_id;
    if (pseudonymousId === undefined || pseudonymousId === '') {
      throw new TypeError(
        `決済セッション${snapshot.id}のメタデータに仮名化IDがありません`,
      );
    }
    const isSubscription =
      PURCHASE_KIND_MODES[purchase.kind] === 'subscription';
    if (isSubscription && snapshot.invoiceId === null) {
      throw new TypeError(
        `定期課金の決済セッション${snapshot.id}に初回の請求がありません`,
      );
    }
    return {
      purchase,
      snapshot,
      occurredAt,
      paidAt,
      amountPaid,
      record: {
        id: this.ids.generate(),
        pseudonymousId,
        kind: isSubscription ? 'subscription' : 'one_time',
        purpose: purchase.kind,
        status: 'succeeded',
        amount: amountPaid,
        currency: 'usd',
        quantity: purchase.quantity,
        stripeReference:
          (isSubscription ? snapshot.invoiceId : null) ?? snapshot.id,
        relatedId: purchase.relatedId,
        purchaseId: purchase.id,
        consentedAt: purchase.consentedAt,
        consentVersion: purchase.consentVersion,
        linkFundingSourceGroup: snapshot.linkFundingSourceGroup,
        occurredAt,
        lastEventAt: occurredAt,
        recordedAt: paidAt,
      },
    };
  }

  private async reflectPaid(
    reflection: PaidReflection,
  ): Promise<ReflectionOutcome> {
    const { purchase } = reflection;
    const completion = decideCompletion({
      paidAt: reflection.paidAt,
      fulfillableUntil: purchase.fulfillableUntil,
    });
    if (completion.kind === 'reject') {
      return this.reject(reflection, completion.reason);
    }
    const fulfillment = this.fulfillmentOf(purchase);
    if (fulfillment === undefined) {
      return this.reject(reflection, 'ineligible');
    }
    const fulfillable = this.fulfillableOf(reflection);
    for (let attempt = 1; attempt <= MAX_FULFILLMENT_ATTEMPTS; attempt += 1) {
      const plan = await fulfillment.prepare(fulfillable, this.db);
      if (plan.kind === 'reject') {
        return this.reject(reflection, plan.reason);
      }
      const result = await this.commit(reflection, 'fulfilled', {
        patch: { confirmationEmailStatus: 'pending' },
        statements: plan.statements,
      });
      if (result === 'committed') {
        await this.afterFulfilled(purchase, fulfillment, fulfillable);
        return applied('fulfilled');
      }
      if (result === 'guard_failed') {
        return this.current(purchase.id);
      }
      if (await this.isDuplicate(purchase)) {
        return this.reject(reflection, 'duplicate');
      }
    }
    return this.reject(reflection, 'ineligible');
  }

  private fulfillmentOf(
    purchase: PurchaseRecord,
  ): PurchaseFulfillment | undefined {
    const registration = this.registry.resolve(purchase.kind, this.env);
    return registration === undefined
      ? undefined
      : this.resolveFulfillment(registration.fulfillment);
  }

  private fulfillableOf(reflection: PaidReflection): FulfillablePurchase {
    const { purchase } = reflection;
    return {
      purchaseId: purchase.id,
      userId: purchase.userId,
      kind: purchase.kind,
      targetId: purchase.targetId,
      relatedId: purchase.relatedId,
      quantity: purchase.quantity,
      amountTotal: reflection.amountPaid,
      paymentRecordId: reflection.record.id,
      paidAt: reflection.paidAt,
      stripeSubscriptionId: reflection.snapshot.subscriptionId,
    };
  }

  private async isDuplicate(purchase: PurchaseRecord): Promise<boolean> {
    if (purchase.exclusivityKey === null) {
      return false;
    }
    const fulfilled = await this.purchases.findFulfilledByExclusivityKey(
      purchase.exclusivityKey,
    );
    return fulfilled !== undefined && fulfilled.id !== purchase.id;
  }

  private async reject(
    reflection: PaidReflection,
    reason: RejectionReason,
  ): Promise<ReflectionOutcome> {
    const { purchase } = reflection;
    const refund = this.refundStatements.prepareForReflection({
      purchaseId: purchase.id,
      amountPaid: reflection.amountPaid,
      reason,
      requestKey: reflectionRequestKeyOf(purchase.id),
    });
    const result = await this.commit(reflection, 'rejected', {
      patch: { rejectionReason: reason },
      statements: refund.statements,
    });
    if (result === 'guard_failed') {
      return this.current(purchase.id);
    }
    if (result === 'constraint_failed') {
      throw new Error(
        `購入${purchase.id}の拒否の一括の書き込みが制約に違反しました`,
      );
    }
    await this.safely(purchase, 'refund_dispatch', () =>
      this.refunds.dispatch(refund.refundRequestId),
    );
    return applied('rejected');
  }

  // 先頭の決済履歴の記録が、読み取った購入の版で一括の書き込み全体を検査する
  private commit(
    reflection: PaidReflection,
    to: Extract<PurchaseAdvanceTarget, 'fulfilled' | 'rejected'>,
    extra: {
      readonly patch: PurchasePatch;
      readonly statements: readonly BatchItem<'sqlite'>[];
    },
  ): Promise<'committed' | 'guard_failed' | 'constraint_failed'> {
    const { purchase, paidAt } = reflection;
    const guarded: GuardedStatement =
      this.recordStatements.insertCheckoutRecordGuarded(reflection.record, {
        purchaseId: purchase.id,
        expectedToken: purchase.stateToken,
      });
    const advance = this.purchaseStatements.advance({
      purchaseId: purchase.id,
      to,
      from: ADVANCEABLE_FROM[to],
      nextToken: this.ids.generate(),
      patch: {
        ...paymentPatchOf(reflection.snapshot, reflection.amountPaid),
        paidAt,
        reflectedAt: paidAt,
        lastEventAt: reflection.occurredAt,
        ...extra.patch,
      },
    });
    return this.guardedBatch.run({
      guarded,
      rest: [advance, ...extra.statements],
    });
  }

  private async afterFulfilled(
    purchase: PurchaseRecord,
    fulfillment: PurchaseFulfillment,
    fulfillable: FulfillablePurchase,
  ): Promise<void> {
    await this.safely(purchase, 'purchase_notice', () =>
      this.notifier.notifyPurchase(purchase.id),
    );
    if (fulfillment.afterCommit !== undefined) {
      await this.safely(purchase, 'after_commit', async () => {
        await fulfillment.afterCommit?.(fulfillable);
      });
    }
  }

  // 確定の後の処理の失敗は反映の結果を変えない。依頼待ちの行は日次の確認が、確定後の処理の取りこぼしは購入種別を受け持つ機能が拾う
  private async safely(
    purchase: PurchaseRecord,
    stage: AfterCommitStage,
    task: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.logger.warn(AFTER_COMMIT_FAILURE_MESSAGES[stage], {
        error,
        purchaseId: purchase.id,
        purchaseKind: purchase.kind,
        stage,
      });
    }
  }
}
