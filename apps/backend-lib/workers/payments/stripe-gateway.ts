import type { Logger } from '@logtape/logtape';
import Stripe from 'stripe';

import { isMinorUnitAmount } from '../../../common-lib/payments/money.ts';
import { getAppLogger } from '../../core/logging/app-logger.ts';
import type { MinorUnitAmount } from '../../../common-lib/payments/money.ts';
import {
  type StripeCheckoutSessionInput,
  type StripeCheckoutSessionSnapshot,
  type StripeDisputeSnapshot,
  type StripeGateway,
  type StripeInvoiceSnapshot,
  StripeNotFoundError,
  type StripePaymentOwnerHint,
  type StripePrice,
  type StripeRefundSnapshot,
  StripeRejectedError,
  type StripeSubscriptionSnapshot,
  StripeUnavailableError,
} from '../../core/payments/ports.ts';
import type { StripeRefundReason } from '../../core/payments/refund-rules.ts';
import { CHECKOUT_INTEGRATION_IDENTIFIER } from '../../core/payments/stripe-api-version.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  idOf,
  includes,
  invoicePaymentIntentOf,
  isEndedSubscription,
  subscriptionMetadataOf,
  toDisputeSnapshot,
  toInvoiceSnapshot,
  toRefundSnapshot,
  toSubscriptionSnapshot,
  unexpectedValue,
} from './stripe-snapshots.ts';

export interface StripeApiGatewayOptions {
  readonly appName: LoggingOptions['appName'];
  // STRIPE_API_KEYが未設定ならundefined
  readonly client: Stripe | undefined;
  readonly clientSiteOrigin: string;
}

type StripeOperation = keyof StripeGateway;

type FailureOutcome = 'unavailable' | 'not_found' | 'rejected';

type PriceRejection = 'currency' | 'unit_amount' | 'interval';

type ResolvedPrice =
  | { readonly kind: 'usable'; readonly price: StripePrice }
  | { readonly kind: 'unusable'; readonly reason: PriceRejection };

// Stripeは1回の価格の照会で10件までのlookup_keyを受け付ける
const LOOKUP_KEYS_PER_REQUEST = 10;

const PRICE_LIST_LIMIT = 100;

// 支払いのPaymentIntentと、Linkの資金源のグループを持つ最新の請求、定期課金の初回の請求の支払いを1回で取得する
const CHECKOUT_SESSION_EXPAND = [
  'payment_intent.latest_charge',
  'invoice.payments',
];

const SESSION_STATUSES = ['open', 'complete', 'expired'] as const;

const PAYMENT_STATUSES = ['paid', 'unpaid', 'no_payment_required'] as const;

function chunk<T>(values: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

function outcomeOf(error: Stripe.errors.StripeError): FailureOutcome {
  if (
    error instanceof Stripe.errors.StripeConnectionError ||
    error instanceof Stripe.errors.StripeRateLimitError ||
    error instanceof Stripe.errors.StripeAPIError
  ) {
    return 'unavailable';
  }
  const status = error.statusCode;
  if (status !== undefined && (status === 429 || status >= 500)) {
    return 'unavailable';
  }
  return error.code === 'resource_missing' ? 'not_found' : 'rejected';
}

function isRejection(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeError &&
    outcomeOf(error) === 'rejected'
  );
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Stripe.errors.StripeError &&
    outcomeOf(error) === 'not_found'
  );
}

function stripeErrorCodeOf(error: Stripe.errors.StripeError): string {
  return error.code ?? error.rawType ?? error.type;
}

function resolvePrice(price: Stripe.Price, lookupKey: string): ResolvedPrice {
  if (price.currency !== 'usd') {
    return { kind: 'unusable', reason: 'currency' };
  }
  const unitAmount = price.unit_amount;
  if (unitAmount === null || !isMinorUnitAmount(unitAmount)) {
    return { kind: 'unusable', reason: 'unit_amount' };
  }
  const { recurring } = price;
  if (
    recurring !== null &&
    (recurring.interval !== 'month' || recurring.interval_count !== 1)
  ) {
    return { kind: 'unusable', reason: 'interval' };
  }
  return {
    kind: 'usable',
    price: {
      lookupKey,
      priceId: price.id,
      unitAmount,
      currency: 'usd',
      recurringInterval: recurring === null ? null : 'month',
    },
  };
}

function linkFundingSourceGroupOf(
  charge: string | Stripe.Charge | null,
): string | null {
  if (charge === null || typeof charge === 'string') {
    return null;
  }
  const details = charge.payment_method_details;
  return (
    details?.link?.funding_source_group ??
    details?.card?.wallet?.link?.funding_source_group ??
    null
  );
}

