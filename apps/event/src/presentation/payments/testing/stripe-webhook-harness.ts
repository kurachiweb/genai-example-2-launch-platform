import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import { ContainerModule } from 'inversify';
import Stripe from 'stripe';
import { z } from 'zod';

import type { AppModule } from '../../../../lib/core/di/app-module.ts';
import { PLATFORM_TYPES } from '../../../../lib/core/di/identifiers.ts';
import { PAYMENTS_TYPES } from '../../../../lib/core/payments/identifiers.ts';
import type {
  PaymentReflector,
  ReflectionOutcome,
  StripeWebhookVerifier,
} from '../../../../lib/core/payments/ports.ts';
import { platformEnvShape } from '../../../../lib/workers/env/platform-env.ts';
import { createWorkerApp } from '../../../../lib/workers/http/create-worker-app.ts';
import type { PlatformHonoEnv } from '../../../../lib/workers/http/hono-env.ts';
import {
  buildSentryOptions,
  readSentryRuntimeOptions,
} from '../../../../lib/workers/observability/sentry.ts';
import { StripeWebhookSignatureVerifier } from '../../../../lib/workers/payments/stripe-webhook-verifier.ts';
import {
  OCCURRED_AT,
  sessionIdOf,
} from '../../../../lib/workers/payments/testing/checkout-reflection-harness.ts';
import type { RateLimitExclusion } from '../../../../lib/workers/rate-limit/exclusions.ts';
import { EVENT_PAYMENTS_TYPES } from '../../../application/payments/event-payments-types.ts';
import {
  SignedStripeWebhookReceiver,
  type StripeWebhookReceiver,
} from '../../../application/payments/stripe-webhook-receiver.ts';
import {
  registerStripeWebhookRoute,
  STRIPE_WEBHOOK_PATH,
} from '../stripe-webhook-route.ts';

export type WebhookTestEnv = typeof env;
export type WebhookTestApp = Hono<PlatformHonoEnv<WebhookTestEnv>>;

export interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface WebhookRequest {
  readonly body: string;
  // 省略すると、テストの環境の署名の秘密で本文に署名する。nullならヘッダーを付けない
  readonly signature?: string | null;
  readonly method?: string;
  // IP単位の制限の計数をテストファイルごとに分けるため、呼び出し側が接続元を決める
  readonly ip: string;
  readonly bindings?: WebhookTestEnv;
}

export interface StubReflector extends PaymentReflector {
  readonly calls: number[];
}

export const WEBHOOK_BASE_URL = 'https://event.launch.example';

// 本文の中で、ログとエラートラッキングへ漏れてはならない値
export const BODY_MARKER = 'body-marker-that-must-not-leak';

export const RECEIVED = { received: true };

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

const cryptoProvider = Stripe.createSubtleCryptoProvider();

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function eventBody(
  options: {
    readonly id?: string;
    readonly type?: string;
    readonly objectId?: string;
  } = {},
): string {
  return JSON.stringify({
    id: options.id ?? 'evt_test_route_1',
    object: 'event',
    type: options.type ?? 'checkout.session.completed',
    created: Math.floor(OCCURRED_AT.getTime() / 1000),
    livemode: false,
    data: {
      object: {
        id: options.objectId ?? sessionIdOf(1),
        object: 'checkout.session',
        customer_details: { email: 'taro.yamada@mail.example' },
        metadata: { marker: BODY_MARKER },
      },
    },
  });
}

export function sign(
  payload: string,
  options: { readonly secret?: string; readonly timestamp?: number } = {},
): Promise<string> {
  return Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: options.secret ?? env.STRIPE_WEBHOOK_SECRET ?? '',
    timestamp: options.timestamp ?? nowSeconds(),
    cryptoProvider,
  });
}

