import type { Logger } from '@logtape/logtape';
import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import type { PaymentRecordStatus } from '../../../common-lib/payments/payment-record-values.ts';
import type { Database } from '../../../db/client.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  type NewPaymentRecord,
  type PaymentReflector,
  type PurchaseNotifier,
  type PurchaseRecord,
  type PurchaseStore,
  type ReflectionInstruction,
  type ReflectionOutcome,
  type RefundRequestRecord,
  type RefundStore,
  type StripeCheckoutSessionSnapshot,
  type StripeDisputeSnapshot,
  type StripeGateway,
  type StripeInvoiceSnapshot,
  type StripeInvoiceStatus,
  StripeNotFoundError,
  type StripeObjectStore,
  type StripeRefundSnapshot,
  type StripeSubscriptionSnapshot,
} from '../../core/payments/ports.ts';
import { assertSubscriptionEventSinkNames } from '../../core/payments/purchase-kind-registry.ts';
import type { SubscriptionChange } from '../../core/payments/purchase-kind-contract.ts';
import {
  isReflectionRequestKey,
  refundRecordStatusOf,
  refundRequestReflectionOf,
} from '../../core/payments/refund-rules.ts';
import type { Clock } from '../../core/time/clock.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { CheckoutSessionReflection } from './checkout-session-reflection.ts';
import type {
  SubscriptionEventSink,
  SubscriptionEventSinkRegistration,
} from './fulfillment-contract.ts';
import type {
  PaymentOwnerResolution,
  PaymentOwnerResolver,
} from './payment-owner-resolver.ts';
import { reportRefundFailure } from './refund-failure-reporting.ts';
import type {
  GuardedBatch,
  PaymentRecordStatements,
  RefundStatements,
  StripeObjectStatements,
} from './statement-contracts.ts';

export interface StripePaymentReflectorDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly db: Database;
  readonly gateway: StripeGateway;
  readonly checkout: CheckoutSessionReflection;
  readonly owners: PaymentOwnerResolver;
  readonly purchases: PurchaseStore;
  readonly recordStatements: PaymentRecordStatements;
  readonly refunds: RefundStore;
  readonly refundStatements: RefundStatements;
  readonly stripeObjects: StripeObjectStore;
  readonly stripeObjectStatements: StripeObjectStatements;
  readonly guardedBatch: GuardedBatch;
  readonly subscriptionSinks: readonly SubscriptionEventSinkRegistration[];
  readonly resolveSink: (
    identifier: ServiceIdentifier<SubscriptionEventSink>,
  ) => SubscriptionEventSink;
  readonly notifier: PurchaseNotifier;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

type ResolvedOwner = Extract<PaymentOwnerResolution, { kind: 'resolved' }>;

type DisputeStage = Extract<
  ReflectionInstruction,
  { kind: 'dispute' }
>['stage'];

type StripeObjectType = 'invoice' | 'refund' | 'dispute' | 'subscription';

type AfterCommitStage = 'refund_notice' | 'subscription_after_commit';

const AFTER_COMMIT_FAILURE_MESSAGES: Readonly<
  Record<AfterCommitStage, string>
> = {
  refund_notice:
    '自動返金の通知を依頼できませんでした。依頼待ちは日次の確認が依頼し直します',
  subscription_after_commit:
    '定期課金の受け取り口の確定後の処理が失敗しました。反映の結果は変えません',
};

const APPLIED: ReflectionOutcome = { kind: 'applied' };
const ALREADY_APPLIED: ReflectionOutcome = { kind: 'already_applied' };
const STALE: ReflectionOutcome = { kind: 'stale' };
const UNRESOLVED: ReflectionOutcome = { kind: 'unresolved' };
const IGNORED: ReflectionOutcome = { kind: 'ignored' };

// 支払いの失敗の通知の後も、請求は再試行の間openのまま、再試行を終えるとuncollectibleになる。下書きと無効の請求は支払いを伴わない
const INVOICE_RECORD_STATUSES: Readonly<
  Record<StripeInvoiceStatus, PaymentRecordStatus | undefined>
> = {
  paid: 'succeeded',
  open: 'failed',
  uncollectible: 'failed',
  draft: undefined,
  void: undefined,
};