export class StripeApiGateway implements StripeGateway {
  private readonly client: Stripe | undefined;
  private readonly clientSiteOrigin: string;
  private readonly logger: Logger;

  constructor(options: StripeApiGatewayOptions) {
    this.client = options.client;
    this.clientSiteOrigin = options.clientSiteOrigin;
    this.logger = getAppLogger([options.appName, 'payments', 'stripe']);
  }

  // Stripeに渡す個人データはメールアドレスと仮名化IDだけにする
  async ensureCustomer(input: {
    readonly existingCustomerId: string | null;
    readonly email: string;
    readonly pseudonymousId: string;
  }): Promise<{ readonly customerId: string; readonly created: boolean }> {
    const client = this.requireClient();
    const params = {
      email: input.email,
      metadata: { pseudonymous_id: input.pseudonymousId },
    };
    const existingId = input.existingCustomerId;
    if (existingId !== null) {
      try {
        const updated = await this.call('ensureCustomer', () =>
          client.customers.update(existingId, params),
        );
        return { customerId: updated.id, created: false };
      } catch (error) {
        // ダッシュボードなどでStripe側だけ削除されたCustomerは作り直す
        if (!(error instanceof StripeNotFoundError)) {
          throw error;
        }
      }
    }
    const created = await this.call('ensureCustomer', () =>
      client.customers.create(params),
    );
    return { customerId: created.id, created: true };
  }

  async deleteCustomer(
    customerId: string,
  ): Promise<'deleted' | 'already_deleted'> {
    const client = this.requireClient();
    try {
      await this.call('deleteCustomer', () => client.customers.del(customerId));
      return 'deleted';
    } catch (error) {
      if (error instanceof StripeNotFoundError) {
        return 'already_deleted';
      }
      throw error;
    }
  }

  async resolvePrices(
    lookupKeys: readonly string[],
  ): Promise<readonly StripePrice[]> {
    const client = this.requireClient();
    const uniqueKeys = [...new Set(lookupKeys)];
    const lists = await Promise.all(
      chunk(uniqueKeys, LOOKUP_KEYS_PER_REQUEST).map((keys) =>
        this.call('resolvePrices', () =>
          client.prices.list({
            lookup_keys: keys,
            active: true,
            limit: PRICE_LIST_LIMIT,
          }),
        ),
      ),
    );
    return lists
      .flatMap((list) => list.data)
      .flatMap((price) => this.usablePrice(price));
  }

