import { describe, expect, test } from 'bun:test';

import type { FrontendAppProfile } from '../entry/app-profile.ts';
import {
  type EnvValidation,
  toPublicRuntimeConfig,
  type ValidatedFrontendEnv,
  validateFrontendEnv,
} from './frontend-env.ts';

const SENTRY_DSN = 'https://public-key@sentry.example/1';
const SECRET_VALUE = 'secret-value-must-not-leak';
const INVALID_VALUE = 'invalid-value-must-not-leak';

const fakeApi = {
  fetch: (): Promise<Response> => Promise.resolve(new Response(null)),
};
const fakeRateLimiter = {
  limit: (): Promise<{ readonly success: boolean }> =>
    Promise.resolve({ success: true }),
};

const validRawEnv = (): Record<string, unknown> => ({
  API: fakeApi,
  IP_RATE_LIMITER: fakeRateLimiter,
  APP_ENVIRONMENT: 'staging',
  LOG_LEVEL: 'info',
  SENTRY_ENVIRONMENT: 'staging',
  SENTRY_TRACES_SAMPLE_RATE: '1',
  SENTRY_DSN,
  TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  IMAGES_ORIGIN: 'https://images.example',
  WEB_ANALYTICS_TOKEN: 'analytics-token',
});

const CLIENT_LIKE_PROFILE: FrontendAppProfile = {
  caller: 'client',
  sessionCookieName: '__Host-test_session',
  indexable: (environment) => environment === 'prod',
  webAnalytics: true,
};

const ADMIN_LIKE_PROFILE: FrontendAppProfile = {
  caller: 'admin',
  sessionCookieName: '__Host-test_admin_session',
  indexable: () => false,
  webAnalytics: false,
};

const envOf = (validation: EnvValidation): ValidatedFrontendEnv => {
  if (!validation.ok) {
    throw new Error(
      `検証の成功を期待したが失敗した: ${validation.invalidKeys.join(', ')}`,
    );
  }
  return validation.env;
};

const invalidKeysOf = (validation: EnvValidation): readonly string[] => {
  if (validation.ok) {
    throw new Error('検証の失敗を期待したが成功した');
  }
  return validation.invalidKeys;
};

const rawEnvWithout = (...keys: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(validRawEnv()).filter(([key]) => !keys.includes(key)),
  );

const validate = (overrides: Record<string, unknown>): EnvValidation =>
  validateFrontendEnv({ ...validRawEnv(), ...overrides });

