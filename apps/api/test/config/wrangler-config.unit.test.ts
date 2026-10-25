import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { unstable_readConfig } from 'wrangler';
import { z } from 'zod';

type AppName = 'api' | 'event';

const APP_NAMES = ['api', 'event'] as const satisfies readonly AppName[];

const APPS_DIR = join(import.meta.dirname, '..', '..', '..');

const COMPATIBILITY_DATE = '2026-08-04';

const R2_BINDINGS = ['IMAGES_BUCKET', 'FILES_BUCKET', 'QUARANTINE_BUCKET'];

const MIGRATIONS_DIR = 'db/migrations';

const effectiveConfigSchema = z.object({
  name: z.string(),
  main: z.string().optional(),
  compatibility_date: z.string().optional(),
  compatibility_flags: z.array(z.string()),
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
  d1_databases: z.array(
    z.object({
      binding: z.string(),
      database_name: z.string().optional(),
      database_id: z.string().optional(),
      preview_database_id: z.string().optional(),
      migrations_dir: z.string().optional(),
      migrations_pattern: z.string().optional(),
    }),
  ),
  r2_buckets: z.array(
    z.object({
      binding: z.string(),
      bucket_name: z.string().optional(),
      preview_bucket_name: z.string().optional(),
    }),
  ),
  queues: z.object({
    producers: z
      .array(z.object({ binding: z.string(), queue: z.string() }))
      .optional(),
    consumers: z
      .array(
        z.object({
          queue: z.string(),
          max_retries: z.number().optional(),
          dead_letter_queue: z.string().optional(),
        }),
      )
      .optional(),
  }),
  ratelimits: z.array(
    z.object({
      name: z.string(),
      namespace_id: z.string(),
      simple: z.object({ limit: z.number(), period: z.number() }),
    }),
  ),
  images: z.object({ binding: z.string() }).optional(),
  triggers: z.object({ crons: z.array(z.string()).optional() }),
  vars: z.record(z.string(), z.unknown()),
  secrets: z.object({ required: z.array(z.string()) }).optional(),
});

type EffectiveConfig = z.infer<typeof effectiveConfigSchema>;

interface ExpectedEnvironment {
  readonly label: string;
  readonly wranglerEnv: string | undefined;
  readonly workerNameSuffix: string;
  readonly resourceSuffix: string;
  readonly databaseId: string;
  readonly rateLimitNamespaceIds: Readonly<Record<AppName, string>>;
  readonly logLevel: string;
  readonly sentryEnvironment: string;
  readonly sentryTracesSampleRate: string;
  readonly turnstileExpectedHostnames: string;
  readonly requiresSentryDsn: boolean;
}

const EXPECTED_ENVIRONMENTS: readonly ExpectedEnvironment[] = [
  {
    label: 'ローカル(ルート)',
    wranglerEnv: undefined,
    workerNameSuffix: '',
    resourceSuffix: 'dev',
    databaseId: '00000000-0000-4000-8000-000000000001',
    rateLimitNamespaceIds: { api: '1001', event: '1002' },
    logLevel: 'debug',
    sentryEnvironment: 'local',
    sentryTracesSampleRate: '0',
    turnstileExpectedHostnames: '',
    requiresSentryDsn: false,
  },
  {
    label: 'staging',
    wranglerEnv: 'staging',
    workerNameSuffix: '-staging',
    resourceSuffix: 'staging',
    databaseId: '00000000-0000-0000-0000-000000000000',
    rateLimitNamespaceIds: { api: '2001', event: '2002' },
    logLevel: 'info',
    sentryEnvironment: 'staging',
    sentryTracesSampleRate: '1',
    turnstileExpectedHostnames:
      'genai-example-2-client-staging.lab.kurachiweb.com,genai-example-2-admin-staging.lab.kurachiweb.com',
    requiresSentryDsn: true,
  },
  {
    label: 'prod',
    wranglerEnv: 'prod',
    workerNameSuffix: '-prod',
    resourceSuffix: 'prod',
    databaseId: '00000000-0000-0000-0000-000000000000',
    rateLimitNamespaceIds: { api: '3001', event: '3002' },
    logLevel: 'info',
    sentryEnvironment: 'prod',
    sentryTracesSampleRate: '0.1',
    turnstileExpectedHostnames:
      'genai-example-2-client.lab.kurachiweb.com,genai-example-2-admin.lab.kurachiweb.com',
    requiresSentryDsn: true,
  },
];

function readEffectiveConfig(
  app: AppName,
  wranglerEnv: string | undefined,
): EffectiveConfig {
  const raw: unknown = unstable_readConfig(
    { config: join(APPS_DIR, app, 'wrangler.jsonc'), env: wranglerEnv },
    { hideWarnings: true },
  );
  return effectiveConfigSchema.parse(raw);
}

