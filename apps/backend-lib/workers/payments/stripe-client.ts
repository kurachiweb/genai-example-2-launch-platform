import Stripe from 'stripe';

import { STRIPE_API_VERSION } from '../../core/payments/stripe-api-version.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

export interface StripeClientOptions {
  readonly appName: LoggingOptions['appName'];
  readonly apiKey: string | undefined;
  // 省略するとworkerdのfetchを使う。テストは通信を止める代わりを渡す
  readonly fetch?: typeof fetch;
}

export const STRIPE_TIMEOUT_MS = 10_000;

// 利用者が待つ決済の開始(api)は早く失敗を返し、利用者を待たせない通知の反映(event)は多めに再試行する
export const STRIPE_MAX_NETWORK_RETRIES: Readonly<
  Record<LoggingOptions['appName'], number>
> = Object.freeze({ api: 1, event: 2 });

// キーが無い環境(ローカルとCI)ではクライアントを作らず、各操作が一時的な失敗として縮退する
export function createStripeClient(
  options: StripeClientOptions,
): Stripe | undefined {
  const { apiKey } = options;
  if (apiKey === undefined || apiKey === '') {
    return undefined;
  }
  return new Stripe(apiKey, {
    apiVersion: STRIPE_API_VERSION,
    httpClient: Stripe.createFetchHttpClient(options.fetch),
    maxNetworkRetries: STRIPE_MAX_NETWORK_RETRIES[options.appName],
    timeout: STRIPE_TIMEOUT_MS,
  });
}