describe('validateFrontendEnv', () => {
  describe('成功', () => {
    test('すべてのキーが揃えば、型に合わせて変換した環境を返す', () => {
      const env = envOf(validateFrontendEnv(validRawEnv()));

      expect(env).toEqual({
        API: fakeApi,
        IP_RATE_LIMITER: fakeRateLimiter,
        APP_ENVIRONMENT: 'staging',
        LOG_LEVEL: 'info',
        SENTRY_ENVIRONMENT: 'staging',
        SENTRY_TRACES_SAMPLE_RATE: 1,
        SENTRY_DSN,
        TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
        IMAGES_ORIGIN: 'https://images.example',
        WEB_ANALYTICS_TOKEN: 'analytics-token',
      });
    });

    test('バインディングは渡された実体をそのまま返す', () => {
      const env = envOf(validateFrontendEnv(validRawEnv()));

      expect(env.API).toBe(fakeApi);
      expect(env.IP_RATE_LIMITER).toBe(fakeRateLimiter);
    });

    test('宣言していないキーは検証後の環境に含めない', () => {
      const env = envOf(validate({ HASH_PEPPER: SECRET_VALUE }));

      expect(Object.keys(env)).not.toContain('HASH_PEPPER');
      expect(JSON.stringify(env)).not.toContain(SECRET_VALUE);
    });

    test.each(['local', 'staging', 'prod'])(
      '環境の種類%sを受け付ける',
      (environment) => {
        const env = envOf(validate({ APP_ENVIRONMENT: environment }));

        expect(env.APP_ENVIRONMENT).toBe(environment);
      },
    );

    test.each(['debug', 'info', 'warning', 'error'])(
      'ログのレベル%sを受け付ける',
      (level) => {
        const env = envOf(validate({ LOG_LEVEL: level }));

        expect(env.LOG_LEVEL).toBe(level);
      },
    );

    test.each([
      ['0', 0],
      ['0.1', 0.1],
      ['0.25', 0.25],
      ['1', 1],
      ['1.0', 1],
    ])('トレースの割合%sを数値%dにする', (raw, expected) => {
      const env = envOf(validate({ SENTRY_TRACES_SAMPLE_RATE: raw }));

      expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(expected);
    });

    test.each(['http://localhost:48043', 'https://images.example'])(
      'オリジン%sを受け付ける',
      (origin) => {
        const env = envOf(validate({ IMAGES_ORIGIN: origin }));

        expect(env.IMAGES_ORIGIN).toBe(origin);
      },
    );

    test('バインディングは関数として渡された実体も受け付ける', () => {
      const callableApi = Object.assign(() => undefined, {
        fetch: fakeApi.fetch,
      });

      const env = envOf(validate({ API: callableApi }));

      expect(env.API).toBe(callableApi);
    });
  });

  describe('エラートラッキングの送信先', () => {
    test('送信先が無ければ未設定として扱い、検証は失敗しない', () => {
      const raw = rawEnvWithout('SENTRY_DSN');

      const env = envOf(validateFrontendEnv(raw));

      expect(env.SENTRY_DSN).toBeUndefined();
    });

    test('送信先が空文字なら未設定として扱う', () => {
      const env = envOf(validate({ SENTRY_DSN: '' }));

      expect(env.SENTRY_DSN).toBeUndefined();
    });

    test('送信先が文字列でなければ不正なキーとして返す', () => {
      expect(invalidKeysOf(validate({ SENTRY_DSN: 42 }))).toEqual([
        'SENTRY_DSN',
      ]);
    });
  });

  describe('アクセス解析のトークン', () => {
    test('トークンが無ければ未設定として扱う', () => {
      const raw = rawEnvWithout('WEB_ANALYTICS_TOKEN');

      const env = envOf(validateFrontendEnv(raw));

      expect(env.WEB_ANALYTICS_TOKEN).toBeUndefined();
    });

    test('トークンが空文字なら未設定として扱う', () => {
      const env = envOf(validate({ WEB_ANALYTICS_TOKEN: '' }));

      expect(env.WEB_ANALYTICS_TOKEN).toBeUndefined();
    });
  });

  describe('欠落', () => {
    test.each([
      'API',
      'IP_RATE_LIMITER',
      'APP_ENVIRONMENT',
      'LOG_LEVEL',
      'SENTRY_ENVIRONMENT',
      'SENTRY_TRACES_SAMPLE_RATE',
      'TURNSTILE_SITE_KEY',
      'IMAGES_ORIGIN',
    ])('必要なキー%sが無ければ、その名前を返す', (key) => {
      const raw = rawEnvWithout(key);

      expect(invalidKeysOf(validateFrontendEnv(raw))).toEqual([key]);
    });

    test('値がundefinedのキーも欠落として名前を返す', () => {
      expect(
        invalidKeysOf(validate({ TURNSTILE_SITE_KEY: undefined })),
      ).toEqual(['TURNSTILE_SITE_KEY']);
    });

    test.each(['TURNSTILE_SITE_KEY', 'SENTRY_ENVIRONMENT'])(
      '空文字の%sは欠落として名前を返す',
      (key) => {
        expect(invalidKeysOf(validate({ [key]: '' }))).toEqual([key]);
      },
    );

    test('環境がオブジェクトでなければ、必要なキーの名前をすべて返す', () => {
      expect(invalidKeysOf(validateFrontendEnv(undefined))).toEqual([
        'API',
        'APP_ENVIRONMENT',
        'IMAGES_ORIGIN',
        'IP_RATE_LIMITER',
        'LOG_LEVEL',
        'SENTRY_ENVIRONMENT',
        'SENTRY_TRACES_SAMPLE_RATE',
        'TURNSTILE_SITE_KEY',
      ]);
    });
  });

  describe('不正な値', () => {
    test.each(['production', 'dev', 'Local', ''])(
      '環境の種類%pを拒否する',
      (environment) => {
        expect(
          invalidKeysOf(validate({ APP_ENVIRONMENT: environment })),
        ).toEqual(['APP_ENVIRONMENT']);
      },
    );

    test.each(['verbose', 'warn', 'INFO'])(
      'ログのレベル%pを拒否する',
      (level) => {
        expect(invalidKeysOf(validate({ LOG_LEVEL: level }))).toEqual([
          'LOG_LEVEL',
        ]);
      },
    );

    test.each([
      '',
      '1.5',
      '-0.1',
      '2',
      '0x1',
      '1e-1',
      '.5',
      ' 0.5',
      'abc',
      0.5,
    ])('トレースの割合%pを拒否する', (rate) => {
      expect(
        invalidKeysOf(validate({ SENTRY_TRACES_SAMPLE_RATE: rate })),
      ).toEqual(['SENTRY_TRACES_SAMPLE_RATE']);
    });

    test.each([
      'images.example',
      'https://images.example/',
      'https://images.example/path',
      'https://images.example?query=1',
      'ftp://images.example',
      'https://user@images.example',
      'HTTPS://IMAGES.EXAMPLE',
      '',
    ])('オリジンの形式でない%pを拒否する', (origin) => {
      expect(invalidKeysOf(validate({ IMAGES_ORIGIN: origin }))).toEqual([
        'IMAGES_ORIGIN',
      ]);
    });

    test.each([
      ['API', {}],
      ['API', { fetch: 'not-a-function' }],
      ['API', 'binding'],
      ['API', null],
      ['IP_RATE_LIMITER', {}],
      ['IP_RATE_LIMITER', { fetch: fakeApi.fetch }],
      ['IP_RATE_LIMITER', 100],
    ])('バインディング%sの形が違う%pを拒否する', (key, value) => {
      expect(invalidKeysOf(validate({ [key]: value }))).toEqual([key]);
    });

    test('アクセス解析のトークンが文字列でなければ不正なキーとして返す', () => {
      expect(invalidKeysOf(validate({ WEB_ANALYTICS_TOKEN: 1 }))).toEqual([
        'WEB_ANALYTICS_TOKEN',
      ]);
    });

    test('欠落と不正を合わせて、名前順に重複なく返す', () => {
      const raw = rawEnvWithout('TURNSTILE_SITE_KEY', 'API');

      const invalidKeys = invalidKeysOf(
        validateFrontendEnv({
          ...raw,
          LOG_LEVEL: INVALID_VALUE,
          APP_ENVIRONMENT: INVALID_VALUE,
          IMAGES_ORIGIN: INVALID_VALUE,
        }),
      );

      expect(invalidKeys).toEqual([
        'API',
        'APP_ENVIRONMENT',
        'IMAGES_ORIGIN',
        'LOG_LEVEL',
        'TURNSTILE_SITE_KEY',
      ]);
      expect(Object.isFrozen(invalidKeys)).toBe(true);
    });
  });

  describe('失敗の結果', () => {
    test('キーの名前だけを持ち、値もZodの問題も含まない', () => {
      const validation = validate({
        HASH_PEPPER: SECRET_VALUE,
        SENTRY_DSN: SECRET_VALUE,
        LOG_LEVEL: INVALID_VALUE,
        IMAGES_ORIGIN: `https://${INVALID_VALUE}.example/path`,
      });

      expect(validation).toEqual({
        ok: false,
        invalidKeys: ['IMAGES_ORIGIN', 'LOG_LEVEL'],
      });
      const serialized = [
        JSON.stringify(validation),
        Bun.inspect(validation),
      ].join('\n');
      expect(serialized).not.toContain(SECRET_VALUE);
      expect(serialized).not.toContain(INVALID_VALUE);
    });
  });
});

