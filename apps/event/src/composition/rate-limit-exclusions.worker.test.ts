import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import {
  createWebhookTestApp,
  eventBody,
  invokeApp,
  postWebhook,
  RECEIVED,
  stubReflector,
  WEBHOOK_BASE_URL,
} from '../presentation/payments/testing/stripe-webhook-harness.ts';
import { RATE_LIMIT_EXCLUSIONS } from './rate-limit-exclusions.ts';

// IP単位の制限の計数を他のテストファイルと分けるため、このファイルだけの接続元にする
const BURST_IP = '203.0.113.82';
const IP_LIMIT = 100;
const PERIOD_MILLISECONDS = 10_000;
const BURST_MARGIN_MILLISECONDS = 4_000;
const BURST_TEST_TIMEOUT_MILLISECONDS = 30_000;

// Miniflareのバインディングは壁時計にそろえた10秒の期間で数えるため、連続した要求が期間の切り替わりをまたがないように待つ
async function waitForFreshWindow(): Promise<void> {
  const remaining = PERIOD_MILLISECONDS - (Date.now() % PERIOD_MILLISECONDS);
  if (remaining < BURST_MARGIN_MILLISECONDS) {
    await scheduler.wait(remaining + 100);
  }
}

describe('RATE_LIMIT_EXCLUSIONS', () => {
  test(
    '同じIPからのStripeのWebhookは101回目の要求でもIP制限で429にならず、回数に数えられない',
    async () => {
      await waitForFreshWindow();
      const { app } = createWebhookTestApp(
        stubReflector({ kind: 'ignored' }),
        RATE_LIMIT_EXCLUSIONS,
      );
      const statuses: number[] = [];
      for (let index = 0; index < IP_LIMIT; index += 1) {
        const response = await postWebhook(app, {
          body: eventBody(),
          signature: null,
          ip: BURST_IP,
        });
        statuses.push(response.status);
        await response.body?.cancel();
      }

      const signed = await postWebhook(app, {
        body: eventBody(),
        ip: BURST_IP,
      });
      const health = await invokeApp(
        app,
        new Request(`${WEBHOOK_BASE_URL}/health`, {
          headers: { 'CF-Connecting-IP': BURST_IP },
        }),
        env,
      );

      expect(statuses.every((status) => status === 400)).toBe(true);
      expect(signed.status).toBe(200);
      expect(await signed.json()).toStrictEqual(RECEIVED);
      expect(health.status).toBe(200);
    },
    BURST_TEST_TIMEOUT_MILLISECONDS,
  );

  test.each([
    { method: 'POST', path: '/webhooks/stripe', excluded: true },
    { method: 'POST', path: '/webhooks/stripe/extra', excluded: true },
    { method: 'GET', path: '/webhooks/stripe', excluded: false },
    { method: 'POST', path: '/webhooks/stripe-other', excluded: false },
    { method: 'POST', path: '/webhooks', excluded: false },
  ])(
    '$method $pathはWebhookの除外に当たるか: $excluded',
    ({ method, path, excluded }) => {
      const request = new Request(`${WEBHOOK_BASE_URL}${path}`, { method });

      expect(
        RATE_LIMIT_EXCLUSIONS.some((exclusion) => exclusion(request, env)),
      ).toBe(excluded);
    },
  );
});
