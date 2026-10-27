import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import {
  EnvValidationError,
  validateEnv,
} from '../../lib/core/env/env-schema.ts';
import { eventEnvSchema } from './env-schema.ts';

const SECRET_RECIPIENT = 'allowed-recipient-must-not-leak@test.example';

const FAKE_SEND_EMAIL_BINDING = Object.freeze({
  send: () => Promise.resolve({ messageId: 'fake-message-id' }),
});

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
    validateEnv(eventEnvSchema, candidate);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return error;
    }
    throw error;
  }
  throw new Error('失敗するはずの検証が成功した');
}

describe('eventEnvSchemaのメールの設定', () => {
  test('テスト環境(mailpit・宛先の制限なし)の設定を受け付ける', () => {
    expect(() => validateEnv(eventEnvSchema, copyEnv())).not.toThrow();
  });

  test.each([
    'EMAIL_PROVIDER',
    'EMAIL_FROM_ADDRESS',
    'EMAIL_RECIPIENT_POLICY',
    'EMAIL_EVENTS_QUEUE_NAME',
  ])('常に必須の%sが欠けると、そのキー名だけを欠けたキーにする', (key) => {
    const error = captureValidationError(copyEnv({}, [key]));

    expect(error.missingKeys).toEqual([key]);
    expect(error.invalidKeys).toEqual([]);
  });

  test('mailpitでMAILPIT_API_URLが欠けると、そのキー名だけを欠けたキーにする', () => {
    const error = captureValidationError(
      copyEnv({ EMAIL_PROVIDER: 'mailpit' }, ['MAILPIT_API_URL']),
    );

    expect(error.missingKeys).toEqual(['MAILPIT_API_URL']);
    expect(error.invalidKeys).toEqual([]);
  });

  test('cloudflareで送信バインディングEMAILが欠けると、そのキー名だけを欠けたキーにする', () => {
    const error = captureValidationError(
      copyEnv({ EMAIL_PROVIDER: 'cloudflare' }, ['EMAIL', 'MAILPIT_API_URL']),
    );

    expect(error.missingKeys).toEqual(['EMAIL']);
    expect(error.invalidKeys).toEqual([]);
  });

  test('cloudflareで送信バインディングがあれば、MAILPIT_API_URLが無くても受け付ける', () => {
    expect(() =>
      validateEnv(
        eventEnvSchema,
        copyEnv(
          { EMAIL_PROVIDER: 'cloudflare', EMAIL: FAKE_SEND_EMAIL_BINDING },
          ['MAILPIT_API_URL'],
        ),
      ),
    ).not.toThrow();
  });

  test('allowlistでEMAIL_ALLOWED_RECIPIENTSが欠けると、そのキー名だけを欠けたキーにする', () => {
    const error = captureValidationError(
      copyEnv({ EMAIL_RECIPIENT_POLICY: 'allowlist' }, [
        'EMAIL_ALLOWED_RECIPIENTS',
      ]),
    );

    expect(error.missingKeys).toEqual(['EMAIL_ALLOWED_RECIPIENTS']);
    expect(error.invalidKeys).toEqual([]);
  });

  test('allowlistで許可する宛先があれば受け付ける', () => {
    expect(() =>
      validateEnv(
        eventEnvSchema,
        copyEnv({
          EMAIL_RECIPIENT_POLICY: 'allowlist',
          EMAIL_ALLOWED_RECIPIENTS: SECRET_RECIPIENT,
        }),
      ),
    ).not.toThrow();
  });

  test('条件付きの必須キーの欠落は、他のキーの欠落と一緒に報告する', () => {
    const error = captureValidationError(
      copyEnv(
        { EMAIL_PROVIDER: 'mailpit', EMAIL_RECIPIENT_POLICY: 'allowlist' },
        ['MAILPIT_API_URL', 'EMAIL_ALLOWED_RECIPIENTS', 'HASH_PEPPER'],
      ),
    );

    expect(error.missingKeys).toEqual([
      'EMAIL_ALLOWED_RECIPIENTS',
      'HASH_PEPPER',
      'MAILPIT_API_URL',
    ]);
  });

  test.each<[string, string]>([
    ['EMAIL_PROVIDER', 'smtp-value-must-not-leak'],
    ['EMAIL_RECIPIENT_POLICY', 'none-value-must-not-leak'],
    ['EMAIL_FROM_ADDRESS', 'not-an-address-value-must-not-leak'],
    ['EMAIL_EVENTS_QUEUE_NAME', ''],
    ['MAILPIT_API_URL', 'not-a-url-value-must-not-leak'],
  ])('%sの不正な値は値を含めずにキー名だけを不正なキーにする', (key, value) => {
    const error = captureValidationError(copyEnv({ [key]: value }));

    expect(error.invalidKeys).toEqual([key]);
    expect(error.missingKeys).toEqual([]);
    if (value !== '') {
      expect(error.message).not.toContain(value);
    }
  });

  test('欠落の報告には許可する宛先などの値を含めない', () => {
    const error = captureValidationError(
      copyEnv(
        {
          EMAIL_RECIPIENT_POLICY: 'allowlist',
          EMAIL_ALLOWED_RECIPIENTS: SECRET_RECIPIENT,
        },
        ['MAILPIT_API_URL'],
      ),
    );

    expect(error.missingKeys).toEqual(['MAILPIT_API_URL']);
    expect(JSON.stringify(error)).not.toContain(SECRET_RECIPIENT);
    expect(error.message).not.toContain(SECRET_RECIPIENT);
  });
});
