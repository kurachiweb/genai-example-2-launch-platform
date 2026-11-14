import { describe, expect, test } from 'bun:test';

import type { PublicRuntimeConfig } from '../../server/env/frontend-env.ts';
import {
  scrubSentryEvent,
  scrubSentrySpan,
  SENTRY_DATA_COLLECTION,
} from '../../utilities/observability/sentry-scrub.ts';
import {
  type BrowserSentryModules,
  initBrowserObservability,
  loadBrowserSentryModules,
  RELAY_TRACE_PROPAGATION_TARGETS,
} from './browser-observability.ts';
import { createBrowserErrorQueue } from './error-queue.ts';

type SentryConfig = PublicRuntimeConfig['sentry'];

const DSN = 'https://public-key@o0.ingest.sentry.example/1';

const CONFIG: SentryConfig = {
  dsn: DSN,
  environment: 'staging',
  tracesSampleRate: 0.1,
};

const ROUTER = { name: 'テスト用のルーター' };

const ROUTER_TRACING = { name: 'TanStackRouterBrowserTracing' };

interface FakeSdk {
  readonly modules: BrowserSentryModules;
  readonly initOptions: unknown[];
  readonly tracedRouters: unknown[];
  readonly captured: unknown[];
}

const fakeSdk = (overrides: { readonly init?: () => never } = {}): FakeSdk => {
  const initOptions: unknown[] = [];
  const tracedRouters: unknown[] = [];
  const captured: unknown[] = [];
  const sdk = {
    init: (options: unknown) => {
      initOptions.push(options);
      overrides.init?.();
      return undefined;
    },
    tanstackRouterBrowserTracingIntegration: (router: unknown) => {
      tracedRouters.push(router);
      return ROUTER_TRACING;
    },
    captureException: (error: unknown) => {
      captured.push(error);
      return 'event-id';
    },
  } as unknown as BrowserSentryModules['sdk'];
  return {
    modules: {
      sdk,
      scrub: { scrubSentryEvent, scrubSentrySpan, SENTRY_DATA_COLLECTION },
    },
    initOptions,
    tracedRouters,
    captured,
  };
};

const countingLoader = (
  load: () => Promise<BrowserSentryModules>,
): { readonly calls: () => number; readonly load: typeof load } => {
  let count = 0;
  return {
    calls: () => count,
    load: () => {
      count += 1;
      return load();
    },
  };
};

describe('initBrowserObservability(送信先が無い場合)', () => {
  test('送信先が無ければSDKを読み込まず、積んだ失敗も送らない', async () => {
    const queue = createBrowserErrorQueue();
    const fake = fakeSdk();
    const loader = countingLoader(() => Promise.resolve(fake.modules));
    queue.enqueue(new Error('初期化の前'));

    await initBrowserObservability({
      router: ROUTER,
      config: { ...CONFIG, dsn: undefined },
      queue,
      load: loader.load,
    });

    expect(loader.calls()).toBe(0);
    expect(fake.captured).toEqual([]);
  });
});

