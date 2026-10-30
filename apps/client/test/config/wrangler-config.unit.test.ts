import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { unstable_readConfig } from 'wrangler';

import {
  type RateLimiter,
  type ServiceFetcher,
  validateFrontendEnv,
} from '../../lib/server/env/frontend-env.ts';
import { z } from '../../lib/utilities/validation/zod.ts';

const APP_DIR = join(import.meta.dirname, '..', '..');

const APPS_DIR = join(APP_DIR, '..');

const COMPATIBILITY_DATE = '2026-08-04';

const LOCAL_TURNSTILE_SITE_KEY = '1x00000000000000000000BB';

const PLACEHOLDER_TURNSTILE_SITE_KEY = '0x0000000000000000000000';

const PLACEHOLDER_WEB_ANALYTICS_TOKEN = '00000000000000000000000000000000';

const RATE_LIMITED_APPS = ['client', 'admin', 'api', 'event'] as const;

const effectiveConfigSchema = z.object({
  name: z.string(),
  main: z.string().optional(),
  compatibility_date: z.string().optional(),
  compatibility_flags: z.array(z.string()),
  workers_dev: z.boolean().optional(),
  preview_urls: z.boolean().optional(),
  route: z.unknown().optional(),
  routes: z.array(z.unknown()).optional(),
  cache: z.object({ enabled: z.boolean() }).optional(),
  observability: z
    .object({
      enabled: z.boolean().optional(),
      logs: z
        .object({
          invocation_logs: z.boolean().optional(),
          destinations: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  logpush: z.boolean().optional(),
  tail_consumers: z.array(z.unknown()).optional(),
  services: z
    .array(
      z.object({
        binding: z.string(),
        service: z.string(),
        entrypoint: z.string().optional(),
      }),
    )
    .optional(),
  ratelimits: z.array(
    z.object({
      name: z.string(),
      namespace_id: z.string(),
      simple: z.object({ limit: z.number(), period: z.number() }),
    }),
  ),
  d1_databases: z.array(z.unknown()),
  r2_buckets: z.array(z.unknown()),
  kv_namespaces: z.array(z.unknown()),
  durable_objects: z.object({ bindings: z.array(z.unknown()) }),
  vars: z.record(z.string(), z.unknown()),
  secrets: z.object({ required: z.array(z.string()) }).optional(),
});

type EffectiveConfig = z.infer<typeof effectiveConfigSchema>;

const workerNameSchema = z.object({ name: z.string() });

const rateLimitsSchema = z.object({
  ratelimits: z.array(z.object({ namespace_id: z.string() })),
});

interface ExpectedEnvironment {
  readonly label: string;
  readonly wranglerEnv: string | undefined;
  readonly workerNameSuffix: string;
  readonly rateLimitNamespaceId: string;
  readonly vars: Readonly<Record<string, string>>;
  readonly validatedWebAnalyticsToken: string | undefined;
  readonly requiredSecrets: readonly string[];
}

const EXPECTED_ENVIRONMENTS: readonly ExpectedEnvironment[] = [
  {
    label: 'ローカル(ルート)',
    wranglerEnv: undefined,
    workerNameSuffix: '',
    rateLimitNamespaceId: '1003',
    vars: {
      APP_ENVIRONMENT: 'local',
      LOG_LEVEL: 'debug',
      SENTRY_ENVIRONMENT: 'local',
      SENTRY_TRACES_SAMPLE_RATE: '0',
      TURNSTILE_SITE_KEY: LOCAL_TURNSTILE_SITE_KEY,
      IMAGES_ORIGIN: 'http://localhost:48043',
      WEB_ANALYTICS_TOKEN: '',
    },
    validatedWebAnalyticsToken: undefined,
    requiredSecrets: ['HASH_PEPPER'],
  },
  {
    label: 'staging',
    wranglerEnv: 'staging',
    workerNameSuffix: '-staging',
    rateLimitNamespaceId: '2003',
    vars: {
      APP_ENVIRONMENT: 'staging',
      LOG_LEVEL: 'info',
      SENTRY_ENVIRONMENT: 'staging',
      SENTRY_TRACES_SAMPLE_RATE: '1',
      TURNSTILE_SITE_KEY: PLACEHOLDER_TURNSTILE_SITE_KEY,
      IMAGES_ORIGIN:
        'https://genai-example-2-images-staging.lab.kurachiweb.com',
      WEB_ANALYTICS_TOKEN: PLACEHOLDER_WEB_ANALYTICS_TOKEN,
    },
    validatedWebAnalyticsToken: PLACEHOLDER_WEB_ANALYTICS_TOKEN,
    requiredSecrets: ['HASH_PEPPER', 'SENTRY_DSN'],
  },
  {
    label: 'prod',
    wranglerEnv: 'prod',
    workerNameSuffix: '-prod',
    rateLimitNamespaceId: '3003',
    vars: {
      APP_ENVIRONMENT: 'prod',
      LOG_LEVEL: 'info',
      SENTRY_ENVIRONMENT: 'prod',
      SENTRY_TRACES_SAMPLE_RATE: '0.1',
      TURNSTILE_SITE_KEY: PLACEHOLDER_TURNSTILE_SITE_KEY,
      IMAGES_ORIGIN: 'https://genai-example-2-images.lab.kurachiweb.com',
      WEB_ANALYTICS_TOKEN: PLACEHOLDER_WEB_ANALYTICS_TOKEN,
    },
    validatedWebAnalyticsToken: PLACEHOLDER_WEB_ANALYTICS_TOKEN,
    requiredSecrets: ['HASH_PEPPER', 'SENTRY_DSN'],
  },
];

const readRawConfig = (app: string, wranglerEnv: string | undefined): unknown =>
  unstable_readConfig(
    { config: join(APPS_DIR, app, 'wrangler.jsonc'), env: wranglerEnv },
    { hideWarnings: true },
  );

const readClientConfig = (wranglerEnv: string | undefined): EffectiveConfig =>
  effectiveConfigSchema.parse(readRawConfig('client', wranglerEnv));

const apiWorkerNameOf = (wranglerEnv: string | undefined): string =>
  workerNameSchema.parse(readRawConfig('api', wranglerEnv)).name;

const rateLimitNamespaceIdsOf = (
  app: string,
  wranglerEnv: string | undefined,
): readonly string[] =>
  rateLimitsSchema
    .parse(readRawConfig(app, wranglerEnv))
    .ratelimits.map((entry) => entry.namespace_id);

// workerdが注入するバインディングの代わりに、環境の検証が確かめる関数だけを持つ偽物を置く
const fakeApi: ServiceFetcher = {
  fetch: () => Promise.resolve(new Response(null)),
};

const fakeRateLimiter: RateLimiter = {
  limit: () => Promise.resolve({ success: true }),
};

const bindingsOf = (
  config: EffectiveConfig,
): Readonly<Record<string, unknown>> =>
  Object.fromEntries([
    ...(config.services ?? []).map(({ binding }): [string, unknown] => [
      binding,
      fakeApi,
    ]),
    ...config.ratelimits.map(({ name }): [string, unknown] => [
      name,
      fakeRateLimiter,
    ]),
  ]);

// Infisicalから注入されるシークレットの代わりに、必須のキーへテスト用の値を置く
const secretsOf = (config: EffectiveConfig): Readonly<Record<string, string>> =>
  Object.fromEntries(
    (config.secrets?.required ?? []).map((key) => [key, `test-${key}`]),
  );

describe.each(EXPECTED_ENVIRONMENTS)('Wrangler設定の実効値($label)', (env) => {
  const config = readClientConfig(env.wranglerEnv);

  test('Worker名に環境ごとの接尾辞が付き、エントリがsrc/server.tsである', () => {
    expect(config.name).toBe(`genai-example-2-client${env.workerNameSuffix}`);
    expect(config.main).toBe(join(APP_DIR, 'src', 'server.ts'));
  });

  test('APIのService Bindingsが同じ環境のAPIのWorkerの利用者側の入口を指す', () => {
    expect(config.services).toStrictEqual([
      {
        binding: 'API',
        service: `genai-example-2-api${env.workerNameSuffix}`,
        entrypoint: 'ClientGateway',
      },
    ]);
  });

  test('APIのService Bindingsの接続先が、apiのWrangler設定の同じ環境の実効のWorker名と一致する', () => {
    expect(config.services?.map(({ service }) => service)).toEqual([
      apiWorkerNameOf(env.wranglerEnv),
    ]);
  });

  test('IP制限は10秒あたり100回で、利用者側の環境ごとの名前空間を使う', () => {
    expect(config.ratelimits).toStrictEqual([
      {
        name: 'IP_RATE_LIMITER',
        namespace_id: env.rateLimitNamespaceId,
        simple: { limit: 100, period: 10 },
      },
    ]);
  });

  test('APIとIP制限以外のバインディングを持たない', () => {
    expect(config.d1_databases).toEqual([]);
    expect(config.r2_buckets).toEqual([]);
    expect(config.kv_namespaces).toEqual([]);
    expect(config.durable_objects.bindings).toEqual([]);
  });

  test('呼び出しログを無効にし、ログを長期保存する出力先を持たない', () => {
    expect(config.observability?.enabled).toBe(true);
    expect(config.observability?.logs?.invocation_logs).toBe(false);
    expect(config.observability?.logs?.destinations ?? []).toEqual([]);
    expect(config.logpush ?? false).toBe(false);
    expect(config.tail_consumers ?? []).toEqual([]);
  });

  test('既定の公開サブドメインとプレビューURLを無効にし、ホスト名を設定で割り当てない', () => {
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.route).toBeUndefined();
    expect(config.routes ?? []).toEqual([]);
  });

  test('Workerの前段のキャッシュを無効にする', () => {
    expect(config.cache).toEqual({ enabled: false });
  });

  test('共通の互換性日付を使い、互換性フラグ(Node.js互換を含む)を指定しない', () => {
    expect(config.compatibility_date).toBe(COMPATIBILITY_DATE);
    expect(config.compatibility_flags).toEqual([]);
  });

  test('変数は環境の検証が求めるキーを環境ごとの値で持ち、サンプリングの割合を文字列で書く', () => {
    expect(config.vars).toStrictEqual(env.vars);
  });

  test('実効の変数とバインディングと必須のシークレットが共通部品の環境の検証を通り、空のアクセス解析のトークンは未設定として扱われる', () => {
    const validation = validateFrontendEnv({
      ...config.vars,
      ...bindingsOf(config),
      ...secretsOf(config),
    });

    expect(validation.ok).toBe(true);
    expect(validation.ok && validation.env.WEB_ANALYTICS_TOKEN).toBe(
      env.validatedWebAnalyticsToken,
    );
  });

  test('必須のシークレットは、全環境のペッパーとstaging・prodのSentryのDSNである', () => {
    expect(config.secrets?.required ?? []).toEqual([...env.requiredSecrets]);
  });

  test('必須のシークレットが注入されなければ、ペッパーの欠落として環境の検証が失敗する', () => {
    const validation = validateFrontendEnv({
      ...config.vars,
      ...bindingsOf(config),
    });

    expect(validation).toEqual({ ok: false, invalidKeys: ['HASH_PEPPER'] });
  });

  test('変数のキーとシークレットのキーが重ならない', () => {
    const varKeys = Object.keys(config.vars);

    for (const secretKey of config.secrets?.required ?? []) {
      expect(varKeys).not.toContain(secretKey);
    }
  });
});

describe('Wrangler設定の環境をまたぐ整合', () => {
  test('IP制限の名前空間が、利用者側・管理者側・api・eventの環境・Workerごとにすべて異なる', () => {
    const namespaceIds = EXPECTED_ENVIRONMENTS.flatMap(({ wranglerEnv }) =>
      RATE_LIMITED_APPS.flatMap((app) =>
        rateLimitNamespaceIdsOf(app, wranglerEnv),
      ),
    );

    expect(namespaceIds).toHaveLength(
      EXPECTED_ENVIRONMENTS.length * RATE_LIMITED_APPS.length,
    );
    expect(new Set(namespaceIds).size).toBe(namespaceIds.length);
  });
});
