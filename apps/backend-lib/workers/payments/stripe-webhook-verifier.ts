import type { Logger } from '@logtape/logtape';
import Stripe from 'stripe';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import {
  STRIPE_SIGNATURE_TOLERANCE_SECONDS,
  StripeSignatureError,
  StripeUnavailableError,
  type StripeWebhookVerifier,
  type VerifiedStripeEvent,
} from '../../core/payments/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export interface StripeWebhookSignatureVerifierOptions {
  readonly appName: LoggingOptions['appName'];
  // STRIPE_WEBHOOK_SECRETが未設定ならundefined
  readonly webhookSecret: string | undefined;
}

type RejectionReason = 'missing_header' | 'unverified' | 'malformed_event';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function toVerifiedEvent(event: unknown): VerifiedStripeEvent | undefined {
  if (!isRecord(event) || !isRecord(event.data)) {
    return undefined;
  }
  const { id, type, created } = event;
  const { object } = event.data;
  if (
    typeof id !== 'string' ||
    typeof type !== 'string' ||
    typeof created !== 'number' ||
    !Number.isFinite(created) ||
    !isRecord(object) ||
    typeof object.id !== 'string'
  ) {
    return undefined;
  }
  return { id, type, created, data: { object: { id: object.id } } };
}

export class StripeWebhookSignatureVerifier implements StripeWebhookVerifier {
  private readonly webhookSecret: string | undefined;
  private readonly cryptoProvider = Stripe.createSubtleCryptoProvider();
  private readonly logger: Logger;

  constructor(options: StripeWebhookSignatureVerifierOptions) {
    this.webhookSecret = options.webhookSecret;
    this.logger = getAppLogger([options.appName, 'payments', 'webhook']);
  }

  async verify(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<VerifiedStripeEvent> {
    const secret = this.webhookSecret;
    if (secret === undefined || secret === '') {
      throw new StripeUnavailableError(
        'Webhookの署名の秘密が未設定のため、通知を検証できません',
      );
    }
    if (signatureHeader === null || signatureHeader === '') {
      throw this.rejection('missing_header');
    }
    const event = await this.construct(rawBody, signatureHeader, secret);
    const verified = toVerifiedEvent(event);
    if (verified === undefined) {
      throw this.rejection('malformed_event');
    }
    return verified;
  }

  private async construct(
    rawBody: string,
    signatureHeader: string,
    secret: string,
  ): Promise<unknown> {
    try {
      return await Stripe.webhooks.constructEventAsync(
        rawBody,
        signatureHeader,
        secret,
        STRIPE_SIGNATURE_TOLERANCE_SECONDS,
        this.cryptoProvider,
      );
    } catch (error) {
      if (error instanceof Stripe.errors.StripeSignatureVerificationError) {
        throw this.rejection('unverified');
      }
      // 署名の検証の後に本文をJSONとして解釈できなかった
      if (error instanceof SyntaxError) {
        throw this.rejection('malformed_event');
      }
      throw error;
    }
  }

  // SDKの例外は署名と本文を持つため、文言も元の例外も引き継がず、ログにも理由だけを出す
  private rejection(reason: RejectionReason): StripeSignatureError {
    this.logger.warn('Stripeの通知を署名の不正として拒否しました', {
      reason,
    });
    return new StripeSignatureError('Stripeの通知の署名を検証できません');
  }
}
