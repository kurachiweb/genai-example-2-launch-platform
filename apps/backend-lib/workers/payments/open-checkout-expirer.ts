import type { Logger } from '@logtape/logtape';

import type { IdGenerator } from '../../core/ids/id-generator.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  type OpenCheckoutExpirer,
  type PurchaseRecord,
  type PurchaseStore,
  type StripeGateway,
  StripeNotFoundError,
} from '../../core/payments/ports.ts';
import { ADVANCEABLE_FROM } from '../../core/payments/purchase-rules.ts';
import type { Clock } from '../../core/time/clock.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import type { CheckoutSessionReflection } from './checkout-session-reflection.ts';

export interface StripeOpenCheckoutExpirerDependencies {
  readonly appName: LoggingOptions['appName'];
  readonly gateway: StripeGateway;
  readonly purchases: PurchaseStore;
  readonly reflection: CheckoutSessionReflection;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

type ExpireOpenInput = Parameters<OpenCheckoutExpirer['expireOpen']>[0];

type ExpireOpenResult = Awaited<ReturnType<OpenCheckoutExpirer['expireOpen']>>;

const MAX_EXPIRY_LIMIT = 50;

interface ExpirableCheckout {
  readonly purchase: PurchaseRecord;
  readonly sessionId: string;
}

function assertLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXPIRY_LIMIT) {
    throw new RangeError(
      `失効の件数の上限は1〜${String(MAX_EXPIRY_LIMIT)}の整数です(${String(limit)})`,
    );
  }
}

// 決済セッションの無い購入は、Stripe上に支払える決済セッションが無いため対象にしない
function expirableOf(
  purchase: PurchaseRecord,
  input: ExpireOpenInput,
): ExpirableCheckout[] {
  const sessionId = purchase.stripeCheckoutSessionId;
  if (sessionId === null) {
    return [];
  }
  const kindMatches =
    input.kinds === 'all' || input.kinds.includes(purchase.kind);
  const targetMatches =
    input.targetId === undefined || purchase.targetId === input.targetId;
  return kindMatches && targetMatches ? [{ purchase, sessionId }] : [];
}

// 処理中の購入はStripe上で決済セッションが完了済みで失効できず、支払いの確定を待って残り続ける
const isProcessing = ({ purchase }: ExpirableCheckout): boolean =>
  purchase.status === 'processing';

// 上限の枠を処理中の購入が塞いで未払い・置き換え済みの購入へ届かなくならないよう、処理中でない購入を先に扱う
function expirableFirst(
  checkouts: readonly ExpirableCheckout[],
): readonly ExpirableCheckout[] {
  return [
    ...checkouts.filter((checkout) => !isProcessing(checkout)),
    ...checkouts.filter(isProcessing),
  ];
}

export class StripeOpenCheckoutExpirer implements OpenCheckoutExpirer {
  private readonly gateway: StripeGateway;
  private readonly purchases: PurchaseStore;
  private readonly reflection: CheckoutSessionReflection;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly logger: Logger;

  constructor(dependencies: StripeOpenCheckoutExpirerDependencies) {
    this.gateway = dependencies.gateway;
    this.purchases = dependencies.purchases;
    this.reflection = dependencies.reflection;
    this.ids = dependencies.ids;
    this.clock = dependencies.clock;
    this.logger = getAppLogger([
      dependencies.appName,
      'payments',
      'checkout-expiry',
    ]);
  }

  async expireOpen(input: ExpireOpenInput): Promise<ExpireOpenResult> {
    assertLimit(input.limit);
    const purchases = await this.purchases.findOpenByUser(input.userId);
    const checkouts = expirableFirst(
      purchases.flatMap((purchase) => expirableOf(purchase, input)),
    );
    let expired = 0;
    for (const checkout of checkouts.slice(0, input.limit)) {
      if (await this.expire(checkout)) {
        expired += 1;
      }
    }
    // 失効できない処理中の購入を残りに数えると、続きの呼び出しが同じ購入を扱い続けて終わらない
    const remaining = checkouts
      .slice(input.limit)
      .some((checkout) => !isProcessing(checkout));
    return { expired, remaining };
  }

  // 購入を失効にしたかを返す。Stripe上で既に完了・失効していた決済セッションは反映に委ねる
  private async expire(checkout: ExpirableCheckout): Promise<boolean> {
    const now = this.clock.now();
    let result: 'expired' | 'not_open';
    try {
      result = await this.gateway.expireCheckoutSession(checkout.sessionId);
    } catch (error) {
      if (!(error instanceof StripeNotFoundError)) {
        throw error;
      }
      this.logger.warn('Stripeに決済セッションが無いため、購入を失効にします', {
        purchaseId: checkout.purchase.id,
        sessionId: checkout.sessionId,
      });
      return this.advanceToExpired(checkout.purchase, now);
    }
    if (result === 'expired') {
      return this.advanceToExpired(checkout.purchase, now);
    }
    const outcome = await this.reflection.reflectSession(
      checkout.sessionId,
      now,
    );
    return outcome.kind === 'applied' && outcome.purchaseStatus === 'expired';
  }

  private advanceToExpired(
    purchase: PurchaseRecord,
    now: Date,
  ): Promise<boolean> {
    return this.purchases.advanceAlone({
      purchaseId: purchase.id,
      to: 'expired',
      from: ADVANCEABLE_FROM.expired,
      nextToken: this.ids.generate(),
      patch: { lastEventAt: now },
    });
  }
}
