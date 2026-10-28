import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import type { CloudflareOptions } from '@sentry/cloudflare';

import {
  scrubSentryEvent,
  scrubSentrySpan,
  SENTRY_DATA_COLLECTION,
} from '../../utilities/observability/sentry-scrub.ts';
import {
  buildServerSentryOptions,
  type ServerSentryOptions,
} from './server-sentry-options.ts';

const SENTRY_DSN = 'https://public-key@sentry.example/1';

const validRawEnv = (): Record<string, unknown> => ({
  API: {
    fetch: (): Promise<Response> => Promise.resolve(new Response(null)),
  },
  IP_RATE_LIMITER: {
    limit: (): Promise<{ readonly success: boolean }> =>
      Promise.resolve({ success: true }),
  },
  APP_ENVIRONMENT: 'prod',
  LOG_LEVEL: 'info',
  SENTRY_ENVIRONMENT: 'prod',
  SENTRY_TRACES_SAMPLE_RATE: '0.1',
  SENTRY_DSN,
  TURNSTILE_SITE_KEY: '1x00000000000000000000BB',
  IMAGES_ORIGIN: 'https://images.example',
  WEB_ANALYTICS_TOKEN: 'analytics-token',
});

const build = (overrides: Record<string, unknown> = {}): ServerSentryOptions =>
  buildServerSentryOptions({ ...validRawEnv(), ...overrides });

const DISABLED_OPTIONS = {
  dsn: undefined,
  enabled: false,
  environment: 'unknown',
  tracesSampleRate: 0,
};

const RECORDING_AND_FEEDBACK_PACKAGES = [
  '@sentry/browser',
  '@sentry/feedback',
  '@sentry/replay',
  '@sentry/replay-canvas',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readDependencies = (packageName: string): readonly string[] => {
  const manifest: unknown = JSON.parse(
    readFileSync(
      Bun.resolveSync(`${packageName}/package.json`, import.meta.dir),
      'utf8',
    ),
  );
  const dependencies = isRecord(manifest) ? manifest['dependencies'] : {};
  return isRecord(dependencies) ? Object.keys(dependencies) : [];
};

// 実行時に読み込まれ得る@sentry/*のパッケージを、依存関係をたどって集める
const collectSentryRuntimePackages = (root: string): ReadonlySet<string> => {
  const visited = new Set<string>();
  const pending = [root];
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    if (visited.has(name)) {
      continue;
    }
    visited.add(name);
    pending.push(
      ...readDependencies(name).filter((dependency) =>
        dependency.startsWith('@sentry/'),
      ),
    );
  }
  return visited;
};

describe('buildServerSentryOptions', () => {
  describe('有効な環境', () => {
    test('送信先・環境・トレースの割合を環境から設定して送信を有効にする', () => {
      const options = build();

      expect(options).toMatchObject({
        dsn: SENTRY_DSN,
        enabled: true,
        environment: 'prod',
        tracesSampleRate: 0.1,
      });
    });

    test('個人情報を集めない収集の設定と、イベント・スパンの除去の関数を適用する', () => {
      const options = build();

      expect(options.dataCollection).toBe(SENTRY_DATA_COLLECTION);
      expect(options.dataCollection).toMatchObject({
        userInfo: false,
        cookies: false,
        httpBodies: [],
        urlQueryParams: false,
      });
      expect(options.beforeSend).toBe(scrubSentryEvent);
      expect(options.beforeSendSpan).toBe(scrubSentrySpan);
    });

    test('@sentry/cloudflareの初期化オプションとして渡せる', () => {
      const options: CloudflareOptions = build();

      expect(options.dsn).toBe(SENTRY_DSN);
    });
  });

  describe('送信先が無い環境', () => {
    test.each([
      ['無い', undefined],
      ['空文字列', ''],
    ])('SENTRY_DSNが%sなら送信を無効にする', (_label, dsn) => {
      const options = build({ SENTRY_DSN: dsn });

      expect(options.dsn).toBeUndefined();
      expect(options.enabled).toBe(false);
    });

    test('送信先が無くても、環境・トレースの割合・除去の設定は環境の値のまま返す', () => {
      const options = build({ SENTRY_DSN: undefined });

      expect(options).toMatchObject({
        environment: 'prod',
        tracesSampleRate: 0.1,
        dataCollection: SENTRY_DATA_COLLECTION,
        beforeSend: scrubSentryEvent,
        beforeSendSpan: scrubSentrySpan,
      });
    });
  });

  describe('不正な環境', () => {
    test.each([
      ['オブジェクトでない', null],
      ['必要なキーを欠く', { SENTRY_DSN }],
    ])('環境が%s場合は、例外を投げずに送信を無効にする', (_label, env) => {
      const options = buildServerSentryOptions(env);

      expect(options).toMatchObject(DISABLED_OPTIONS);
    });

    test.each([
      ['トレースの割合が範囲外', { SENTRY_TRACES_SAMPLE_RATE: '1.5' }],
      ['環境の種別が不正', { APP_ENVIRONMENT: 'production' }],
      ['バインディングが無い', { API: undefined }],
    ])(
      '送信先があっても%sなら、送信を無効にしてトレースを取らない',
      (_label, overrides) => {
        const options = build(overrides);

        expect(options).toMatchObject(DISABLED_OPTIONS);
      },
    );

    test('不正な環境でも除去の関数と収集の設定は適用したまま返す', () => {
      const options = buildServerSentryOptions(undefined);

      expect(options.dataCollection).toBe(SENTRY_DATA_COLLECTION);
      expect(options.beforeSend).toBe(scrubSentryEvent);
      expect(options.beforeSendSpan).toBe(scrubSentrySpan);
    });
  });

  describe('画面操作の録画とフィードバック', () => {
    test('統合を加えず、既定の統合を置き換えない', () => {
      const options = build();

      expect(Object.keys(options)).not.toContain('integrations');
      expect(Object.keys(options)).not.toContain('defaultIntegrations');
    });

    test('@sentry/cloudflareの既定の統合は、録画とフィードバックの統合を持つパッケージに依存しない', () => {
      const packages = collectSentryRuntimePackages('@sentry/cloudflare');

      expect(packages).toContain('@sentry/core');
      for (const excluded of RECORDING_AND_FEEDBACK_PACKAGES) {
        expect(packages).not.toContain(excluded);
      }
    });
  });
});
