import { inject, injectable } from 'inversify';

import {
  PURCHASE_KIND_MODES,
  type PurchaseKind,
} from '../../../common-lib/payments/purchase-kinds.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type {
  AccountGuard,
  UserAccountView,
} from '../../../lib/core/identity/account-guard.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import {
  type CustomerStore,
  type NewPurchase,
  type PurchaseRecord,
  type PurchaseStore,
  type StripeGateway,
  type StripePrice,
  StripeUnavailableError,
} from '../../../lib/core/payments/ports.ts';
import type {
  PaymentsEnv,
  PurchaseKindRegistry,
  PurchaseOffer,
} from '../../../lib/core/payments/purchase-kind-contract.ts';
import {
  assertAcceptable,
  computeSessionExpiry,
} from '../../../lib/core/payments/purchase-rules.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import type {
  CheckoutPurchaseWriter,
  CheckoutStartLimits,
  PurchaseOfferPolicyResolver,
} from './checkout-ports.ts';
import {
  paymentsError,
  purchaseOfferUnavailableError,
} from './payments-errors.ts';
import { API_PAYMENTS_TYPES } from './payments-types.ts';

export interface CheckoutStartInput {
  readonly session: SessionView;
  readonly kind: PurchaseKind;
  readonly targetId: string | null;
  // presentation層がGraphQLContext.assertHumanを渡す。購入種別がbot判定を求めるときだけ呼ぶ
  readonly humanCheck?: () => Promise<void>;
}

export interface CheckoutStarter {
  start(input: CheckoutStartInput): Promise<{ readonly purchaseId: string }>;
}

const logger = getAppLogger(['api', 'payments', 'checkout']);

// 購入を作る前のStripeの一時的な失敗は、購入を残さずに利用できない旨にする
async function withinStripe<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error: unknown) {
    if (error instanceof StripeUnavailableError) {
      throw paymentsError('payments_unavailable');
    }
    throw error;
  }
}

