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

describe('eventEnvSchemaのキーワード抽出の設定', () => {
  const SECRET_API_KEY = 'google-nl-api-key-value-must-not-leak';

  test('Workers統合テストの環境は抽出を有効にし、キーを持つ', () => {
    expect(env.KEYWORD_EXTRACTOR).toBe('google-natural-language');
    expect(env.GOOGLE_NL_API_KEY).toBeTruthy();
  });

  test('抽出を無効にした環境は、キーが無くても受け付ける', () => {
    expect(() =>
      validateEnv(
        eventEnvSchema,
        copyEnv({ KEYWORD_EXTRACTOR: 'disabled' }, ['GOOGLE_NL_API_KEY']),
      ),
    ).not.toThrow();
  });

  test('抽出を有効にした環境でキーが欠けると、そのキー名だけを欠けたキーにする', () => {
    const error = captureValidationError(
      copyEnv({ KEYWORD_EXTRACTOR: 'google-natural-language' }, [
        'GOOGLE_NL_API_KEY',
      ]),
    );

    expect(error.missingKeys).toEqual(['GOOGLE_NL_API_KEY']);
    expect(error.invalidKeys).toEqual([]);
  });

  test('KEYWORD_EXTRACTORが欠けると、そのキー名だけを欠けたキーにする', () => {
    const error = captureValidationError(copyEnv({}, ['KEYWORD_EXTRACTOR']));

    expect(error.missingKeys).toEqual(['KEYWORD_EXTRACTOR']);
    expect(error.invalidKeys).toEqual([]);
  });

  test.each<[string, string]>([
    ['KEYWORD_EXTRACTOR', 'openai-value-must-not-leak'],
    ['GOOGLE_NL_API_KEY', ''],
  ])('%sの不正な値は値を含めずにキー名だけを不正なキーにする', (key, value) => {
    const error = captureValidationError(copyEnv({ [key]: value }));

    expect(error.invalidKeys).toEqual([key]);
    expect(error.missingKeys).toEqual([]);
    if (value !== '') {
      expect(error.message).not.toContain(value);
    }
  });

  test('抽出のキーの欠落は他の条件付きの必須キーの欠落と一緒に報告する', () => {
    const error = captureValidationError(
      copyEnv(
        {
          KEYWORD_EXTRACTOR: 'google-natural-language',
          EMAIL_PROVIDER: 'mailpit',
        },
        ['GOOGLE_NL_API_KEY', 'MAILPIT_API_URL'],
      ),
    );

    expect(error.missingKeys).toEqual(['GOOGLE_NL_API_KEY', 'MAILPIT_API_URL']);
  });

  test('検証の失敗の報告にキーの値を含めない', () => {
    const error = captureValidationError(
      copyEnv({ GOOGLE_NL_API_KEY: SECRET_API_KEY }, ['HASH_PEPPER']),
    );

    expect(error.missingKeys).toEqual(['HASH_PEPPER']);
    expect(JSON.stringify(error)).not.toContain(SECRET_API_KEY);
    expect(error.message).not.toContain(SECRET_API_KEY);
  });
});

describe('eventEnvSchemaのメディアの設定', () => {
  const SECRET_ACCESS_KEY = 'rekognition-secret-value-must-not-leak';

  const REKOGNITION_CREDENTIALS = Object.freeze({
    REKOGNITION_ACCESS_KEY_ID: 'rekognition-access-key-id-for-tests',
    REKOGNITION_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY,
  });

  test('Workers統合テストの環境は代替の判定を使い、判定サービスの資格情報を持たない', () => {
    expect(env.MODERATION_PROVIDER).toBe('stub');
    expect(env.REKOGNITION_ACCESS_KEY_ID).toBeUndefined();
    expect(env.REKOGNITION_SECRET_ACCESS_KEY).toBeUndefined();
  });

  test('動作確認のトークンが無い環境も受け付ける', () => {
    expect(() =>
      validateEnv(eventEnvSchema, copyEnv({}, ['MEDIA_SMOKE_TOKEN'])),
    ).not.toThrow();
  });

  test('判定サービスを使う環境は、2つの資格情報があれば受け付ける', () => {
    expect(() =>
      validateEnv(
        eventEnvSchema,
        copyEnv({
          MODERATION_PROVIDER: 'rekognition',
          ...REKOGNITION_CREDENTIALS,
        }),
      ),
    ).not.toThrow();
  });

  test('判定サービスを使う環境で資格情報が欠けると、そのキー名だけを欠けたキーにする', () => {
    const error = captureValidationError(
      copyEnv({ MODERATION_PROVIDER: 'rekognition' }, [
        'REKOGNITION_ACCESS_KEY_ID',
        'REKOGNITION_SECRET_ACCESS_KEY',
      ]),
    );

    expect(error.missingKeys).toEqual([
      'REKOGNITION_ACCESS_KEY_ID',
      'REKOGNITION_SECRET_ACCESS_KEY',
    ]);
    expect(error.invalidKeys).toEqual([]);
  });

  test.each([
    'IMAGE_DELIVERY_HOSTNAME',
    'IMAGE_DELIVERY_DEDICATED_HOST',
    'MODERATION_PROVIDER',
    'MODERATION_REGION',
    'MODERATION_MIN_CONFIDENCE',
    'MODERATION_BLOCKED_CATEGORIES',
  ])('常に必須の%sが欠けると、そのキー名だけを欠けたキーにする', (key) => {
    const error = captureValidationError(copyEnv({}, [key]));

    expect(error.missingKeys).toEqual([key]);
    expect(error.invalidKeys).toEqual([]);
  });

  test.each<[string, string]>([
    ['IMAGE_DELIVERY_HOSTNAME', ''],
    ['IMAGE_DELIVERY_DEDICATED_HOST', 'yes-value-must-not-leak'],
    ['MODERATION_PROVIDER', 'vision-value-must-not-leak'],
    ['MODERATION_REGION', 'region.example-value-must-not-leak'],
    ['MODERATION_MIN_CONFIDENCE', '101'],
    ['MODERATION_MIN_CONFIDENCE', 'sixty-value-must-not-leak'],
    ['MODERATION_BLOCKED_CATEGORIES', 'Unknown-value-must-not-leak'],
    ['MODERATION_BLOCKED_CATEGORIES', 'Explicit,Explicit'],
  ])(
    '%sの不正な値(%s)は値を含めずにキー名だけを不正なキーにする',
    (key, value) => {
      const error = captureValidationError(copyEnv({ [key]: value }));

      expect(error.invalidKeys).toEqual([key]);
      expect(error.missingKeys).toEqual([]);
      if (value.includes('must-not-leak')) {
        expect(error.message).not.toContain(value);
      }
    },
  );

  test('判定サービスの資格情報の欠落は他の条件付きの必須キーの欠落と一緒に報告し、値を含めない', () => {
    const error = captureValidationError(
      copyEnv(
        {
          MODERATION_PROVIDER: 'rekognition',
          REKOGNITION_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY,
          EMAIL_PROVIDER: 'mailpit',
        },
        ['REKOGNITION_ACCESS_KEY_ID', 'MAILPIT_API_URL'],
      ),
    );

    expect(error.missingKeys).toEqual([
      'MAILPIT_API_URL',
      'REKOGNITION_ACCESS_KEY_ID',
    ]);
    expect(JSON.stringify(error)).not.toContain(SECRET_ACCESS_KEY);
    expect(error.message).not.toContain(SECRET_ACCESS_KEY);
  });
});