function bindingNames(entries: readonly { readonly binding: string }[]) {
  return entries.map((entry) => entry.binding);
}

function bucketNamesByBinding(config: EffectiveConfig) {
  return Object.fromEntries(
    config.r2_buckets.map((bucket) => [bucket.binding, bucket.bucket_name]),
  );
}

function producerQueuesByBinding(config: EffectiveConfig) {
  return Object.fromEntries(
    (config.queues.producers ?? []).map((producer) => [
      producer.binding,
      producer.queue,
    ]),
  );
}

function findRateLimiter(config: EffectiveConfig) {
  return config.ratelimits.find((entry) => entry.name === 'IP_RATE_LIMITER');
}

describe.each(EXPECTED_ENVIRONMENTS)('Wrangler設定の実効値($label)', (env) => {
  const api = readEffectiveConfig('api', env.wranglerEnv);
  const event = readEffectiveConfig('event', env.wranglerEnv);
  const jobsQueue = `genai-example-2-jobs-${env.resourceSuffix}`;
  const jobsDlq = `genai-example-2-jobs-dlq-${env.resourceSuffix}`;

  test('Worker名に環境ごとの接尾辞が付き、エントリがsrc/index.tsである', () => {
    expect(api.name).toBe(`genai-example-2-api${env.workerNameSuffix}`);
    expect(event.name).toBe(`genai-example-2-event${env.workerNameSuffix}`);
    expect(api.main).toBe(join(APPS_DIR, 'api', 'src', 'index.ts'));
    expect(event.main).toBe(join(APPS_DIR, 'event', 'src', 'index.ts'));
  });

  test('両アプリが同じ名前のD1・R2・IP制限のバインディングを持つ', () => {
    for (const config of [api, event]) {
      expect(bindingNames(config.d1_databases)).toEqual(['DB']);
      expect(bindingNames(config.r2_buckets)).toEqual(R2_BINDINGS);
      expect(config.ratelimits.map((entry) => entry.name)).toEqual([
        'IP_RATE_LIMITER',
      ]);
    }
  });

  test('Queueの送信はapiが本体だけ、eventが本体とデッドレターを持つ', () => {
    expect(producerQueuesByBinding(api)).toEqual({ JOBS_QUEUE: jobsQueue });
    expect(producerQueuesByBinding(event)).toEqual({
      JOBS_QUEUE: jobsQueue,
      JOBS_DLQ: jobsDlq,
    });
  });

  test('画像変換のバインディングはeventだけが持つ', () => {
    expect(api.images).toBeUndefined();
    expect(event.images).toEqual({ binding: 'IMAGES' });
  });

  test('D1のdatabase_name・database_idが両アプリで一致する', () => {
    const expected = {
      binding: 'DB',
      database_name: `genai-example-2-${env.resourceSuffix}`,
      database_id: env.databaseId,
    };

    expect(api.d1_databases[0]).toMatchObject(expected);
    expect(event.d1_databases[0]).toMatchObject(expected);
    expect(api.d1_databases[0]?.preview_database_id).toBe(
      event.d1_databases[0]?.preview_database_id,
    );
  });

  test('R2のバケット名が両アプリで一致する', () => {
    const expected = {
      IMAGES_BUCKET: `genai-example-2-images-${env.resourceSuffix}`,
      FILES_BUCKET: `genai-example-2-files-${env.resourceSuffix}`,
      QUARANTINE_BUCKET: `genai-example-2-quarantine-${env.resourceSuffix}`,
    };

    expect(bucketNamesByBinding(api)).toEqual(expected);
    expect(bucketNamesByBinding(event)).toEqual(expected);
    for (const bucket of api.r2_buckets) {
      const counterpart = event.r2_buckets.find(
        (candidate) => candidate.binding === bucket.binding,
      );
      expect(counterpart?.preview_bucket_name).toBe(bucket.preview_bucket_name);
    }
  });

  test('マイグレーションの検出設定をapiだけが持つ', () => {
    expect(api.d1_databases[0]).toMatchObject({
      migrations_dir: MIGRATIONS_DIR,
      migrations_pattern: `${MIGRATIONS_DIR}/*/migration.sql`,
    });
    expect(event.d1_databases[0]?.migrations_pattern).toBeUndefined();
    expect(event.d1_databases[0]?.migrations_dir).not.toBe(MIGRATIONS_DIR);
  });

  test('共通の互換性日付を使い、互換性フラグ(Node.js互換を含む)を指定しない', () => {
    for (const config of [api, event]) {
      expect(config.compatibility_date).toBe(COMPATIBILITY_DATE);
      expect(
        config.compatibility_flags.filter((flag) =>
          flag.startsWith('nodejs_compat'),
        ),
      ).toEqual([]);
      expect(config.compatibility_flags).toEqual([]);
    }
  });

  test('apiは必須シークレットとしてペッパーとbot判定のシークレットのキー名だけを宣言する', () => {
    expect(api.secrets?.required).toEqual([
      'HASH_PEPPER',
      'TURNSTILE_SECRET_KEY',
      ...(env.requiresSentryDsn ? ['SENTRY_DSN'] : []),
    ]);
  });

  test('eventは必須シークレットとしてペッパーのキー名だけを宣言する', () => {
    expect(event.secrets?.required).toEqual([
      'HASH_PEPPER',
      ...(env.requiresSentryDsn ? ['SENTRY_DSN'] : []),
    ]);
  });

  test('apiの変数はシークレットを含まず、環境ごとの値を持つ', () => {
    expect(api.vars).toStrictEqual({
      LOG_LEVEL: env.logLevel,
      SENTRY_ENVIRONMENT: env.sentryEnvironment,
      SENTRY_TRACES_SAMPLE_RATE: env.sentryTracesSampleRate,
      TURNSTILE_EXPECTED_HOSTNAMES: env.turnstileExpectedHostnames,
    });
  });

  test('eventの変数はシークレットを含まず、環境ごとの値とQueue名を持つ', () => {
    expect(event.vars).toStrictEqual({
      LOG_LEVEL: env.logLevel,
      SENTRY_ENVIRONMENT: env.sentryEnvironment,
      SENTRY_TRACES_SAMPLE_RATE: env.sentryTracesSampleRate,
      JOBS_QUEUE_NAME: jobsQueue,
      JOBS_DLQ_NAME: jobsDlq,
    });
  });

  test('変数のキーとシークレットのキーが重ならない', () => {
    for (const config of [api, event]) {
      const varKeys = Object.keys(config.vars);
      for (const secretKey of config.secrets?.required ?? []) {
        expect(varKeys).not.toContain(secretKey);
      }
    }
  });

  test('apiのWorkerの前段のキャッシュを無効にする', () => {
    expect(api.cache).toEqual({ enabled: false });
  });

  test('両アプリが呼び出しログを無効にし、ログを長期保存する出力先を持たない', () => {
    for (const config of [api, event]) {
      expect(config.observability?.enabled).toBe(true);
      expect(config.observability?.logs?.invocation_logs).toBe(false);
      expect(config.observability?.logs?.destinations ?? []).toEqual([]);
      expect(config.logpush ?? false).toBe(false);
      expect(config.tail_consumers ?? []).toEqual([]);
    }
  });

  test('apiはQueueを受信しない', () => {
    expect(api.queues.consumers ?? []).toEqual([]);
  });

  test('eventの本体のconsumerは再試行の上限を持ち、超えたらデッドレターへ移す', () => {
    const consumer = event.queues.consumers?.find(
      (entry) => entry.queue === jobsQueue,
    );

    expect(consumer?.dead_letter_queue).toBe(jobsDlq);
    expect(consumer?.max_retries).toBe(6);
  });

  test('eventはデッドレターも受信し、デッドレターの先を持たない', () => {
    const consumer = event.queues.consumers?.find(
      (entry) => entry.queue === jobsDlq,
    );

    expect(consumer).toBeDefined();
    expect(consumer?.dead_letter_queue).toBeUndefined();
  });

  test('IP制限は10秒あたり100回で、Workerごとの名前空間を使う', () => {
    for (const app of APP_NAMES) {
      const config = app === 'api' ? api : event;
      expect(findRateLimiter(config)).toEqual({
        name: 'IP_RATE_LIMITER',
        namespace_id: env.rateLimitNamespaceIds[app],
        simple: { limit: 100, period: 10 },
      });
    }
  });

  test('定期実行はapiだけが定義する', () => {
    expect(api.triggers.crons).toBeArray();
    expect(event.triggers.crons ?? []).toEqual([]);
  });
});

describe('Wrangler設定の環境をまたぐ整合', () => {
  test('IP制限の名前空間が環境・Workerごとにすべて異なる', () => {
    const namespaceIds = EXPECTED_ENVIRONMENTS.flatMap((env) =>
      APP_NAMES.map(
        (app) =>
          findRateLimiter(readEffectiveConfig(app, env.wranglerEnv))
            ?.namespace_id,
      ),
    );

    expect(new Set(namespaceIds).size).toBe(
      EXPECTED_ENVIRONMENTS.length * APP_NAMES.length,
    );
  });
});
