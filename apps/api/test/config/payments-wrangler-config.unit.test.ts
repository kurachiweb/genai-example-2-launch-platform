import { describe, expect, test } from 'bun:test';

import { z } from 'zod';

import {
  PAYMENTS_CONFIG_KEY_PATTERN,
  readWranglerConfig,
  type WranglerAppName,
} from '../support/wrangler-config.ts';

const paymentsConfigSchema = z.object({
  vars: z.record(z.string(), z.unknown()),
  secrets: z.object({ required: z.array(z.string()) }).optional(),
});

type PaymentsConfig = z.infer<typeof paymentsConfigSchema>;

const STRIPE_SECRET_KEYS = ['STRIPE_API_KEY', 'STRIPE_WEBHOOK_SECRET'] as const;

interface ExpectedPaymentsEnvironment {
  readonly label: string;
  readonly wranglerEnv: string | undefined;
  readonly smokeEnabled: 'true' | 'false';
  readonly requiredApiSecrets: readonly string[];
  readonly requiredEventSecrets: readonly string[];
}

const EXPECTED_ENVIRONMENTS: readonly ExpectedPaymentsEnvironment[] = [
  {
    label: 'ローカル(ルート)',
    wranglerEnv: undefined,
    smokeEnabled: 'true',
    // ローカルはStripeのキーを注入せずに起動し、決済の機能だけを縮退させる
    requiredApiSecrets: [],
    requiredEventSecrets: [],
  },
  {
    label: 'staging',
    wranglerEnv: 'staging',
    smokeEnabled: 'true',
    requiredApiSecrets: ['STRIPE_API_KEY'],
    requiredEventSecrets: ['STRIPE_API_KEY', 'STRIPE_WEBHOOK_SECRET'],
  },
  {
    label: 'prod',
    wranglerEnv: 'prod',
    smokeEnabled: 'false',
    requiredApiSecrets: ['STRIPE_API_KEY'],
    requiredEventSecrets: ['STRIPE_API_KEY', 'STRIPE_WEBHOOK_SECRET'],
  },
];

function readConfig(
  app: WranglerAppName,
  wranglerEnv: string | undefined,
): PaymentsConfig {
  return paymentsConfigSchema.parse(readWranglerConfig(app, wranglerEnv));
}

function paymentsKeysOf(keys: readonly string[]): string[] {
  return keys.filter((key) => PAYMENTS_CONFIG_KEY_PATTERN.test(key));
}

function pickPaymentsEntries(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) =>
      PAYMENTS_CONFIG_KEY_PATTERN.test(key),
    ),
  );
}

describe.each(EXPECTED_ENVIRONMENTS)('決済のWrangler設定($label)', (env) => {
  const api = readConfig('api', env.wranglerEnv);
  const event = readConfig('event', env.wranglerEnv);

  test('APIサーバーとイベントサーバーが環境ごとの疎通確認の有無の変数だけを決済の変数に持つ', () => {
    for (const config of [api, event]) {
      expect(pickPaymentsEntries(config.vars)).toStrictEqual({
        PAYMENTS_SMOKE_ENABLED: env.smokeEnabled,
      });
    }
  });

  test('APIサーバーの決済の必須シークレットは、デプロイ先でだけ制限付きキーである', () => {
    expect(paymentsKeysOf(api.secrets?.required ?? [])).toEqual([
      ...env.requiredApiSecrets,
    ]);
  });

  test('イベントサーバーの決済の必須シークレットは、デプロイ先でだけ制限付きキーとWebhookの署名の秘密である', () => {
    expect(paymentsKeysOf(event.secrets?.required ?? [])).toEqual([
      ...env.requiredEventSecrets,
    ]);
  });

  test('Stripeのキーと署名の秘密を変数に書かない', () => {
    for (const config of [api, event]) {
      for (const key of STRIPE_SECRET_KEYS) {
        expect(Object.keys(config.vars)).not.toContain(key);
      }
    }
  });

  test('決済後の戻り先を組み立てるイベントサーバーの利用者側のオリジンが、APIサーバーと同じ値である', () => {
    expect(event.vars['CLIENT_SITE_ORIGIN']).toBeString();
    expect(event.vars['CLIENT_SITE_ORIGIN']).toBe(
      api.vars['CLIENT_SITE_ORIGIN'],
    );
  });
});
