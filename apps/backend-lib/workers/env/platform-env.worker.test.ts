import { env } from 'cloudflare:workers';
import { describe, expect, expectTypeOf, test } from 'vitest';
import { z } from 'zod';

import { EnvValidationError, validateEnv } from '../../core/env/env-schema.ts';
import { type PlatformEnv, platformEnvShape } from './platform-env.ts';

const platformEnvSchema = z.object(platformEnvShape);

function copyEnv(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { ...env, ...overrides };
}

function withoutKeys(keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(copyEnv()).filter(([key]) => !keys.includes(key)),
  );
}

function captureValidationError(
  candidate: unknown,
  schema: z.ZodType = platformEnvSchema,
): EnvValidationError {
  try {
    validateEnv(schema, candidate);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('失敗するはずの検証が成功した');
}

describe('platformEnvShape', () => {
  test('テスト環境のバインディングと設定値を受け付け、PlatformEnvとして取り出せる', () => {
    const validated = validateEnv(platformEnvSchema, copyEnv());

    expectTypeOf(validated).toExtend<PlatformEnv>();
    expect(validated.DB).toBe(env.DB);
    expect(validated.IMAGES_BUCKET).toBe(env.IMAGES_BUCKET);
    expect(validated.FILES_BUCKET).toBe(env.FILES_BUCKET);
    expect(validated.QUARANTINE_BUCKET).toBe(env.QUARANTINE_BUCKET);
    expect(validated.JOBS_QUEUE).toBe(env.JOBS_QUEUE);
    expect(validated.IP_RATE_LIMITER).toBe(env.IP_RATE_LIMITER);
    expect(validated.HASH_PEPPER).toBe(env.HASH_PEPPER);
    expect(validated.LOG_LEVEL).toBe(env.LOG_LEVEL);
  });

  test('バインディング・シークレット・設定値が欠けると、欠けたキー名だけを持つ失敗になる', () => {
    const error = captureValidationError(
      withoutKeys(['DB', 'JOBS_QUEUE', 'HASH_PEPPER', 'LOG_LEVEL']),
    );

    expect(error.missingKeys).toEqual([
      'DB',
      'HASH_PEPPER',
      'JOBS_QUEUE',
      'LOG_LEVEL',
    ]);
    expect(error.invalidKeys).toEqual([]);
  });

  test('不正な値はキー名だけを不正なキーとして返し、値を例外に含めない', () => {
    const rejectedPepper = ['rejected', 'pepper', 'value'].join('-');

    const error = captureValidationError(
      copyEnv({
        DB: 'not-a-binding',
        HASH_PEPPER: rejectedPepper,
        LOG_LEVEL: 'verbose',
        SENTRY_ENVIRONMENT: '',
        SENTRY_TRACES_SAMPLE_RATE: '1.5',
        SENTRY_DSN: 404,
      }),
    );

    expect(error.missingKeys).toEqual([]);
    expect(error.invalidKeys).toEqual([
      'DB',
      'LOG_LEVEL',
      'SENTRY_DSN',
      'SENTRY_ENVIRONMENT',
      'SENTRY_TRACES_SAMPLE_RATE',
    ]);
    expect(error.message).not.toContain(rejectedPepper);
    expect(error.message).not.toContain('verbose');
  });

  test('空のペッパーは不正なキーになる', () => {
    const error = captureValidationError(copyEnv({ HASH_PEPPER: '' }));

    expect(error.invalidKeys).toEqual(['HASH_PEPPER']);
  });

  test.each(['debug', 'info', 'warning', 'error'])(
    'ログレベル%sを受け付ける',
    (level) => {
      const validated = validateEnv(
        platformEnvSchema,
        copyEnv({ LOG_LEVEL: level }),
      );

      expect(validated.LOG_LEVEL).toBe(level);
    },
  );

  test.each(['0', '0.1', '0.25', '1', '1.0'])(
    'トレースのサンプリング率%sを受け付ける',
    (rate) => {
      const validated = validateEnv(
        platformEnvSchema,
        copyEnv({ SENTRY_TRACES_SAMPLE_RATE: rate }),
      );

      expect(validated.SENTRY_TRACES_SAMPLE_RATE).toBe(rate);
    },
  );

  test.each(['', ' ', '-0.1', '1.01', '2', 'abc', '.5', '0x1', '1e-1'])(
    'トレースのサンプリング率%jは不正なキーになる',
    (rate) => {
      const error = captureValidationError(
        copyEnv({ SENTRY_TRACES_SAMPLE_RATE: rate }),
      );

      expect(error.invalidKeys).toEqual(['SENTRY_TRACES_SAMPLE_RATE']);
    },
  );

  test('Sentryの送信先は省略でき、設定されていればそのまま取り出せる', () => {
    const dsn = ['https://', 'public', '@sentry.launch.example/1'].join('');

    const withoutDsn = validateEnv(
      platformEnvSchema,
      withoutKeys(['SENTRY_DSN']),
    );
    const withDsn = validateEnv(
      platformEnvSchema,
      copyEnv({ SENTRY_DSN: dsn }),
    );

    expect(withoutDsn.SENTRY_DSN).toBeUndefined();
    expect(withDsn.SENTRY_DSN).toBe(dsn);
  });

  test('アプリのスキーマは断片を広げて独自のキーを足せる', () => {
    const appEnvSchema = z.object({
      ...platformEnvShape,
      APP_ONLY_SETTING: z.string().min(1),
    });

    const error = captureValidationError(
      withoutKeys(['HASH_PEPPER']),
      appEnvSchema,
    );

    expect(error.missingKeys).toEqual(['APP_ONLY_SETTING', 'HASH_PEPPER']);
  });
});
