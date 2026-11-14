import { inject, injectable } from 'inversify';

import { PAYMENTS_UNAVAILABLE_MESSAGE } from '../../../common-lib/payments/payments-unavailable-texts.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { PAYMENTS_TYPES } from '../../../lib/core/payments/identifiers.ts';
import {
  type PaymentReflector,
  type ReflectionOutcome,
  StripeSignatureError,
  StripeUnavailableError,
  type StripeWebhookVerifier,
  type VerifiedStripeEvent,
} from '../../../lib/core/payments/ports.ts';
import { mapStripeEvent } from '../../../lib/core/payments/stripe-event-mapping.ts';

export interface StripeWebhookReceipt {
  readonly eventId: string;
  readonly eventType: string;
  readonly outcome: ReflectionOutcome['kind'];
}

export interface StripeWebhookReceiver {
  // 署名の不正は400、署名の秘密の未設定は503の共通エラー。反映の失敗はStripeWebhookReflectionError
  receive(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<StripeWebhookReceipt>;
}

// 共通エラーにしないのは、Stripeに再送させる500の応答とエラートラッキングへの通知の対象にするため
export class StripeWebhookReflectionError extends Error {
  override readonly name = 'StripeWebhookReflectionError';
  readonly eventId: string;
  readonly eventType: string;

  constructor(
    event: Pick<VerifiedStripeEvent, 'id' | 'type'>,
    options: ErrorOptions,
  ) {
    super('Stripeの通知を反映できませんでした', options);
    this.eventId = event.id;
    this.eventType = event.type;
  }
}

const logger = getAppLogger(['event', 'payments', 'webhook']);

function signatureInvalidError(): AppError {
  return new AppError({
    kind: 'bad_request',
    code: 'stripe_signature_invalid',
    message: '通知の署名を検証できませんでした。',
  });
}

function paymentsUnavailableError(): AppError {
  return new AppError({
    kind: 'unavailable',
    code: 'payments_unavailable',
    message: PAYMENTS_UNAVAILABLE_MESSAGE,
  });
}

@injectable()
export class SignedStripeWebhookReceiver implements StripeWebhookReceiver {
  constructor(
    @inject(PAYMENTS_TYPES.StripeWebhookVerifier)
    private readonly verifier: StripeWebhookVerifier,
    @inject(PAYMENTS_TYPES.PaymentReflector)
    private readonly reflector: PaymentReflector,
  ) {}

  async receive(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<StripeWebhookReceipt> {
    const event = await this.verify(rawBody, signatureHeader);
    let outcome: ReflectionOutcome;
    try {
      outcome = await this.reflector.reflect(mapStripeEvent(event));
    } catch (error) {
      throw new StripeWebhookReflectionError(event, { cause: error });
    }
    const receipt: StripeWebhookReceipt = {
      eventId: event.id,
      eventType: event.type,
      outcome: outcome.kind,
    };
    logger.info('Stripeの通知を受け付けました', { ...receipt });
    return receipt;
  }

  private async verify(
    rawBody: string,
    signatureHeader: string | null,
  ): Promise<VerifiedStripeEvent> {
    try {
      return await this.verifier.verify(rawBody, signatureHeader);
    } catch (error) {
      if (error instanceof StripeSignatureError) {
        throw signatureInvalidError();
      }
      if (error instanceof StripeUnavailableError) {
        throw paymentsUnavailableError();
      }
      throw error;
    }
  }
}
