import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import {
  EnvValidationError,
  validateEnv,
} from '../../lib/core/env/env-schema.ts';
import { apiEnvSchema } from './env-schema.ts';

const DISIFY_API_KEY = ['disify', 'test', 'key'].join('-');

const restrictedKeyOf = (mode: string): string =>
  ['rk', mode, 'Ab1'.repeat(8)].join('_');

function copyEnv(
  overrides: Record<string, unknown> = {},
  removedKeys: readonly string[] = [],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({ ...env, ...overrides }).filter(
      ([key]) => !removedKeys.includes(key),
    ),
  );
}

function captureValidationError(candidate: unknown): EnvValidationError {
  try {
    validateEnv(apiEnvSchema, candidate);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('失敗するはずの検証が成功した');
}

describe('apiEnvSchemaの決済の設定', () => {
  test('Workers統合テストの環境はテストモードの制限付きキーを持ち、疎通確認を有効にする', () => {
    expect(String(env.STRIPE_API_KEY).startsWith('rk_test_')).toBe(true);
    expect(env.PAYMENTS_SMOKE_ENABLED).toBe('true');
  });

  test.each(['local', 'staging', 'prod'])(
    '%sではStripeのキーが無くても受け付ける',
    (environment) => {
      expect(() =>
        validateEnv(
          apiEnvSchema,
          copyEnv({ APP_ENVIRONMENT: environment, DISIFY_API_KEY }, [
            'STRIPE_API_KEY',
          ]),
        ),
      ).not.toThrow();
    },
  );

  test.each(['test', 'live'])('%sモードの制限付きキーを受け付ける', (mode) => {
    expect(() =>
      validateEnv(
        apiEnvSchema,
        copyEnv({ STRIPE_API_KEY: restrictedKeyOf(mode) }),
      ),
    ).not.toThrow();
  });

  test.each([
    '',
    ['sk', 'live', 'Ab1'.repeat(8)].join('_'),
    ['pk', 'test', 'Ab1'.repeat(8)].join('_'),
    ['rk', 'prod', 'Ab1'.repeat(8)].join('_'),
    'rk_test_',
    'restricted-key-value-must-not-leak',
  ])(
    '制限付きキーの形式でないStripeのキー%pは、値を含めずにキー名だけを不正なキーにする',
    (value) => {
      const error = captureValidationError(copyEnv({ STRIPE_API_KEY: value }));

      expect(error.invalidKeys).toEqual(['STRIPE_API_KEY']);
      expect(error.missingKeys).toEqual([]);
      if (value !== '') {
        expect(error.message).not.toContain(value);
      }
    },
  );

  test('疎通確認の有無の変数が欠けると、そのキー名だけを欠けたキーにする', () => {
    const error = captureValidationError(
      copyEnv({}, ['PAYMENTS_SMOKE_ENABLED']),
    );

    expect(error.missingKeys).toEqual(['PAYMENTS_SMOKE_ENABLED']);
    expect(error.invalidKeys).toEqual([]);
  });

  test.each(['yes', 'TRUE', '1', ''])(
    '疎通確認の有無の変数が真偽の文字列でない%pなら、そのキー名だけを不正なキーにする',
    (value) => {
      const error = captureValidationError(
        copyEnv({ PAYMENTS_SMOKE_ENABLED: value }),
      );

      expect(error.invalidKeys).toEqual(['PAYMENTS_SMOKE_ENABLED']);
    },
  );

  test('決済の設定の誤りは他の設定の誤りと一緒に報告する', () => {
    const error = captureValidationError(
      copyEnv({ STRIPE_API_KEY: 'restricted-key-value-must-not-leak' }, [
        'TURNSTILE_SECRET_KEY',
      ]),
    );

    expect(error.missingKeys).toEqual(['TURNSTILE_SECRET_KEY']);
    expect(error.invalidKeys).toEqual(['STRIPE_API_KEY']);
  });
});
