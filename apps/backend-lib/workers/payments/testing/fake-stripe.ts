import type { StripeCheckoutSessionInput } from '../../../core/payments/ports.ts';
import { ensureLoggingConfigured } from '../../logging/configure-logging.ts';
import { createStripeClient } from '../stripe-client.ts';
import { StripeApiGateway } from '../stripe-gateway.ts';

export interface StripeCall {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly form: Readonly<Record<string, string>>;
  readonly headers: Headers;
}

export type StripeResponder = (
  call: StripeCall,
) => Response | Promise<Response>;

export interface FakeStripe {
  readonly fetch: typeof fetch;
  readonly calls: StripeCall[];
}

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface ConsoleCall {
  readonly method: ConsoleMethod;
  readonly args: readonly unknown[];
}

// シークレットの検出に実在の鍵と誤認させないよう、連結で組み立てる
export const FAKE_STRIPE_API_KEY = ['rk', 'test', 'FakeStripe'].join('_');
export const FAKE_CLIENT_SITE_ORIGIN = 'https://client.test.example';
export const FAKE_EMAIL = 'taro.yamada@mail.example';
export const FAKE_PSEUDONYMOUS_ID = 'psn_01JBQ6Z8Y3V4W5X6Y7Z8A9B0C1';
export const FAKE_PURCHASE_ID = '01JBQ6Z8Y3V4W5X6Y7Z8A9B0C2';
export const FAKE_EXPIRES_AT_SECONDS = 1_793_880_000;
export const FAKE_REQUEST_ID = 'req_test_gateway';

// Stripeへ通信せず、SDKが組み立てた要求を記録して、テストが決めた応答を返す
export function createFakeStripe(respond: StripeResponder): FakeStripe {
  const calls: StripeCall[] = [];
  const fakeFetch = async (
    input: Request | string | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = new TextDecoder().decode(await request.arrayBuffer());
    const call: StripeCall = {
      method: request.method,
      path: url.pathname,
      query: url.searchParams,
      form: Object.fromEntries(new URLSearchParams(body)),
      headers: request.headers,
    };
    calls.push(call);
    return respond(call);
  };
  return { fetch: fakeFetch as typeof fetch, calls };
}

export function stripeJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Request-Id': FAKE_REQUEST_ID,
      // 失敗の分類のテストで、SDKの自動の再試行を待たないようにする
      'Stripe-Should-Retry': 'false',
    },
  });
}

export function stripeError(
  status: number,
  error: Readonly<Record<string, string>>,
): Response {
  return stripeJson({ error }, status);
}

export function gatewayWith(
  fake: FakeStripe,
  appName: 'api' | 'event' = 'api',
): StripeApiGateway {
  return new StripeApiGateway({
    appName,
    client: createStripeClient({
      appName,
      apiKey: FAKE_STRIPE_API_KEY,
      fetch: fake.fetch,
    }),
    clientSiteOrigin: FAKE_CLIENT_SITE_ORIGIN,
  });
}

export function sessionObject(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: 'cs_test_1',
    object: 'checkout.session',
    mode: 'payment',
    status: 'open',
    payment_status: 'unpaid',
    client_secret: 'cs_test_1_secret_abc',
    amount_total: 4900,
    currency: 'usd',
    expires_at: FAKE_EXPIRES_AT_SECONDS,
    payment_intent: null,
    invoice: null,
    subscription: null,
    metadata: {
      purchase_id: FAKE_PURCHASE_ID,
      purchase_kind: 'payments_smoke',
      pseudonymous_id: FAKE_PSEUDONYMOUS_ID,
    },
    ...overrides,
  };
}

export function checkoutInput(
  overrides: Partial<StripeCheckoutSessionInput> = {},
): StripeCheckoutSessionInput {
  return {
    purchaseId: FAKE_PURCHASE_ID,
    mode: 'payment',
    customerId: 'cus_test_1',
    priceId: 'price_test_1',
    quantity: 3,
    expiresAt: new Date(FAKE_EXPIRES_AT_SECONDS * 1000),
    metadata: {
      purchase_id: FAKE_PURCHASE_ID,
      purchase_kind: 'payments_smoke',
      pseudonymous_id: FAKE_PSEUDONYMOUS_ID,
    },
    ...overrides,
  };
}

export function recordLogs(appName: 'api' | 'event' = 'api'): ConsoleCall[] {
  const calls: ConsoleCall[] = [];
  const record =
    (method: ConsoleMethod) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
    };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      trace: record('trace'),
      debug: record('debug'),
      info: record('info'),
      warn: record('warn'),
      error: record('error'),
    } as unknown as Console,
  });
  return calls;
}