interface DisputeStageRecord {
  readonly status: Extract<
    PaymentRecordStatus,
    'disputed' | 'dispute_won' | 'dispute_lost'
  >;
  readonly amount: MinorUnitAmount;
}

function sumOf(amounts: readonly number[]): number {
  return amounts.reduce((total, amount) => total + amount, 0);
}

// 資金の移動を伴う段階と敗訴だけを記録する。勝訴の終了は資金の戻りで記録済みで、照会・審査中・不服申し立ての段階は資金が動かない
function disputeStageRecordOf(
  stage: DisputeStage,
  dispute: StripeDisputeSnapshot,
): DisputeStageRecord | undefined {
  const amounts = dispute.balanceTransactions.map(({ amount }) => amount);
  if (stage === 'funds_withdrawn') {
    const withdrawn = sumOf(amounts.filter((amount) => amount < 0));
    return withdrawn === 0
      ? undefined
      : { status: 'disputed', amount: withdrawn };
  }
  if (stage === 'funds_reinstated') {
    const reinstated = sumOf(amounts.filter((amount) => amount > 0));
    return reinstated === 0
      ? undefined
      : { status: 'dispute_won', amount: reinstated };
  }
  return dispute.status === 'lost'
    ? { status: 'dispute_lost', amount: 0 }
    : undefined;
}

function usdOf(currency: string, objectId: string): 'usd' {
  if (currency !== 'usd') {
    throw new TypeError(
      `Stripeの${objectId}の通貨が想定外の値です: ${currency}`,
    );
  }
  return 'usd';
}

