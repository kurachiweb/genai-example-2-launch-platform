import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

import {
  DEFAULT_RETRY_POLICY,
  QUEUE_MAX_RETRIES,
} from '../../lib/core/messaging/retry-policy.ts';
import {
  appPath,
  EMAIL_CONFIG_KEY_PATTERN,
  readWranglerConfig,
  type WranglerAppName,
} from '../support/wrangler-config.ts';

type AppName = WranglerAppName;

const APP_NAMES = ['api', 'event'] as const satisfies readonly AppName[];

const COMPATIBILITY_DATE = '2026-08-04';

const R2_BINDINGS = ['IMAGES_BUCKET', 'FILES_BUCKET', 'QUARANTINE_BUCKET'];

const MIGRATIONS_DIR = 'db/migrations';

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
      jurisdiction: z.string().optional(),
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
          max_batch_size: z.number().optional(),
          max_batch_timeout: z.number().optional(),
          max_retries: z.number().optional(),
          dead_letter_queue: z.string().optional(),
          retry_delay: z.number().optional(),
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
  durable_objects: z.object({
    bindings: z.array(
      z.object({
        name: z.string(),
        class_name: z.string(),
        script_name: z.string().optional(),
      }),
    ),
  }),
  migrations: z.array(
    z.object({
      tag: z.string(),
      new_classes: z.array(z.string()).optional(),
      new_sqlite_classes: z.array(z.string()).optional(),
      renamed_classes: z.array(z.unknown()).optional(),
      deleted_classes: z.array(z.string()).optional(),
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
  readonly r2Jurisdiction: string | undefined;
  readonly rateLimitNamespaceIds: Readonly<Record<AppName, string>>;
  readonly logLevel: string;
  readonly sentryEnvironment: string;
  readonly sentryTracesSampleRate: string;
  readonly turnstileExpectedHostnames: string;
  readonly requiresSentryDsn: boolean;
  readonly appEnvironment: string;
}

const EXPECTED_ENVIRONMENTS: readonly ExpectedEnvironment[] = [
  {
    label: 'ローカル(ルート)',
    wranglerEnv: undefined,
    workerNameSuffix: '',
    resourceSuffix: 'dev',
    databaseId: '00000000-0000-4000-8000-000000000001',
    r2Jurisdiction: undefined,
    rateLimitNamespaceIds: { api: '1001', event: '1002' },
    logLevel: 'debug',
    sentryEnvironment: 'local',
    sentryTracesSampleRate: '0',
    turnstileExpectedHostnames: '',
    requiresSentryDsn: false,
    appEnvironment: 'local',
  },
  {
    label: 'staging',
    wranglerEnv: 'staging',
    workerNameSuffix: '-staging',
    resourceSuffix: 'staging',
    databaseId: '00000000-0000-0000-0000-000000000000',
    r2Jurisdiction: 'us',
    rateLimitNamespaceIds: { api: '2001', event: '2002' },
    logLevel: 'info',
    sentryEnvironment: 'staging',
    sentryTracesSampleRate: '1',
    turnstileExpectedHostnames:
      'genai-example-2-client-staging.lab.kurachiweb.com,genai-example-2-admin-staging.lab.kurachiweb.com',
    requiresSentryDsn: true,
    appEnvironment: 'staging',
  },
  {
    label: 'prod',
    wranglerEnv: 'prod',
    workerNameSuffix: '-prod',
    resourceSuffix: 'prod',
    databaseId: '00000000-0000-0000-0000-000000000000',
    r2Jurisdiction: 'us',
    rateLimitNamespaceIds: { api: '3001', event: '3002' },
    logLevel: 'info',
    sentryEnvironment: 'prod',
    sentryTracesSampleRate: '0.1',
    turnstileExpectedHostnames:
      'genai-example-2-client.lab.kurachiweb.com,genai-example-2-admin.lab.kurachiweb.com',
    requiresSentryDsn: true,
    appEnvironment: 'prod',
  },
];

function readEffectiveConfig(
  app: AppName,
  wranglerEnv: string | undefined,
): EffectiveConfig {
  return effectiveConfigSchema.parse(readWranglerConfig(app, wranglerEnv));
}

function withoutEmailKeys(keys: readonly string[]): string[] {
  return keys.filter((key) => !EMAIL_CONFIG_KEY_PATTERN.test(key));
}

function withoutEmailEntries(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([key]) => !EMAIL_CONFIG_KEY_PATTERN.test(key),
    ),
  );
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
    expect(api.main).toBe(appPath('api', 'src', 'index.ts'));
    expect(event.main).toBe(appPath('event', 'src', 'index.ts'));
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

  test('R2のバインディングの管轄が、両アプリでstaging・prodは米国、ローカルは指定なしである', () => {
    for (const config of [api, event]) {
      expect(config.r2_buckets.map((bucket) => bucket.jurisdiction)).toEqual(
        R2_BINDINGS.map(() => env.r2Jurisdiction),
      );
    }
  });

  test('両アプリが既定の公開サブドメインとプレビューURLを無効にし、ホスト名を設定で割り当てない', () => {
    for (const config of [api, event]) {
      expect(config.workers_dev).toBe(false);
      expect(config.preview_urls).toBe(false);
      expect(config.route).toBeUndefined();
      expect(config.routes ?? []).toEqual([]);
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

  test('eventはメール以外の必須シークレットとしてペッパーのキー名だけを宣言する', () => {
    expect(withoutEmailKeys(event.secrets?.required ?? [])).toEqual([
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
      APP_ENVIRONMENT: env.appEnvironment,
    });
  });

  test('eventのメール以外の変数はシークレットを含まず、環境ごとの値とQueue名を持つ', () => {
    expect(withoutEmailEntries(event.vars)).toStrictEqual({
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
    expect(consumer?.max_retries).toBe(QUEUE_MAX_RETRIES);
    expect(DEFAULT_RETRY_POLICY.maxAttempts).toBeLessThanOrEqual(
      QUEUE_MAX_RETRIES,
    );
  });

  test('eventの本体のconsumerは10件・5秒でまとめて受け取り、異常終了時は30秒後に再配信する', () => {
    const consumer = event.queues.consumers?.find(
      (entry) => entry.queue === jobsQueue,
    );

    expect(consumer).toMatchObject({
      max_batch_size: 10,
      max_batch_timeout: 5,
      retry_delay: 30,
    });
  });

  test('eventはデッドレターも受信し、デッドレターの先を持たない', () => {
    const consumer = event.queues.consumers?.find(
      (entry) => entry.queue === jobsDlq,
    );

    expect(consumer).toMatchObject({ max_batch_size: 10, max_retries: 3 });
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

  test('apiだけが厳密カウンタのDurable Objectを束縛し、SQLiteを使うクラスとして移行する', () => {
    expect(api.durable_objects.bindings).toStrictEqual([
      { name: 'RATE_LIMIT_COUNTER', class_name: 'RateLimitCounter' },
    ]);
    expect(api.migrations).toStrictEqual([
      { tag: 'v1', new_sqlite_classes: ['RateLimitCounter'] },
    ]);
    expect(event.durable_objects.bindings).toStrictEqual([]);
    expect(event.migrations).toStrictEqual([]);
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
