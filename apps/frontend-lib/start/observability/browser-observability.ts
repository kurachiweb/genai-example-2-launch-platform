import type * as SentryBrowserSdk from '@sentry/tanstackstart-react';
import { createClientOnlyFn } from '@tanstack/react-start';

import type { PublicRuntimeConfig } from '../../server/env/frontend-env.ts';
import { RELAY_PATH_PREFIX } from '../../server/relay/relay-contract.ts';
import type * as SentryScrub from '../../utilities/observability/sentry-scrub.ts';
import type { BrowserErrorQueue } from './error-queue.ts';

export interface BrowserSentryModules {
  readonly sdk: Pick<
    typeof SentryBrowserSdk,
    'init' | 'tanstackRouterBrowserTracingIntegration' | 'captureException'
  >;
  readonly scrub: Pick<
    typeof SentryScrub,
    'SENTRY_DATA_COLLECTION' | 'scrubSentryEvent' | 'scrubSentrySpan'
  >;
}

export interface BrowserObservabilityInput {
  // TanStack Routerのインスタンス。SentryのルーターのトレースがTanStackの型に依存しない形で受けるため型を持たない
  readonly router: unknown;
  readonly config: PublicRuntimeConfig['sentry'];
  readonly queue: BrowserErrorQueue;
  readonly load?: () => Promise<BrowserSentryModules>;
}

// ブラウザのSDKは同じオリジンの経路の部分とも照合する。外部のエラートラッキング・bot判定・アクセス解析へsentry-trace・baggageを送らないよう、中継の経路だけにする
export const RELAY_TRACE_PROPAGATION_TARGETS: readonly RegExp[] = Object.freeze(
  [new RegExp(`^${RELAY_PATH_PREFIX}`, 'u')],
);

// 除去の関数は伏せ字のパターン(@logtape/redaction)を含み主バンドルを大きくするため、SDKと一緒に初期化の時に読み込む。Workersの条件ではSDKが@sentry/nodeを含むサーバー版に解決されるため、サーバーのビルドでは関数ごとimportを落とす
export const loadBrowserSentryModules = createClientOnlyFn(
  async (): Promise<BrowserSentryModules> => {
    const [sdk, scrub] = await Promise.all([
      import('@sentry/tanstackstart-react'),
      import('../../utilities/observability/sentry-scrub.ts'),
    ]);
    return { sdk, scrub };
  },
);

const startedQueues = new WeakSet<BrowserErrorQueue>();

export async function initBrowserObservability(
  input: BrowserObservabilityInput,
): Promise<void> {
  const { dsn, environment, tracesSampleRate } = input.config;
  if (dsn === undefined || startedQueues.has(input.queue)) {
    return;
  }
  startedQueues.add(input.queue);
  try {
    const { sdk, scrub } = await (input.load ?? loadBrowserSentryModules)();
    sdk.init({
      dsn,
      environment,
      tracesSampleRate,
      integrations: [sdk.tanstackRouterBrowserTracingIntegration(input.router)],
      tracePropagationTargets: [...RELAY_TRACE_PROPAGATION_TARGETS],
      dataCollection: scrub.SENTRY_DATA_COLLECTION,
      beforeSend: scrub.scrubSentryEvent,
      beforeSendSpan: scrub.scrubSentrySpan,
    });
    input.queue.flush((error) => {
      sdk.captureException(error);
    });
  } catch {
    // 読み込みと初期化の失敗で画面を止めない。ブラウザには失敗を伝える先が他に無く、consoleへも出さない。積んだ失敗は列に残る
  }
}