function nonEmpty(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

// 初回の請求は決済セッションの記録と同じ行になり、同意を購入から写す。定期課金の2回目以降の請求も持ち主は元の購入になるため、購入に保存した請求のIDで見分ける
function isInitialInvoice(
  purchase: PurchaseRecord | null,
  invoiceId: string,
): purchase is PurchaseRecord {
  return (
    purchase !== null &&
    (purchase.stripeInvoiceId === null ||
      purchase.stripeInvoiceId === invoiceId)
  );
}

function changesOf(result: unknown): number {
  if (
    typeof result === 'object' &&
    result !== null &&
    'meta' in result &&
    typeof result.meta === 'object' &&
    result.meta !== null &&
    'changes' in result.meta &&
    typeof result.meta.changes === 'number'
  ) {
    return result.meta.changes;
  }
  throw new TypeError('D1の書き込みの結果に変更の件数がありません');
}

export class StripePaymentReflector implements PaymentReflector {
  private readonly db: Database;
  private readonly gateway: StripeGateway;
  private readonly checkout: CheckoutSessionReflection;
  private readonly owners: PaymentOwnerResolver;
  private readonly purchases: PurchaseStore;
  private readonly recordStatements: PaymentRecordStatements;
  private readonly refunds: RefundStore;
  private readonly refundStatements: RefundStatements;
  private readonly stripeObjects: StripeObjectStore;
  private readonly stripeObjectStatements: StripeObjectStatements;
  private readonly guardedBatch: GuardedBatch;
  private readonly subscriptionSinks: readonly SubscriptionEventSinkRegistration[];
  private readonly resolveSink: StripePaymentReflectorDependencies['resolveSink'];
  private readonly notifier: PurchaseNotifier;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(dependencies: StripePaymentReflectorDependencies) {
    assertSubscriptionEventSinkNames(dependencies.subscriptionSinks);
    this.db = dependencies.db;
    this.gateway = dependencies.gateway;
    this.checkout = dependencies.checkout;
    this.owners = dependencies.owners;
    this.purchases = dependencies.purchases;
    this.recordStatements = dependencies.recordStatements;
    this.refunds = dependencies.refunds;
    this.refundStatements = dependencies.refundStatements;
    this.stripeObjects = dependencies.stripeObjects;
    this.stripeObjectStatements = dependencies.stripeObjectStatements;
    this.guardedBatch = dependencies.guardedBatch;
    this.subscriptionSinks = dependencies.subscriptionSinks;
    this.resolveSink = dependencies.resolveSink;
    this.notifier = dependencies.notifier;
    this.ids = dependencies.ids;
    this.clock = dependencies.clock;
    this.logger = getAppLogger([
      dependencies.appName,
      'payments',
      'reflection',
    ]);
  }

  async reflect(
    instruction: ReflectionInstruction,
  ): Promise<ReflectionOutcome> {
    switch (instruction.kind) {
      case 'checkout_session':
        return this.checkout.reflectSession(
          instruction.sessionId,
          instruction.occurredAt,
        );
      case 'invoice':
        return this.reflectInvoice(
          instruction.invoiceId,
          instruction.occurredAt,
        );
      case 'refund':
        return this.reflectRefund(instruction.refundId, instruction.occurredAt);
      case 'dispute':
        return this.reflectDispute(instruction);
      case 'subscription':
        return this.reflectSubscription(
          instruction.subscriptionId,
          instruction.occurredAt,
        );
      case 'ignored':
        return IGNORED;
    }
  }

  reflectCheckoutSnapshot(
    snapshot: StripeCheckoutSessionSnapshot,
    occurredAt: Date,
  ): Promise<ReflectionOutcome> {
    return this.checkout.reflectSnapshot(snapshot, occurredAt);
  }

  private async reflectInvoice(
    invoiceId: string,
    occurredAt: Date,
  ): Promise<ReflectionOutcome> {
    const invoice = await this.retrieve('invoice', invoiceId, () =>
      this.gateway.retrieveInvoice(invoiceId),
    );
    if (invoice === undefined) {
      return UNRESOLVED;
    }
    const status = INVOICE_RECORD_STATUSES[invoice.status];
    if (status === undefined) {
      return IGNORED;
    }
    if (invoice.subscriptionId === null) {
      return this.unresolved('invoice', invoice.id);
    }
    const owner = await this.owners.resolve({
      objectType: 'invoice',
      objectId: invoice.id,
      paymentIntentId: invoice.paymentIntentId,
      subscriptionMetadata: invoice.subscriptionMetadata,
    });
    if (owner.kind === 'unresolved') {
      return UNRESOLVED;
    }
    return this.upsertRecord(
      this.invoiceRecordOf(invoice, status, owner, occurredAt),
    );
  }

  private invoiceRecordOf(
    invoice: StripeInvoiceSnapshot,
    status: PaymentRecordStatus,
    owner: ResolvedOwner,
    occurredAt: Date,
  ): NewPaymentRecord {
    const { purchase } = owner;
    const initial = isInitialInvoice(purchase, invoice.id) ? purchase : null;
    return {
      ...this.recordBaseOf(owner, occurredAt),
      kind: 'subscription',
      status,
      amount: status === 'succeeded' ? invoice.amountPaid : invoice.amountDue,
      currency: usdOf(invoice.currency, invoice.id),
      quantity: purchase?.quantity ?? null,
      stripeReference: invoice.id,
      purchaseId: initial?.id ?? null,
      consentedAt: initial?.consentedAt ?? null,
      consentVersion: initial?.consentVersion ?? null,
    };
  }

  private async reflectRefund(
    refundId: string,
    occurredAt: Date,
  ): Promise<ReflectionOutcome> {
    const refund = await this.retrieve('refund', refundId, () =>
      this.gateway.retrieveRefund(refundId),
    );
    if (refund === undefined) {
      return UNRESOLVED;
    }
    const owner = await this.owners.resolve({
      objectType: 'refund',
      objectId: refund.id,
      paymentIntentId: refund.paymentIntentId,
    });
    if (owner.kind === 'unresolved') {
      return UNRESOLVED;
    }
    const request = await this.refundRequestOf(refund);
    const { outcome, restChanges } = await this.batchRecord(
      {
        ...this.recordBaseOf(owner, occurredAt),
        kind: 'refund',
        status: refundRecordStatusOf(refund.status),
        amount: -refund.amount,
        currency: usdOf(refund.currency, refund.id),
        quantity: null,
        stripeReference: refund.id,
      },
      request === undefined
        ? []
        : [this.refundRequestStatement(refund, request)],
    );
    // 依頼の行の文は状態か返金のIDが変わるときだけ行を変えるため、同じ失敗の通知の再送では知らせない
    if (
      request !== undefined &&
      request.status !== 'failed' &&
      refund.status === 'failed' &&
      (restChanges[0] ?? 0) > 0
    ) {
      reportRefundFailure(this.logger, {
        refundRequestId: request.id,
        stripeRefundId: refund.id,
        failureCode: refund.failureReason,
      });
    }
    if (
      request !== undefined &&
      isReflectionRequestKey(request.requestKey) &&
      refund.status === 'succeeded'
    ) {
      await this.safely('refund_notice', { refundRequestId: request.id }, () =>
        this.notifier.notifyAutomaticRefund(request.id),
      );
    }
    return outcome;
  }

  // 本specが作った返金はメタデータに依頼のIDを持つ。ダッシュボードの手動の返金には依頼が無い
  private async refundRequestOf(
    refund: StripeRefundSnapshot,
  ): Promise<RefundRequestRecord | undefined> {
    const refundRequestId = nonEmpty(refund.metadata.refund_request_id);
    const request =
      (refundRequestId === null
        ? undefined
        : await this.refunds.findById(refundRequestId)) ??
      (await this.refunds.findByStripeRefundId(refund.id));
    // 別の返金が既に結び付いた依頼は書き換えない(返金のIDの一意索引の違反で反映が止まらないようにする)
    return request === undefined ||
      request.stripeRefundId === null ||
      request.stripeRefundId === refund.id
      ? request
      : undefined;
  }

  private refundRequestStatement(
    refund: StripeRefundSnapshot,
    request: RefundRequestRecord,
  ): BatchItem<'sqlite'> {
    return this.refundStatements.reflectStripeStatus({
      ...refundRequestReflectionOf(refund.status),
      refundRequestId: request.id,
      stripeRefundId: refund.id,
      ...(refund.status === 'failed'
        ? { failureCode: refund.failureReason }
        : {}),
    });
  }

  private async reflectDispute(
    instruction: Extract<ReflectionInstruction, { kind: 'dispute' }>,
  ): Promise<ReflectionOutcome> {
    const { disputeId } = instruction;
    const dispute = await this.retrieve('dispute', disputeId, () =>
      this.gateway.retrieveDispute(disputeId),
    );
    if (dispute === undefined) {
      return UNRESOLVED;
    }
    const stageRecord = disputeStageRecordOf(instruction.stage, dispute);
    if (stageRecord === undefined) {
      return IGNORED;
    }
    const owner = await this.owners.resolve({
      objectType: 'dispute',
      objectId: dispute.id,
      paymentIntentId: dispute.paymentIntentId,
    });
    if (owner.kind === 'unresolved') {
      return UNRESOLVED;
    }
    const results: readonly unknown[] = await this.db.batch([
      this.recordStatements.insertDisputeStage({
        ...this.recordBaseOf(owner, instruction.occurredAt),
        kind: 'dispute',
        status: stageRecord.status,
        amount: stageRecord.amount,
        currency: usdOf(dispute.currency, dispute.id),
        quantity: null,
        stripeReference: dispute.id,
      }),
    ]);
    return changesOf(results[0]) > 0 ? APPLIED : ALREADY_APPLIED;
  }

  private async reflectSubscription(
    subscriptionId: string,
    occurredAt: Date,
  ): Promise<ReflectionOutcome> {
    const subscription = await this.retrieve(
      'subscription',
      subscriptionId,
      () => this.gateway.retrieveSubscription(subscriptionId),
    );
    if (subscription === undefined) {
      return UNRESOLVED;
    }
    const recordedAt = await this.stripeObjects.findLastEventAt(
      subscription.id,
    );
    if (recordedAt !== undefined && recordedAt > occurredAt) {
      return STALE;
    }
    const change = await this.subscriptionChangeOf(subscription, occurredAt);
    if (change === undefined) {
      return this.unresolved('subscription', subscription.id);
    }
    const sinks = this.subscriptionSinks.map(({ sink }) =>
      this.resolveSink(sink),
    );
    const statements: BatchItem<'sqlite'>[] = [];
    for (const sink of sinks) {
      statements.push(...(await sink.statementsFor(change, this.db)));
    }
    const result = await this.guardedBatch.run({
      guarded: this.stripeObjectStatements.advanceGuarded({
        objectId: subscription.id,
        objectType: 'subscription',
        occurredAt,
      }),
      rest: statements,
    });
    if (result === 'guard_failed') {
      return STALE;
    }
    if (result === 'constraint_failed') {
      throw new Error(
        `定期課金${subscription.id}の反映の一括の書き込みが制約に違反しました`,
      );
    }
    await this.afterSubscriptionCommitted(sinks, change);
    return APPLIED;
  }

  // 定期課金には決済セッションの作成時に購入ID・仮名化IDをメタデータとして付けている
  private async subscriptionChangeOf(
    subscription: StripeSubscriptionSnapshot,
    occurredAt: Date,
  ): Promise<SubscriptionChange | undefined> {
    const pseudonymousId = nonEmpty(subscription.metadata.pseudonymous_id);
    if (pseudonymousId === null) {
      return undefined;
    }
    const purchaseId = nonEmpty(subscription.metadata.purchase_id);
    const purchase =
      purchaseId === null
        ? undefined
        : await this.purchases.findById(purchaseId);
    return {
      subscriptionId: subscription.id,
      userId: purchase?.userId ?? null,
      pseudonymousId,
      purchaseId,
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      cancelAt: subscription.cancelAt,
      currentPeriodEnd: subscription.currentPeriodEnd,
      endedAt: subscription.endedAt,
      occurredAt,
    };
  }

  private async afterSubscriptionCommitted(
    sinks: readonly SubscriptionEventSink[],
    change: SubscriptionChange,
  ): Promise<void> {
    for (const sink of sinks) {
      if (sink.afterCommit !== undefined) {
        await this.safely(
          'subscription_after_commit',
          { subscriptionId: change.subscriptionId },
          async () => {
            await sink.afterCommit?.(change);
          },
        );
      }
    }
  }

  private recordBaseOf(
    owner: ResolvedOwner,
    occurredAt: Date,
  ): Omit<
    NewPaymentRecord,
    'kind' | 'status' | 'amount' | 'currency' | 'quantity' | 'stripeReference'
  > {
    return {
      id: this.ids.generate(),
      pseudonymousId: owner.pseudonymousId,
      purpose: owner.purchaseKind,
      relatedId: owner.purchase?.relatedId ?? null,
      purchaseId: owner.purchaseId,
      consentedAt: null,
      consentVersion: null,
      linkFundingSourceGroup: null,
      occurredAt,
      lastEventAt: occurredAt,
      recordedAt: this.clock.now(),
    };
  }

  // 記録済みより古い発生時刻の通知では記録を更新しない。同じ一括の書き込みの文はStripeから取り直した最新の状態を書くため、古い通知でも確定させる
  private async upsertRecord(
    record: NewPaymentRecord,
  ): Promise<ReflectionOutcome> {
    return (await this.batchRecord(record, [])).outcome;
  }

  // 同じ一括の書き込みの文ごとに、変えた行の数を返す
  private async batchRecord(
    record: NewPaymentRecord,
    rest: readonly BatchItem<'sqlite'>[],
  ): Promise<{
    readonly outcome: ReflectionOutcome;
    readonly restChanges: readonly number[];
  }> {
    const results: readonly unknown[] = await this.db.batch([
      this.recordStatements.upsertByReference(record),
      ...rest,
    ]);
    return {
      outcome: changesOf(results[0]) > 0 ? APPLIED : STALE,
      restChanges: results.slice(1).map(changesOf),
    };
  }

  private async retrieve<T>(
    objectType: StripeObjectType,
    objectId: string,
    fetch: () => Promise<T>,
  ): Promise<T | undefined> {
    try {
      return await fetch();
    } catch (error) {
      if (error instanceof StripeNotFoundError) {
        this.unresolved(objectType, objectId);
        return undefined;
      }
      throw error;
    }
  }

  private unresolved(
    objectType: StripeObjectType,
    objectId: string,
  ): ReflectionOutcome {
    this.logger.warn(
      '本サービスの購入・利用者に結び付かないStripeの通知を反映しませんでした',
      { objectType, objectId },
    );
    return UNRESOLVED;
  }

  // 確定の後の処理の失敗は反映の結果を変えない。依頼待ちの行は日次の確認が、確定後の処理の取りこぼしは受け取り口を受け持つ機能が拾う
  private async safely(
    stage: AfterCommitStage,
    target: Readonly<Record<string, string>>,
    task: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await task();
    } catch (error) {
      this.logger.warn(AFTER_COMMIT_FAILURE_MESSAGES[stage], {
        error,
        stage,
        ...target,
      });
    }
  }
}