@injectable()
export class StripeCheckoutStarter implements CheckoutStarter {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AccountGuard)
    private readonly guard: AccountGuard,
    @inject(API_PAYMENTS_TYPES.CheckoutStartLimits)
    private readonly limits: CheckoutStartLimits,
    @inject(PAYMENTS_TYPES.PurchaseKindRegistry)
    private readonly registry: PurchaseKindRegistry,
    @inject(API_PAYMENTS_TYPES.PurchaseOfferPolicyResolver)
    private readonly policies: PurchaseOfferPolicyResolver,
    @inject(PAYMENTS_TYPES.StripeGateway)
    private readonly gateway: StripeGateway,
    @inject(PAYMENTS_TYPES.CustomerStore)
    private readonly customers: CustomerStore,
    @inject(PAYMENTS_TYPES.PurchaseStore)
    private readonly purchases: PurchaseStore,
    @inject(API_PAYMENTS_TYPES.CheckoutPurchaseWriter)
    private readonly writer: CheckoutPurchaseWriter,
    @inject(PLATFORM_TYPES.Env) private readonly env: PaymentsEnv,
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async start(
    input: CheckoutStartInput,
  ): Promise<{ readonly purchaseId: string }> {
    const { user } = await this.guard.requireVerifiedUser(input.session);
    const now = this.clock.now();
    await this.limits.consume(user.id, now);
    const offer = await this.describeOffer(user.id, input, now);
    if (offer.requiresBotVerification) {
      await this.verifyHuman(input);
    }
    assertAcceptable(now, offer);
    const price = await this.resolvePrice(offer.priceLookupKey);
    const customerId = await this.prepareCustomer(user);
    const previous = await this.purchases.findOpenByTarget({
      userId: user.id,
      kind: input.kind,
      targetId: input.targetId,
    });
    const purchase = this.newPurchase({ user, input, offer, price, now });
    await this.writer.replaceOpen({
      purchase,
      supersede: previous.map(({ id }) => id),
    });
    await this.openSession({
      purchase,
      customerId,
      pseudonymousId: user.pseudonymousId,
    });
    await this.expirePreviousSessions(previous);
    return { purchaseId: purchase.id };
  }

  private async describeOffer(
    userId: string,
    input: CheckoutStartInput,
    now: Date,
  ): Promise<PurchaseOffer> {
    const registration = this.registry.resolve(input.kind, this.env);
    if (registration === undefined) {
      throw paymentsError('purchase_kind_unavailable');
    }
    const decision = await this.policies
      .resolve(registration.offer)
      .describe({ userId, targetId: input.targetId, now });
    if (decision.kind === 'unavailable') {
      throw purchaseOfferUnavailableError(decision);
    }
    return decision.offer;
  }

  private async verifyHuman(input: CheckoutStartInput): Promise<void> {
    if (input.humanCheck === undefined) {
      throw new Error(
        `購入種別${input.kind}はbot判定を求めますが、bot判定の口が渡されていません。`,
      );
    }
    await input.humanCheck();
  }

  // 表示用に保持した価格ではなく、常にStripeの最新の価格で決済を始める
  private async resolvePrice(lookupKey: string): Promise<StripePrice> {
    const prices = await withinStripe(() =>
      this.gateway.resolvePrices([lookupKey]),
    );
    const price = prices.find((candidate) => candidate.lookupKey === lookupKey);
    if (price === undefined) {
      throw new Error(
        `Stripeに決済に使える価格がありません: ${JSON.stringify(lookupKey)}`,
      );
    }
    return price;
  }

  private async prepareCustomer(user: UserAccountView): Promise<string> {
    const existingCustomerId = (await this.customers.find(user.id)) ?? null;
    const { customerId, created } = await withinStripe(() =>
      this.gateway.ensureCustomer({
        existingCustomerId,
        email: user.email,
        pseudonymousId: user.pseudonymousId,
      }),
    );
    if (created) {
      await this.customers.save(user.id, customerId);
    }
    return customerId;
  }

  private newPurchase(input: {
    readonly user: UserAccountView;
    readonly input: CheckoutStartInput;
    readonly offer: PurchaseOffer;
    readonly price: StripePrice;
    readonly now: Date;
  }): NewPurchase {
    const { offer, price } = input;
    return {
      id: this.ids.generate(),
      userId: input.user.id,
      kind: input.input.kind,
      targetId: input.input.targetId,
      relatedId: offer.relatedId,
      exclusivityKey: offer.exclusivityKey,
      stateToken: this.ids.generate(),
      priceLookupKey: offer.priceLookupKey,
      stripePriceId: price.priceId,
      unitAmount: price.unitAmount,
      quantity: offer.quantity,
      amountTotal: price.unitAmount * offer.quantity,
      summary: offer.summary,
      deadlineAt: offer.deadlineAt,
      acceptUntil: offer.acceptUntil,
      fulfillableUntil: offer.fulfillableUntil,
      expiresAt: computeSessionExpiry(input.now, offer.deadlineAt),
    };
  }

  private async openSession(input: {
    readonly purchase: NewPurchase;
    readonly customerId: string;
    readonly pseudonymousId: string;
  }): Promise<void> {
    const { purchase } = input;
    let sessionId: string;
    try {
      ({ id: sessionId } = await this.gateway.createCheckoutSession({
        purchaseId: purchase.id,
        mode: PURCHASE_KIND_MODES[purchase.kind],
        customerId: input.customerId,
        priceId: purchase.stripePriceId,
        quantity: purchase.quantity,
        expiresAt: purchase.expiresAt,
        metadata: {
          purchase_id: purchase.id,
          purchase_kind: purchase.kind,
          pseudonymous_id: input.pseudonymousId,
        },
      }));
    } catch (error: unknown) {
      // 決済セッションの無い購入は支払われないため、利用者の決済画面に出ないよう失効にする
      await this.writer.expire(purchase.id);
      if (error instanceof StripeUnavailableError) {
        throw paymentsError('payments_unavailable');
      }
      throw error;
    }
    await this.purchases.attachSession({
      purchaseId: purchase.id,
      sessionId,
      expiresAt: purchase.expiresAt,
    });
  }

  // 失効の前に旧セッションで支払われても反映が置き換え済みの購入から進めるため、失効の失敗は決済の開始を妨げない
  private async expirePreviousSessions(
    previous: readonly PurchaseRecord[],
  ): Promise<void> {
    for (const { id, stripeCheckoutSessionId } of previous) {
      if (stripeCheckoutSessionId === null) {
        continue;
      }
      try {
        await this.gateway.expireCheckoutSession(stripeCheckoutSessionId);
      } catch (error: unknown) {
        logger.warn('置き換えた購入の決済セッションを失効できませんでした', {
          purchaseId: id,
          sessionId: stripeCheckoutSessionId,
          error,
        });
      }
    }
  }
}
