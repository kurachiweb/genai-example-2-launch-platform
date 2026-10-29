import { describe, expect, test } from 'bun:test';

import { PLACEHOLDER_UUID } from '../test-fixtures/resource-catalog.ts';
import {
  STAGING_D1_DATABASE_ID,
  wranglerJsoncOf,
} from '../test-fixtures/wrangler-config.ts';
import {
  type EffectiveWranglerConfig,
  type WranglerParseResult,
  readEffectiveConfig,
} from './wrangler-config.ts';

const configOf = (result: WranglerParseResult): EffectiveWranglerConfig => {
  if (!result.ok) throw new Error(result.error);
  return result.config;
};

const errorOf = (result: WranglerParseResult): string =>
  result.ok ? '' : result.error;

const effectiveOf = (
  config: Record<string, unknown>,
  environment: 'staging' | 'prod' = 'staging',
): EffectiveWranglerConfig =>
  configOf(readEffectiveConfig(JSON.stringify(config), environment));

describe('readEffectiveConfig', () => {
  test('環境の節の値と最上位から継承した値を合わせた実効値を返す', () => {
    const jsonc = wranglerJsoncOf('api');

    const result = readEffectiveConfig(jsonc, 'staging');

    expect(result).toEqual({
      ok: true,
      config: {
        workerName: 'app-api-staging',
        workersDev: false,
        previewUrls: false,
        hasRoutes: false,
        d1: [
          {
            binding: 'DB',
            databaseName: 'app-staging',
            databaseId: STAGING_D1_DATABASE_ID,
          },
        ],
        r2: [
          {
            binding: 'IMAGES_BUCKET',
            bucketName: 'app-images-staging',
            jurisdiction: 'us',
          },
          {
            binding: 'FILES_BUCKET',
            bucketName: 'app-files-staging',
            jurisdiction: 'us',
          },
          {
            binding: 'QUARANTINE_BUCKET',
            bucketName: 'app-quarantine-staging',
            jurisdiction: 'us',
          },
        ],
        queueNames: ['app-jobs-staging'],
        queueConsumers: [],
        services: [],
        vars: { LOG_LEVEL: 'info', APP_ENVIRONMENT: 'staging' },
        requiredSecrets: ['HASH_PEPPER', 'SENTRY_DSN'],
        sourcePaths: {
          name: 'name',
          workersDev: 'workers_dev',
          previewUrls: 'preview_urls',
          routes: 'route・routes',
        },
      },
    });
  });

  test('指定した環境の節だけを読む', () => {
    const config = configOf(
      readEffectiveConfig(wranglerJsoncOf('api'), 'prod'),
    );

    expect(config.workerName).toBe('app-api-prod');
    expect(config.d1).toEqual([
      { binding: 'DB', databaseName: 'app-prod', databaseId: PLACEHOLDER_UUID },
    ]);
  });

  test('Queueの名前に送信先・受信元・配信不能の受け皿を重複なく並べ、受信元を別に返す', () => {
    const config = configOf(
      readEffectiveConfig(wranglerJsoncOf('event'), 'staging'),
    );

    expect(config.queueNames).toEqual([
      'app-jobs-staging',
      'app-jobs-dlq-staging',
      'app-email-events-staging',
    ]);
    expect(config.queueConsumers).toEqual([
      'app-jobs-staging',
      'app-jobs-dlq-staging',
      'app-email-events-staging',
    ]);
  });

  test('Service Bindingsの接続先のWorker名を返す', () => {
    const config = configOf(
      readEffectiveConfig(wranglerJsoncOf('client'), 'staging'),
    );

    expect(config.services).toEqual(['app-api-staging']);
  });

  test('環境の節に名前・公開URLの設定・ルートが無ければ最上位の値を継承し、出どころに最上位のキーを返す', () => {
    const config = effectiveOf({
      name: 'worker',
      workers_dev: true,
      preview_urls: true,
      routes: [{ pattern: 'app.example/*', zone_name: 'app.example' }],
      env: { staging: {} },
    });

    expect(config.workerName).toBe('worker-staging');
    expect(config.workersDev).toBe(true);
    expect(config.previewUrls).toBe(true);
    expect(config.hasRoutes).toBe(true);
    expect(config.sourcePaths).toEqual({
      name: 'name',
      workersDev: 'workers_dev',
      previewUrls: 'preview_urls',
      routes: 'routes',
    });
  });

  test('最上位の単数形のrouteも継承するルートとして扱う', () => {
    const config = effectiveOf({
      name: 'worker',
      route: 'app.example/*',
      env: { staging: {} },
    });

    expect(config.hasRoutes).toBe(true);
    expect(config.sourcePaths.routes).toBe('route');
  });

  test('環境の節の名前・公開URLの設定・ルートは最上位の値より優先し、出どころに環境の節のキーを返す', () => {
    const config = effectiveOf({
      name: 'worker',
      workers_dev: true,
      preview_urls: true,
      routes: [{ pattern: 'app.example/*', zone_name: 'app.example' }],
      env: {
        staging: {
          name: 'custom-worker',
          workers_dev: false,
          preview_urls: false,
          routes: [],
        },
      },
    });

    expect(config.workerName).toBe('custom-worker');
    expect(config.workersDev).toBe(false);
    expect(config.previewUrls).toBe(false);
    expect(config.hasRoutes).toBe(false);
    expect(config.sourcePaths).toEqual({
      name: 'env.staging.name',
      workersDev: 'env.staging.workers_dev',
      previewUrls: 'env.staging.preview_urls',
      routes: 'env.staging.routes',
    });
  });

  test('公開URLの設定がどこにも無ければ未指定として返す', () => {
    const config = effectiveOf({ name: 'worker', env: { staging: {} } });

    expect(config.workersDev).toBeUndefined();
    expect(config.previewUrls).toBeUndefined();
    expect(config.hasRoutes).toBe(false);
  });

  test('継承しないキーは最上位にあっても環境の節に無ければ空とする', () => {
    const config = effectiveOf({
      name: 'worker',
      d1_databases: [
        { binding: 'DB', database_name: 'app-dev', database_id: 'local' },
      ],
      r2_buckets: [{ binding: 'BUCKET', bucket_name: 'app-dev' }],
      queues: {
        producers: [{ binding: 'JOBS', queue: 'app-jobs-dev' }],
        consumers: [{ queue: 'app-jobs-dev' }],
      },
      services: [{ binding: 'API', service: 'app-api' }],
      vars: { LOG_LEVEL: 'debug' },
      secrets: { required: ['HASH_PEPPER'] },
      env: { staging: {} },
    });

    expect(config.d1).toEqual([]);
    expect(config.r2).toEqual([]);
    expect(config.queueNames).toEqual([]);
    expect(config.queueConsumers).toEqual([]);
    expect(config.services).toEqual([]);
    expect(config.vars).toEqual({});
    expect(config.requiredSecrets).toEqual([]);
  });

  test('管轄の無いR2のバインディングは管轄を未指定として返す', () => {
    const config = effectiveOf({
      name: 'worker',
      env: {
        staging: { r2_buckets: [{ binding: 'BUCKET', bucket_name: 'b' }] },
      },
    });

    expect(config.r2).toEqual([
      { binding: 'BUCKET', bucketName: 'b', jurisdiction: undefined },
    ]);
  });

  test('文字列でない変数の値はJSONの表記にする', () => {
    const config = effectiveOf({
      name: 'worker',
      env: { staging: { vars: { RATE: 0.1, ENABLED: true, NAME: 'a' } } },
    });

    expect(config.vars).toEqual({ RATE: '0.1', ENABLED: 'true', NAME: 'a' });
  });

  test.each([
    ['JSONCとして解析できない', '{ "name": ', 'JSONCとして解析できません'],
    ['最上位が配列である', '[]', '(最上位): オブジェクトが必要です'],
    [
      '環境の一覧が無い',
      JSON.stringify({ name: 'worker' }),
      'env.staging: オブジェクトが必要です',
    ],
    [
      '対象の環境の節が無い',
      JSON.stringify({ name: 'worker', env: { prod: {} } }),
      'env.staging: オブジェクトが必要です',
    ],
    [
      '名前が無い',
      JSON.stringify({ env: { staging: {} } }),
      'name: 文字列が必要です',
    ],
    [
      '環境の節の名前が文字列でない',
      JSON.stringify({ name: 'worker', env: { staging: { name: 1 } } }),
      'env.staging.name: 文字列が必要です',
    ],
    [
      'workers_devが真偽値でない',
      JSON.stringify({
        name: 'worker',
        workers_dev: 'false',
        env: { staging: {} },
      }),
      'workers_dev: 真偽値が必要です',
    ],
    [
      '環境の節のpreview_urlsが真偽値でない',
      JSON.stringify({
        name: 'worker',
        env: { staging: { preview_urls: 0 } },
      }),
      'env.staging.preview_urls: 真偽値が必要です',
    ],
    [
      'D1の識別子が無い',
      JSON.stringify({
        name: 'worker',
        env: {
          staging: { d1_databases: [{ binding: 'DB', database_name: 'd' }] },
        },
      }),
      'env.staging.d1_databases[0].database_id: 文字列が必要です',
    ],
    [
      'R2のバインディングの一覧が配列でない',
      JSON.stringify({
        name: 'worker',
        env: { staging: { r2_buckets: { binding: 'BUCKET' } } },
      }),
      'env.staging.r2_buckets: 配列が必要です',
    ],
    [
      'R2の管轄が文字列でない',
      JSON.stringify({
        name: 'worker',
        env: {
          staging: {
            r2_buckets: [{ binding: 'B', bucket_name: 'b', jurisdiction: 1 }],
          },
        },
      }),
      'env.staging.r2_buckets[0].jurisdiction: 文字列が必要です',
    ],
    [
      'Queueの設定がオブジェクトでない',
      JSON.stringify({ name: 'worker', env: { staging: { queues: [] } } }),
      'env.staging.queues: オブジェクトが必要です',
    ],
    [
      '受信元の配信不能の受け皿が文字列でない',
      JSON.stringify({
        name: 'worker',
        env: {
          staging: {
            queues: { consumers: [{ queue: 'q', dead_letter_queue: 1 }] },
          },
        },
      }),
      'env.staging.queues.consumers[0].dead_letter_queue: 文字列が必要です',
    ],
    [
      'Service Bindingsの要素がオブジェクトでない',
      JSON.stringify({
        name: 'worker',
        env: { staging: { services: ['app-api'] } },
      }),
      'env.staging.services[0]: オブジェクトが必要です',
    ],
    [
      '必須のシークレットが文字列の配列でない',
      JSON.stringify({
        name: 'worker',
        env: { staging: { secrets: { required: [1] } } },
      }),
      'env.staging.secrets.required[0]: 文字列が必要です',
    ],
  ])('%sときは解析の誤りを返す', (_, jsonc, expected) => {
    const result = readEffectiveConfig(jsonc, 'staging');

    expect(result.ok).toBe(false);
    expect(errorOf(result)).toStartWith(expected);
  });
});