  async createCheckoutSession(
    input: StripeCheckoutSessionInput,
  ): Promise<StripeCheckoutSessionSnapshot> {
    const client = this.requireClient();
    const metadata = { ...input.metadata };
    const params: Stripe.Checkout.SessionCreateParams = {
      ui_mode: 'elements',
      mode: input.mode,
      customer: input.customerId,
      customer_update: { address: 'auto' },
      line_items: [{ price: input.priceId, quantity: input.quantity }],
      automatic_tax: { enabled: true },
      billing_address_collection: 'auto',
      adaptive_pricing: { enabled: false },
      allowed_payment_method_types: ['card', 'link'],
      return_url: `${this.clientSiteOrigin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
      expires_at: Math.floor(input.expiresAt.getTime() / 1000),
      client_reference_id: input.purchaseId,
      metadata,
      ...(input.mode === 'payment'
        ? { payment_intent_data: { metadata } }
        : { subscription_data: { metadata } }),
      integration_identifier: CHECKOUT_INTEGRATION_IDENTIFIER,
    };
    const session = await this.call('createCheckoutSession', () =>
      client.checkout.sessions.create(params, {
        idempotencyKey: `checkout:${input.purchaseId}`,
      }),
    );
    return this.toSnapshot(session, null);
  }

  async retrieveCheckoutSession(
    sessionId: string,
  ): Promise<StripeCheckoutSessionSnapshot> {
    const client = this.requireClient();
    const session = await this.call('retrieveCheckoutSession', () =>
      client.checkout.sessions.retrieve(sessionId, {
        expand: CHECKOUT_SESSION_EXPAND,
      }),
    );
    return this.toSnapshot(session, client);
  }

  async expireCheckoutSession(
    sessionId: string,
  ): Promise<'expired' | 'not_open'> {
    const client = this.requireClient();
    try {
      await client.checkout.sessions.expire(sessionId);
      return 'expired';
    } catch (error) {
      // 完了・失効済みの決済セッションの失効は拒否されるため、状態を確かめて区別する
      if (!isRejection(error)) {
        throw this.failure('expireCheckoutSession', error);
      }
      const session = await this.call('expireCheckoutSession', () =>
        client.checkout.sessions.retrieve(sessionId),
      );
      if (session.status !== 'open') {
        return 'not_open';
      }
      throw this.failure('expireCheckoutSession', error);
    }
  }

  async retrieveInvoice(invoiceId: string): Promise<StripeInvoiceSnapshot> {
    const client = this.requireClient();
    const invoice = await this.call('retrieveInvoice', () =>
      client.invoices.retrieve(invoiceId, { expand: ['payments'] }),
    );
    return toInvoiceSnapshot(invoice);
  }

  async retrieveRefund(refundId: string): Promise<StripeRefundSnapshot> {
    const client = this.requireClient();
    const refund = await this.call('retrieveRefund', () =>
      client.refunds.retrieve(refundId),
    );
    return toRefundSnapshot(refund);
  }

  async retrieveDispute(disputeId: string): Promise<StripeDisputeSnapshot> {
    const client = this.requireClient();
    const dispute = await this.call('retrieveDispute', () =>
      client.disputes.retrieve(disputeId),
    );
    return toDisputeSnapshot(dispute);
  }

  async retrieveSubscription(
    subscriptionId: string,
  ): Promise<StripeSubscriptionSnapshot> {
    const client = this.requireClient();
    const subscription = await this.call('retrieveSubscription', () =>
      client.subscriptions.retrieve(subscriptionId),
    );
    return toSubscriptionSnapshot(subscription);
  }

  // 金額がnullなら送らず、Stripeが返金できる残りの全額を返金する
  async createRefund(input: {
    readonly paymentIntentId: string;
    readonly amount: MinorUnitAmount | null;
    readonly reason: StripeRefundReason;
    readonly refundRequestId: string;
    readonly purchaseId: string;
    readonly idempotencyKey: string;
  }): Promise<StripeRefundSnapshot> {
    const client = this.requireClient();
    const params: Stripe.RefundCreateParams = {
      payment_intent: input.paymentIntentId,
      ...(input.amount === null ? {} : { amount: input.amount }),
      reason: input.reason,
      metadata: {
        refund_request_id: input.refundRequestId,
        purchase_id: input.purchaseId,
      },
    };
    const refund = await this.call('createRefund', () =>
      client.refunds.create(params, { idempotencyKey: input.idempotencyKey }),
    );
    return toRefundSnapshot(refund);
  }

  async cancelSubscription(
    subscriptionId: string,
    options: { readonly atPeriodEnd: boolean },
  ): Promise<'canceled' | 'already_canceled'> {
    const client = this.requireClient();
    try {
      await (options.atPeriodEnd
        ? client.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
          })
        : client.subscriptions.cancel(subscriptionId));
      return 'canceled';
    } catch (error) {
      // 終了した定期課金の解約・更新の拒否の形はStripeが定めていないため、状態を確かめて区別する
      if (!isRejection(error) && !isNotFound(error)) {
        throw this.failure('cancelSubscription', error);
      }
      const subscription = await this.call('cancelSubscription', () =>
        client.subscriptions.retrieve(subscriptionId),
      );
      if (isEndedSubscription(subscription)) {
        return 'already_canceled';
      }
      throw this.failure('cancelSubscription', error);
    }
  }

  async createPortalSession(input: {
    readonly customerId: string;
    readonly returnUrl: string;
  }): Promise<{ readonly url: string }> {
    const client = this.requireClient();
    const session = await this.call('createPortalSession', () =>
      client.billingPortal.sessions.create({
        customer: input.customerId,
        return_url: input.returnUrl,
      }),
    );
    return { url: session.url };
  }

  // 定期課金の請求のPaymentIntentはメタデータを持たないため、支払った請求の定期課金のメタデータも添える
  async retrievePaymentIntentOwner(
    paymentIntentId: string,
  ): Promise<StripePaymentOwnerHint> {
    const client = this.requireClient();
    const [paymentIntent, invoicePayments] = await Promise.all([
      this.call('retrievePaymentIntentOwner', () =>
        client.paymentIntents.retrieve(paymentIntentId),
      ),
      this.call('retrievePaymentIntentOwner', () =>
        client.invoicePayments.list({
          payment: { type: 'payment_intent', payment_intent: paymentIntentId },
          expand: ['data.invoice'],
          limit: 1,
        }),
      ),
    ]);
    const invoice = invoicePayments.data[0]?.invoice;
    return {
      paymentIntentId: paymentIntent.id,
      metadata: { ...paymentIntent.metadata },
      subscriptionMetadata:
        invoice === undefined ||
        typeof invoice === 'string' ||
        'deleted' in invoice
          ? null
          : subscriptionMetadataOf(invoice),
    };
  }

  private requireClient(): Stripe {
    if (this.client === undefined) {
      throw new StripeUnavailableError(
        'Stripeのキーが未設定のため、決済を利用できません',
      );
    }
    return this.client;
  }

  private async call<T>(
    operation: StripeOperation,
    request: () => Promise<T>,
  ): Promise<T> {
    try {
      return await request();
    } catch (error) {
      throw this.failure(operation, error);
    }
  }

  // Stripeの例外の文言は送った値(メールアドレスなど)を含み得るため、文言も元の例外も引き継がない
  private failure(operation: StripeOperation, error: unknown): Error {
    if (!(error instanceof Stripe.errors.StripeError)) {
      return error instanceof Error
        ? error
        : new Error('Stripeの操作で想定外の値が投げられました');
    }
    const outcome = outcomeOf(error);
    if (outcome === 'not_found') {
      return new StripeNotFoundError(`Stripeに対象がありません(${operation})`);
    }
    const stripeErrorCode = stripeErrorCodeOf(error);
    this.logger.warn('Stripeの操作に失敗しました', {
      operation,
      outcome,
      statusCode: error.statusCode,
      stripeErrorCode,
      requestId: error.requestId,
    });
    if (outcome === 'unavailable') {
      return new StripeUnavailableError(
        `Stripeの操作が一時的に失敗しました(${operation})`,
      );
    }
    return new StripeRejectedError({
      message: `Stripeが操作を拒否しました(${operation}・${stripeErrorCode})`,
      stripeErrorCode,
    });
  }

  private usablePrice(price: Stripe.Price): StripePrice[] {
    const lookupKey = price.lookup_key;
    if (lookupKey === null) {
      return [];
    }
    const resolved = resolvePrice(price, lookupKey);
    if (resolved.kind === 'usable') {
      return [resolved.price];
    }
    this.logger.warn('決済に使えない形のStripeの価格を除きました', {
      // 属性名にkeyを含むと伏せ字になるため、lookup_keyは別の名前で添える
      priceLookup: lookupKey,
      priceId: price.id,
      reason: resolved.reason,
    });
    return [];
  }

  // clientを渡すと、定期課金の初回の請求の支払いからLinkの資金源のグループを取得し直す
  private async toSnapshot(
    session: Stripe.Checkout.Session,
    client: Stripe | null,
  ): Promise<StripeCheckoutSessionSnapshot> {
    const { status } = session;
    if (!includes(SESSION_STATUSES, status)) {
      throw unexpectedValue('決済セッション', 'status', status);
    }
    const paymentStatus = session.payment_status;
    if (!includes(PAYMENT_STATUSES, paymentStatus)) {
      throw unexpectedValue('決済セッション', 'payment_status', paymentStatus);
    }
    // 定期課金の決済セッションはPaymentIntentを直接持たないため、初回の請求の既定の支払いから辿る
    const paymentIntent =
      session.payment_intent ?? invoicePaymentIntentOf(session.invoice);
    return {
      id: session.id,
      status,
      paymentStatus,
      clientSecret: session.client_secret,
      amountTotal: session.amount_total,
      currency: session.currency,
      expiresAt: new Date(session.expires_at * 1000),
      paymentIntentId: idOf(paymentIntent),
      invoiceId: idOf(session.invoice),
      subscriptionId: idOf(session.subscription),
      linkFundingSourceGroup: await this.linkFundingSourceGroup(
        paymentIntent,
        client,
      ),
      metadata: { ...session.metadata },
    };
  }

  private async linkFundingSourceGroup(
    paymentIntent: string | Stripe.PaymentIntent | null,
    client: Stripe | null,
  ): Promise<string | null> {
    if (paymentIntent === null) {
      return null;
    }
    if (typeof paymentIntent !== 'string') {
      return linkFundingSourceGroupOf(paymentIntent.latest_charge);
    }
    if (client === null) {
      return null;
    }
    const retrieved = await this.call('retrieveCheckoutSession', () =>
      client.paymentIntents.retrieve(paymentIntent, {
        expand: ['latest_charge'],
      }),
    );
    return linkFundingSourceGroupOf(retrieved.latest_charge);
  }
}
