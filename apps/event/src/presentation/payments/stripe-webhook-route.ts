import { captureException, withScope } from '@sentry/cloudflare';
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { INTERNAL_ERROR_RESPONSE } from '../../../lib/core/errors/error-envelope.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type { PlatformEnv } from '../../../lib/workers/env/platform-env.ts';
import type { PlatformHonoEnv } from '../../../lib/workers/http/hono-env.ts';
import { EVENT_PAYMENTS_TYPES } from '../../application/payments/event-payments-types.ts';
import {
  type StripeWebhookReceiver,
  StripeWebhookReflectionError,
} from '../../application/payments/stripe-webhook-receiver.ts';

export const STRIPE_WEBHOOK_PATH = '/webhooks/stripe';

export const STRIPE_WEBHOOK_MAX_BODY_BYTES = 1024 * 1024;

const SIGNATURE_HEADER = 'Stripe-Signature';

const NO_STORE = { 'Cache-Control': 'no-store' };

const logger = getAppLogger(['event', 'payments', 'webhook']);

function payloadTooLargeError(): AppError {
  return new AppError({
    kind: 'payload_too_large',
    code: 'payload_too_large',
    message: 'リクエストの本文が大きすぎます。',
  });
}

// 本文には利用者の情報が含まれ得るため、ログとエラートラッキングには通知の種類とIDだけを渡す
function reportReflectionFailure(error: StripeWebhookReflectionError): void {
  const { eventId, eventType } = error;
  logger.error('Stripeの通知を反映できませんでした', {
    eventId,
    eventType,
    error: error.cause,
  });
  withScope((scope) => {
    scope.setTag('stripe_event_type', eventType);
    scope.setTag('stripe_event_id', eventId);
    captureException(error.cause);
  });
}

// 既定の超過の扱いはHonoのHTTPException(想定外の例外)を投げるため、共通エラーを投げて基盤の例外の変換に応答させる
function createBodyLimit<E extends PlatformEnv>(): MiddlewareHandler<
  PlatformHonoEnv<E>
> {
  return bodyLimit({
    maxSize: STRIPE_WEBHOOK_MAX_BODY_BYTES,
    onError: () => {
      throw payloadTooLargeError();
    },
  });
}

// 署名は受け取ったままの本文で検証するため、検証の前に本文を解釈しない。反映の失敗は500で返し、Stripeに再送させる
async function receiveWebhook<E extends PlatformEnv>(
  c: Context<PlatformHonoEnv<E>>,
): Promise<Response> {
  const rawBody = await c.req.text();
  const receiver = c
    .get('container')
    .get<StripeWebhookReceiver>(EVENT_PAYMENTS_TYPES.StripeWebhookReceiver);
  try {
    await receiver.receive(rawBody, c.req.header(SIGNATURE_HEADER) ?? null);
  } catch (error) {
    if (!(error instanceof StripeWebhookReflectionError)) {
      throw error;
    }
    reportReflectionFailure(error);
    return c.json(
      INTERNAL_ERROR_RESPONSE.body,
      INTERNAL_ERROR_RESPONSE.status,
      INTERNAL_ERROR_RESPONSE.headers,
    );
  }
  return c.json({ received: true }, 200, NO_STORE);
}

export function registerStripeWebhookRoute<E extends PlatformEnv>(
  app: Hono<PlatformHonoEnv<E>>,
): void {
  app.post(STRIPE_WEBHOOK_PATH, createBodyLimit<E>(), receiveWebhook<E>);
}
