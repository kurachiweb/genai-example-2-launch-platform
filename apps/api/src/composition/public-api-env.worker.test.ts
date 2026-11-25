import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import {
  EnvValidationError,
  validateEnv,
} from '../../lib/core/env/env-schema.ts';
import { apiEnvSchema } from './env-schema.ts';

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

describe('apiEnvSchemaの公開APIの設定', () => {
  test('Workers統合テストの環境は公開APIのIP制限のバインディングとローカルの画像配信のオリジンを持ち、検証を通る', () => {
    const validated = validateEnv(apiEnvSchema, copyEnv());

    expect(validated.PUBLIC_API_RATE_LIMITER).toBe(env.PUBLIC_API_RATE_LIMITER);
    expect(validated.IMAGES_ORIGIN).toBe('http://localhost:48043');
  });

  test.each(['PUBLIC_API_RATE_LIMITER', 'IMAGES_ORIGIN'])(
    '%sが無ければ欠けたキーとして検証が失敗する',
    (key) => {
      const error = captureValidationError(copyEnv({}, [key]));

      expect(error.missingKeys).toEqual([key]);
      expect(error.invalidKeys).toEqual([]);
    },
  );

  test('公開APIのIP制限がオブジェクトでなければ不正なキーとして検証が失敗する', () => {
    const error = captureValidationError(
      copyEnv({ PUBLIC_API_RATE_LIMITER: 'not-a-binding' }),
    );

    expect(error.invalidKeys).toEqual(['PUBLIC_API_RATE_LIMITER']);
  });

  test.each([
    '',
    'images.example',
    'https://images.example/',
    'https://images.example/path',
    'ftp://images.example',
  ])(
    '画像配信のオリジンがhttp・httpsのオリジンでない値「%s」なら不正なキーとして検証が失敗する',
    (value) => {
      const error = captureValidationError(copyEnv({ IMAGES_ORIGIN: value }));

      expect(error.invalidKeys).toEqual(['IMAGES_ORIGIN']);
      expect(error.missingKeys).toEqual([]);
    },
  );

  test('デプロイ先の画像配信のオリジンを受け付ける', () => {
    const validated = validateEnv(
      apiEnvSchema,
      copyEnv({ IMAGES_ORIGIN: 'https://images.example' }),
    );

    expect(validated.IMAGES_ORIGIN).toBe('https://images.example');
  });
});
