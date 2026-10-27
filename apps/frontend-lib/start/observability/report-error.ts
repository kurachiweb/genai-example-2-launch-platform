import { createIsomorphicFn } from '@tanstack/react-start';

import {
  type BrowserErrorQueue,
  createBrowserErrorQueue,
  type ReportSource,
} from './error-queue.ts';
import { reportUnexpectedErrorOnServer } from './report-error.server.ts';

export type { ReportSource };

// ブラウザで1つだけ持ち、Sentryを読み込むまでの失敗を積む。initBrowserObservabilityへ同じ列を渡す
export const browserErrorQueue: BrowserErrorQueue = createBrowserErrorQueue();

// サーバーの分岐は、ブラウザ向けのビルドで分岐ごと消えてサーバー専用のファイルのimportも消えるよう、その場の関数で書く
const reportIsomorphic = createIsomorphicFn()
  .server((error: unknown, source: ReportSource): void => {
    reportUnexpectedErrorOnServer(error, source);
  })
  .client(browserErrorQueue.enqueue);

export function reportUnexpectedError(
  error: unknown,
  source: ReportSource,
): void {
  reportIsomorphic(error, source);
}

export interface RenderErrorRouter {
  readonly state: {
    readonly matches: readonly { readonly error: unknown }[];
  };
}

// ルーターのdefaultOnCatchから呼ぶ。TanStack Routerはmatchのloaderの失敗をそのまま投げ直して描画の境界で捕まえさせる。loaderの失敗は、ブラウザの遷移ではルートのonErrorが、ハイドレーションではサーバーが既に送っている。ハイドレーションで復元した失敗はメッセージだけの別のErrorで想定内かどうかも判定できないため、matchの失敗と同じ例外は描画の例外として送らない
export function reportRenderError(
  router: RenderErrorRouter,
  error: unknown,
): void {
  if (
    error !== undefined &&
    router.state.matches.some((match) => match.error === error)
  ) {
    return;
  }
  reportUnexpectedError(error, 'render');
}
