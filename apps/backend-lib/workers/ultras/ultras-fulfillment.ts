import type { Logger } from '@logtape/logtape';
import { captureEvent } from '@sentry/cloudflare';
import type { BatchItem } from 'drizzle-orm/batch';

import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { FulfillablePurchase } from '../../core/payments/purchase-kind-contract.ts';
import type {
  ActivationDispatcher,
  ActivationStore,
  SubscriptionStore,
} from '../../core/ultras/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type {
  FulfillmentPlan,
  PurchaseFulfillment,
} from '../payments/fulfillment-contract.ts';
import type {
  ActivationStatements,
  SubscriptionStatements,
} from './statement-contracts.ts';

export interface UltrasFulfillmentDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly subscriptions: SubscriptionStore;
  readonly subscriptionStatements: SubscriptionStatements;
  readonly activations: ActivationStore;
  readonly activationStatements: ActivationStatements;
  readonly dispatcher: ActivationDispatcher;
  readonly ids: IdGenerator;
}

const MISSING_SUBSCRIPTION_MESSAGE =
  'Ultrasの購入に定期課金のIDが無いため、加入を有効にできませんでした';

const MISSING_SUBSCRIPTION_INCIDENT = 'fulfillment-missing-subscription';

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const UNSAFE_VALUE = 'unknown';

const REJECTED: FulfillmentPlan = Object.freeze({
  kind: 'reject',
  reason: 'ineligible',
});

// タグは除去処理の対象外のため、識別子の形の値だけを送る
const safely = (value: string, pattern: RegExp): string =>
  pattern.test(value) ? value : UNSAFE_VALUE;

// 定期課金の価格で作った決済セッションには定期課金のIDが付くため、無いのは価格か決済セッションの設定の誤りであり、利用者の操作では直らない。運営者が気付けるよう知らせる
function reportMissingSubscription(logger: Logger, purchaseId: string): void {
  const tags = {
    ultras_incident: MISSING_SUBSCRIPTION_INCIDENT,
    purchase_id: safely(purchaseId, ULID_PATTERN),
  };
  logger.error(MISSING_SUBSCRIPTION_MESSAGE, { purchaseId: tags.purchase_id });
  // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられる。文言をlogentryに置くと重複の判定から外れる
  captureEvent({
    level: 'error',
    logentry: { message: MISSING_SUBSCRIPTION_MESSAGE },
    fingerprint: ['ultras', MISSING_SUBSCRIPTION_INCIDENT],
    tags,
  });
}

export class UltrasFulfillment implements PurchaseFulfillment {
  private readonly subscriptions: SubscriptionStore;
  private readonly subscriptionStatements: SubscriptionStatements;
  private readonly activations: ActivationStore;
  private readonly activationStatements: ActivationStatements;
  private readonly dispatcher: ActivationDispatcher;
  private readonly ids: IdGenerator;
  private readonly logger: Logger;

  constructor(dependencies: UltrasFulfillmentDependencies) {
    this.subscriptions = dependencies.subscriptions;
    this.subscriptionStatements = dependencies.subscriptionStatements;
    this.activations = dependencies.activations;
    this.activationStatements = dependencies.activationStatements;
    this.dispatcher = dependencies.dispatcher;
    this.ids = dependencies.ids;
    this.logger = getAppLogger([dependencies.appName, 'application', 'ultras']);
  }

  // 重なりの照会と文の組み立てだけを行い、書き込みは返した文をpaymentsが購入の前進と一括で確定する
  async prepare(purchase: FulfillablePurchase): Promise<FulfillmentPlan> {
    const { stripeSubscriptionId } = purchase;
    if (stripeSubscriptionId === null) {
      reportMissingSubscription(this.logger, purchase.purchaseId);
      return REJECTED;
    }
    const overlapping = await this.subscriptions.findEntitledOverlapping({
      userId: purchase.userId,
      at: purchase.paidAt,
      excludeStripeId: stripeSubscriptionId,
    });
    if (overlapping !== undefined) {
      this.logger.warn(
        '別の加入の特典の継続期間と重なるため、Ultrasの購入を権利を付与できないものとして拒否しました',
        {
          purchaseId: purchase.purchaseId,
          stripeSubscriptionId,
          subscriptionId: overlapping.id,
        },
      );
      return REJECTED;
    }
    return {
      kind: 'fulfill',
      statements: this.activationStatementsOf(purchase, stripeSubscriptionId),
    };
  }

  // 同じ利用者の2つの加入が同時に確定しようとしても、ultras_subscriptionsの部分一意索引の違反で片方の一括の書き込みが取り消され、paymentsの呼び直しで重なりが見つかり拒否になる
  private activationStatementsOf(
    purchase: FulfillablePurchase,
    stripeSubscriptionId: string,
  ): readonly BatchItem<'sqlite'>[] {
    return [
      // 有効化の文は定期課金のIDで挿入または更新するため、IDは行がまだ無いときだけ使われる
      this.subscriptionStatements.activate({
        id: this.ids.generate(),
        stripeSubscriptionId,
        userId: purchase.userId,
        purchaseId: purchase.purchaseId,
        startedAt: purchase.paidAt,
      }),
      this.activationStatements.insertIfAbsent({
        id: this.ids.generate(),
        userId: purchase.userId,
        stripeSubscriptionId,
        activatedAt: purchase.paidAt,
      }),
    ];
  }

  // 一括の書き込みを確定させた側だけが呼ぶ。送り出しの失敗は送り出し先がwarnに留め、日次の確認が送り直す
  async afterCommit(purchase: FulfillablePurchase): Promise<void> {
    const { stripeSubscriptionId } = purchase;
    if (stripeSubscriptionId === null) {
      return;
    }
    const activation =
      await this.activations.findByStripeId(stripeSubscriptionId);
    if (activation === undefined) {
      this.logger.warn(
        '確定した加入の知らせの行が見つからないため、送り出しを行いませんでした',
        { purchaseId: purchase.purchaseId, stripeSubscriptionId },
      );
      return;
    }
    if (activation.completedAt !== null) {
      return;
    }
    await this.dispatcher.dispatch(activation.id);
  }
}