export function stubReflector(outcome: ReflectionOutcome): StubReflector {
  const calls: number[] = [];
  return {
    calls,
    reflect: () => {
      calls.push(calls.length + 1);
      return Promise.resolve(outcome);
    },
    reflectCheckoutSnapshot: () =>
      Promise.reject(new Error('Webhookの受け付けでは使わない')),
  };
}

// イベントサーバーの決済のモジュールが束縛する署名の検証と受け付けを、テストが渡す反映の処理と組み合わせる
function webhookModule(reflector: PaymentReflector): AppModule<WebhookTestApp> {
  return {
    name: 'test-stripe-webhook',
    bindings: new ContainerModule(({ bind }) => {
      bind<StripeWebhookVerifier>(
        PAYMENTS_TYPES.StripeWebhookVerifier,
      ).toDynamicValue(
        (context) =>
          new StripeWebhookSignatureVerifier({
            appName: 'event',
            webhookSecret: context.get<WebhookTestEnv>(PLATFORM_TYPES.Env)
              .STRIPE_WEBHOOK_SECRET,
          }),
      );
      bind<PaymentReflector>(PAYMENTS_TYPES.PaymentReflector).toConstantValue(
        reflector,
      );
      bind<StripeWebhookReceiver>(
        EVENT_PAYMENTS_TYPES.StripeWebhookReceiver,
      ).to(SignedStripeWebhookReceiver);
    }),
    routes: registerStripeWebhookRoute,
  };
}

function decodeBody(body: RequestInit['body']): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  throw new TypeError('想定外の送信本文の形式です');
}

// エンベロープは改行区切りのJSONで、先頭のヘッダーの後に項目のヘッダーと本体が交互に並ぶ
function parseEnvelope(text: string): SentItem[] {
  const [, ...lines] = text.split('\n').filter((line) => line !== '');
  const items: SentItem[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const header = JSON.parse(lines[index] ?? '') as { type: string };
    const payload = JSON.parse(lines[index + 1] ?? '') as Record<
      string,
      unknown
    >;
    items.push({ type: header.type, payload });
  }
  return items;
}

export function createWebhookTestApp(
  reflector: PaymentReflector,
  rateLimitExclusions: readonly RateLimitExclusion<WebhookTestEnv>[] = [],
): { readonly app: WebhookTestApp; readonly sentryItems: SentItem[] } {
  const sentryItems: SentItem[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    sentryItems.push(...parseEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  const app = createWorkerApp<WebhookTestEnv>({
    appName: 'event',
    envSchema: z.object(platformEnvShape),
    modules: [webhookModule(reflector)],
    rateLimitExclusions,
    // 呼び出しごとに送信先を差し替えて確かめるため、isolateでのクライアントの使い回しを切る
    sentry: (bindings) => ({
      ...buildSentryOptions({
        ...readSentryRuntimeOptions(bindings),
        dsn: TEST_DSN,
      }),
      cacheClient: false,
      transportOptions: { fetch: recordingFetch as typeof fetch },
    }),
  });
  return { app, sentryItems };
}

export async function invokeApp(
  app: WebhookTestApp,
  request: Request,
  bindings: WebhookTestEnv = env,
): Promise<Response> {
  const ctx = createExecutionContext();
  const response = await app.fetch(request, bindings, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

export async function postWebhook(
  app: WebhookTestApp,
  request: WebhookRequest,
): Promise<Response> {
  const headers = new Headers({
    'CF-Connecting-IP': request.ip,
    'Content-Type': 'application/json; charset=utf-8',
  });
  const signature =
    request.signature === undefined
      ? await sign(request.body)
      : request.signature;
  if (signature !== null) {
    headers.set('Stripe-Signature', signature);
  }
  const method = request.method ?? 'POST';
  return invokeApp(
    app,
    new Request(`${WEBHOOK_BASE_URL}${STRIPE_WEBHOOK_PATH}`, {
      method,
      headers,
      ...(method === 'GET' ? {} : { body: request.body }),
    }),
    request.bindings,
  );
}
