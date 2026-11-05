import { resetSync } from '@logtape/logtape';
import Stripe from 'stripe';
import { afterAll, describe, expect, test } from 'vitest';

import {
  STRIPE_SIGNATURE_TOLERANCE_SECONDS,
  StripeSignatureError,
  StripeUnavailableError,
} from '../../core/payments/ports.ts';
import { StripeWebhookSignatureVerifier } from './stripe-webhook-verifier.ts';
import { recordLogs } from './testing/fake-stripe.ts';

// シークレットの検出に実在の秘密と誤認させないよう、連結で組み立てる
const WEBHOOK_SECRET = ['whsec', 'VerifierTest'].join('_');
const OTHER_WEBHOOK_SECRET = ['whsec', 'OtherVerifierTest'].join('_');

const cryptoProvider = Stripe.createSubtleCryptoProvider();

const EVENT_CREATED_SECONDS = 1_793_880_000;

const RAW_BODY = JSON.stringify({
  id: 'evt_test_1',
  object: 'event',
  type: 'checkout.session.completed',
  created: EVENT_CREATED_SECONDS,
  livemode: false,
  data: {
    object: {
      id: 'cs_test_1',
      object: 'checkout.session',
      customer_details: { email: 'taro.yamada@mail.example' },
    },
  },
});

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sign(
  payload: string,
  options: { readonly secret?: string; readonly timestamp?: number } = {},
): Promise<string> {
  return Stripe.webhooks.generateTestHeaderStringAsync({
    payload,
    secret: options.secret ?? WEBHOOK_SECRET,
    timestamp: options.timestamp ?? nowSeconds(),
    cryptoProvider,
  });
}

function verifier(
  webhookSecret: string | undefined,
): StripeWebhookSignatureVerifier {
  return new StripeWebhookSignatureVerifier({
    appName: 'event',
    webhookSecret,
  });
}

afterAll(() => {
  resetSync();
});

describe('StripeWebhookSignatureVerifier', () => {
  test('時刻の許容は5分である', () => {
    expect(STRIPE_SIGNATURE_TOLERANCE_SECONDS).toBe(300);
  });

  test('正しい署名の通知を受け入れ、Stripeの型を含まない形にする', async () => {
    const header = await sign(RAW_BODY);

    const event = await verifier(WEBHOOK_SECRET).verify(RAW_BODY, header);

    expect(event).toStrictEqual({
      id: 'evt_test_1',
      type: 'checkout.session.completed',
      created: EVENT_CREATED_SECONDS,
      data: { object: { id: 'cs_test_1' } },
    });
  });

  test('5分以内の時刻の署名を受け入れる', async () => {
    const header = await sign(RAW_BODY, {
      timestamp: nowSeconds() - STRIPE_SIGNATURE_TOLERANCE_SECONDS + 10,
    });

    await expect(
      verifier(WEBHOOK_SECRET).verify(RAW_BODY, header),
    ).resolves.toMatchObject({
      id: 'evt_test_1',
    });
  });

  test.each<[string, () => Promise<[string, string | null]>]>([
    [
      '本文が改ざんされている',
      async () => [
        RAW_BODY.replace('cs_test_1', 'cs_test_2'),
        await sign(RAW_BODY),
      ],
    ],
    ['署名が無い', () => Promise.resolve([RAW_BODY, null])],
    ['署名が空である', () => Promise.resolve([RAW_BODY, ''])],
    [
      '別の秘密で署名されている',
      async () => [
        RAW_BODY,
        await sign(RAW_BODY, { secret: OTHER_WEBHOOK_SECRET }),
      ],
    ],
    [
      '署名の時刻が5分を超えて古い',
      async () => [
        RAW_BODY,
        await sign(RAW_BODY, {
          timestamp: nowSeconds() - STRIPE_SIGNATURE_TOLERANCE_SECONDS - 10,
        }),
      ],
    ],
    [
      '署名の形式が不正である',
      () => Promise.resolve([RAW_BODY, 't=abc,v1=xyz']),
    ],
  ])('%sなら署名の不正として拒否する', async (_, arrange) => {
    const [rawBody, header] = await arrange();

    const rejection = verifier(WEBHOOK_SECRET).verify(rawBody, header);

    await expect(rejection).rejects.toBeInstanceOf(StripeSignatureError);
    await expect(rejection).rejects.not.toHaveProperty('cause');
  });

  test.each<[string, string]>([
    ['JSONでない', 'not-json'],
    ['通知のIDが無い', JSON.stringify({ type: 'x', created: 1, data: {} })],
    [
      '対象のIDが文字列でない',
      JSON.stringify({
        id: 'evt_test_1',
        type: 'checkout.session.completed',
        created: EVENT_CREATED_SECONDS,
        data: { object: { id: 1 } },
      }),
    ],
    [
      '発生時刻が数でない',
      JSON.stringify({
        id: 'evt_test_1',
        type: 'checkout.session.completed',
        created: '1793880000',
        data: { object: { id: 'cs_test_1' } },
      }),
    ],
  ])(
    '署名が正しくても本文が%sなら署名の不正として拒否する',
    async (_, rawBody) => {
      const header = await sign(rawBody);

      await expect(
        verifier(WEBHOOK_SECRET).verify(rawBody, header),
      ).rejects.toBeInstanceOf(StripeSignatureError);
    },
  );

  test.each<[string, string | undefined]>([
    ['未設定', undefined],
    ['空', ''],
  ])(
    '署名の秘密が%sなら検証せずに一時的な失敗にする',
    async (_, webhookSecret) => {
      const header = await sign(RAW_BODY);

      await expect(
        verifier(webhookSecret).verify(RAW_BODY, header),
      ).rejects.toBeInstanceOf(StripeUnavailableError);
    },
  );

  test('拒否のログに署名の秘密・署名・本文を出さない', async () => {
    const logs = recordLogs('event');
    const tampered = RAW_BODY.replace('cs_test_1', 'cs_test_2');
    const header = await sign(RAW_BODY);

    await expect(
      verifier(WEBHOOK_SECRET).verify(tampered, header),
    ).rejects.toBeInstanceOf(StripeSignatureError);

    expect(logs).not.toHaveLength(0);
    const output = JSON.stringify(logs);
    expect(output).not.toContain(WEBHOOK_SECRET);
    expect(output).not.toContain(header);
    expect(output).not.toContain('cs_test_2');
    expect(output).not.toContain('taro.yamada');
  });
});