describe('toPublicRuntimeConfig', () => {
  test('ブラウザへ渡してよい値だけを返す', () => {
    const env = envOf(validateFrontendEnv(validRawEnv()));

    expect(toPublicRuntimeConfig(env, CLIENT_LIKE_PROFILE)).toEqual({
      environment: 'staging',
      turnstileSiteKey: '1x00000000000000000000AA',
      sentry: {
        dsn: SENTRY_DSN,
        environment: 'staging',
        tracesSampleRate: 1,
      },
      webAnalyticsToken: 'analytics-token',
    });
  });

  test('バインディング・ログのレベル・画像のオリジン・宣言していないシークレットを含まない', () => {
    const env = envOf(
      validate({
        HASH_PEPPER: SECRET_VALUE,
        TURNSTILE_SECRET_KEY: SECRET_VALUE,
        LOG_LEVEL: 'debug',
        IMAGES_ORIGIN: 'https://internal-images.example',
      }),
    );

    const config = toPublicRuntimeConfig(env, CLIENT_LIKE_PROFILE);

    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain(SECRET_VALUE);
    expect(serialized).not.toContain('debug');
    expect(serialized).not.toContain('internal-images.example');
    expect(Object.values(config)).not.toContain(fakeApi);
    expect(Object.values(config)).not.toContain(fakeRateLimiter);
    expect(Object.keys(config).toSorted()).toEqual([
      'environment',
      'sentry',
      'turnstileSiteKey',
      'webAnalyticsToken',
    ]);
  });

  test('結果はJSONとして往復しても同じ値になる', () => {
    const env = envOf(validateFrontendEnv(validRawEnv()));
    const config = toPublicRuntimeConfig(env, CLIENT_LIKE_PROFILE);

    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
  });

  test('アクセス解析を持たないプロファイルでは解析のトークンを渡さない', () => {
    const env = envOf(validateFrontendEnv(validRawEnv()));

    const config = toPublicRuntimeConfig(env, ADMIN_LIKE_PROFILE);

    expect(config.webAnalyticsToken).toBeUndefined();
    expect(JSON.stringify(config)).not.toContain('analytics-token');
  });

  test('アクセス解析を持つプロファイルでも、トークンが未設定なら渡さない', () => {
    const env = envOf(validate({ WEB_ANALYTICS_TOKEN: '' }));

    expect(
      toPublicRuntimeConfig(env, CLIENT_LIKE_PROFILE).webAnalyticsToken,
    ).toBeUndefined();
  });

  test('送信先が無ければSentryの送信先を未設定として渡す', () => {
    const raw = rawEnvWithout('SENTRY_DSN');
    const env = envOf(validateFrontendEnv(raw));

    const config = toPublicRuntimeConfig(env, CLIENT_LIKE_PROFILE);

    expect(config.sentry).toEqual({
      dsn: undefined,
      environment: 'staging',
      tracesSampleRate: 1,
    });
  });
});