describe('initBrowserObservability(初期化)', () => {
  test('送信先・環境・トレースの割合・ルーターのトレース・中継の経路への伝搬・除去の関数・収集の設定で初期化する', async () => {
    const fake = fakeSdk();

    await initBrowserObservability({
      router: ROUTER,
      config: CONFIG,
      queue: createBrowserErrorQueue(),
      load: () => Promise.resolve(fake.modules),
    });

    expect(fake.tracedRouters).toEqual([ROUTER]);
    expect(fake.initOptions).toHaveLength(1);
    const [options] = fake.initOptions as [Record<string, unknown>];
    expect(options).toEqual({
      dsn: DSN,
      environment: 'staging',
      tracesSampleRate: 0.1,
      integrations: [ROUTER_TRACING],
      tracePropagationTargets: RELAY_TRACE_PROPAGATION_TARGETS,
      dataCollection: SENTRY_DATA_COLLECTION,
      beforeSend: scrubSentryEvent,
      beforeSendSpan: scrubSentrySpan,
    });
    expect(options['beforeSend']).toBe(scrubSentryEvent);
    expect(options['beforeSendSpan']).toBe(scrubSentrySpan);
  });

  test('初期化の前に積んだ失敗を送り、以降の失敗は直接送る', async () => {
    const queue = createBrowserErrorQueue();
    const fake = fakeSdk();
    const queued = new Error('初期化の前');
    const later = new Error('初期化の後');
    queue.enqueue(queued);

    await initBrowserObservability({
      router: ROUTER,
      config: CONFIG,
      queue,
      load: () => Promise.resolve(fake.modules),
    });
    queue.enqueue(later);

    expect(fake.captured).toEqual([queued, later]);
  });

  test('同じ列で2回呼んでも読み込みと初期化は1回だけ', async () => {
    const queue = createBrowserErrorQueue();
    const fake = fakeSdk();
    const loader = countingLoader(() => Promise.resolve(fake.modules));
    const input = { router: ROUTER, config: CONFIG, queue, load: loader.load };

    await Promise.all([
      initBrowserObservability(input),
      initBrowserObservability(input),
    ]);

    expect(loader.calls()).toBe(1);
    expect(fake.initOptions).toHaveLength(1);
  });
});

describe('initBrowserObservability(失敗)', () => {
  test('読み込みの失敗は例外にせず、積んだ失敗を送らずに列に残す', async () => {
    const queue = createBrowserErrorQueue();
    queue.enqueue(new Error('初期化の前'));
    let sent = false;

    await initBrowserObservability({
      router: ROUTER,
      config: CONFIG,
      queue,
      load: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    queue.flush(() => {
      sent = true;
    });

    expect(sent).toBe(true);
  });

  test('初期化の例外は呼び出し元へ伝えず、積んだ失敗を送らない', async () => {
    const queue = createBrowserErrorQueue();
    const fake = fakeSdk({
      init: () => {
        throw new Error('初期化に失敗しました');
      },
    });
    queue.enqueue(new Error('初期化の前'));

    await initBrowserObservability({
      router: ROUTER,
      config: CONFIG,
      queue,
      load: () => Promise.resolve(fake.modules),
    });

    expect(fake.captured).toEqual([]);
  });
});

describe('RELAY_TRACE_PROPAGATION_TARGETS', () => {
  const propagates = (url: string): boolean =>
    RELAY_TRACE_PROPAGATION_TARGETS.some((target) => target.test(url));

  test.each(['/_bff/graphql', '/_bff/uploads/images'])(
    '中継の経路%sへトレースを伝える',
    (url) => {
      expect(propagates(url)).toBe(true);
    },
  );

  test.each([
    'https://o0.ingest.sentry.example/api/1/envelope/',
    'https://challenges.cloudflare.com/turnstile/v0/api.js',
    'https://static.cloudflareinsights.com/beacon.min.js',
    'https://cloudflareinsights.com/cdn-cgi/rum',
    'https://other.example/_bff/graphql',
    '/_bffx/graphql',
    '/launches',
  ])('中継の経路でない%sへトレースを伝えない', (url) => {
    expect(propagates(url)).toBe(false);
  });
});

describe('loadBrowserSentryModules', () => {
  test('既定の読み込み関数は、SDKの初期化・ルーターのトレース・送信の関数と除去の関数を返す', async () => {
    const { sdk, scrub } = await loadBrowserSentryModules();

    expect(typeof sdk.init).toBe('function');
    expect(typeof sdk.tanstackRouterBrowserTracingIntegration).toBe('function');
    expect(typeof sdk.captureException).toBe('function');
    expect(scrub.scrubSentryEvent).toBe(scrubSentryEvent);
    expect(scrub.scrubSentrySpan).toBe(scrubSentrySpan);
    expect(scrub.SENTRY_DATA_COLLECTION).toBe(SENTRY_DATA_COLLECTION);
  });
});
