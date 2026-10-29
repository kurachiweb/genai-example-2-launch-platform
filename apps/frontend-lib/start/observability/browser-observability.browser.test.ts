import { close, flush, getActiveSpan } from '@sentry/tanstackstart-react';
import type * as SentryBrowserSdk from '@sentry/tanstackstart-react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from 'vitest';

import type { PublicRuntimeConfig } from '../../server/env/frontend-env.ts';
import type { PersistedDocument } from '../../utilities/graphql/persisted-document.ts';
import { executeGraphQLWithGlobalFetch } from '../graphql/browser-transport.ts';
import {
  type BrowserSentryModules,
  initBrowserObservability,
  loadBrowserSentryModules,
} from './browser-observability.ts';
import { createBrowserErrorQueue } from './error-queue.ts';

type SentryTransport = NonNullable<
  NonNullable<Parameters<typeof SentryBrowserSdk.init>[0]>['transport']
>;

// エンベロープは[ヘッダー, [項目のヘッダー, 本体][]]の形で、項目の種類だけを見る
type SentEnvelope = readonly [
  unknown,
  readonly (readonly [{ readonly type: string }, unknown])[],
];

interface RecordedRequest {
  readonly url: string;
  readonly headers: Headers;
}

// SDKはDSNの公開鍵に英数字と_だけを受け付ける
const DSN = 'https://0123456789abcdef@o0.ingest.sentry.example/1';

const CONFIG: PublicRuntimeConfig['sentry'] = {
  dsn: DSN,
  environment: 'staging',
  tracesSampleRate: 0.1,
};

const EXTERNAL_URLS = [
  'https://o0.ingest.sentry.example/api/1/envelope/',
  'https://challenges.cloudflare.example/turnstile/v0/siteverify',
  'https://cloudflareinsights.example/cdn-cgi/rum',
] as const;

const DOCUMENT = {
  kind: 'Document',
  definitions: [],
  __meta__: { hash: `sha256:${'a'.repeat(64)}` },
} as unknown as PersistedDocument<unknown, never>;

// TanStack StartのViteのプラグインが無いテストでは、パッケージの入口がサーバーの部品まで読み込んで失敗する。ブラウザのビルドの変換と同じく関数をそのまま返す
vi.mock('@tanstack/react-start', () => ({
  createClientOnlyFn: <T>(fn: T): T => fn,
}));

const SAMPLED_FLAG_PATTERN = /^[0-9a-f]{32}-[0-9a-f]{16}-(?<sampled>[01])$/u;

const TRACE_ITEM_TYPES: ReadonlySet<unknown> = new Set(['span', 'transaction']);

const requests: RecordedRequest[] = [];

// SDKはfetchを初めの初期化の時に包むため、包まれる前に記録する偽物へ差し替え、テストの間は外部へ通信させない
const recordingFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> => {
  const request = new Request(input, init);
  requests.push({ url: request.url, headers: request.headers });
  return Promise.resolve(
    new Response('{"data":{}}', {
      status: 200,
      headers: { 'Content-Type': 'application/graphql-response+json' },
    }),
  );
};

// 実際のエラートラッキングへ送らないよう、本物の読み込みの結果の初期化に送信を記録するだけの偽物を足す
const recordingLoad =
  (sent: SentEnvelope[]) => async (): Promise<BrowserSentryModules> => {
    const modules = await loadBrowserSentryModules();
    const transport: SentryTransport = () => ({
      send: (envelope: SentEnvelope) => {
        sent.push(envelope);
        return Promise.resolve({});
      },
      flush: () => Promise.resolve(true),
    });
    return {
      ...modules,
      sdk: {
        ...modules.sdk,
        init: (options) => modules.sdk.init({ ...options, transport }),
      },
    };
  };

const createTestRouter = () => {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
  });
  return createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
};

const initWithRecording = async (sent: SentEnvelope[]): Promise<void> => {
  await initBrowserObservability({
    router: createTestRouter(),
    config: CONFIG,
    queue: createBrowserErrorQueue(),
    load: recordingLoad(sent),
  });
};

const relayRequest = (): RecordedRequest => {
  const found = requests.find(
    ({ url }) => new URL(url).pathname === '/_bff/graphql',
  );
  if (found === undefined) {
    throw new Error('中継の経路への要求が無い');
  }
  return found;
};

const sampledFlagOf = (request: RecordedRequest): string | undefined =>
  SAMPLED_FLAG_PATTERN.exec(request.headers.get('sentry-trace') ?? '')
    ?.groups?.['sampled'];

const traceItemCount = (sent: readonly SentEnvelope[]): number =>
  sent
    .flatMap(([, items]) => items)
    .filter(([header]) => TRACE_ITEM_TYPES.has(header.type)).length;

// 画面の読み込みのトレースを待たずに終え、溜まったスパンを送らせる
const finishPageLoadTrace = async (): Promise<void> => {
  getActiveSpan()?.end();
  await flush(2_000);
};

beforeAll(() => {
  vi.stubGlobal('fetch', recordingFetch);
});

afterEach(async () => {
  getActiveSpan()?.end();
  await close(2_000);
  vi.restoreAllMocks();
  requests.length = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe('initBrowserObservability(本物のSDKでのトレースの伝搬)', () => {
  test('中継の経路への要求にだけsentry-trace・baggageを付け、外部の宛先には付けない', async () => {
    await initWithRecording([]);

    await executeGraphQLWithGlobalFetch(DOCUMENT, {});
    for (const url of EXTERNAL_URLS) {
      await fetch(url);
    }

    expect(relayRequest().headers.get('sentry-trace')).toMatch(
      SAMPLED_FLAG_PATTERN,
    );
    expect(relayRequest().headers.get('baggage')).toContain('sentry-trace_id=');
    const external = requests.filter(({ url }) =>
      (EXTERNAL_URLS as readonly string[]).includes(url),
    );
    expect(external.map(({ url }) => url)).toEqual([...EXTERNAL_URLS]);
    for (const { headers } of external) {
      expect(headers.has('sentry-trace')).toBe(false);
      expect(headers.has('baggage')).toBe(false);
    }
  });
});

describe('initBrowserObservability(本物のSDKでのトレースの割合)', () => {
  test('割合が0.1でMath.randomが0.05なら、トレースを記録して送る', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.05);
    const sent: SentEnvelope[] = [];
    await initWithRecording(sent);

    await executeGraphQLWithGlobalFetch(DOCUMENT, {});
    await finishPageLoadTrace();

    expect(sampledFlagOf(relayRequest())).toBe('1');
    expect(traceItemCount(sent)).toBeGreaterThan(0);
  });

  test('割合が0.1でMath.randomが0.5なら、トレースを送らない', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const sent: SentEnvelope[] = [];
    await initWithRecording(sent);

    await executeGraphQLWithGlobalFetch(DOCUMENT, {});
    await finishPageLoadTrace();

    expect(sampledFlagOf(relayRequest())).toBe('0');
    expect(traceItemCount(sent)).toBe(0);
  });
});
