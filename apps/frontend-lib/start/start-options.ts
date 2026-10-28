import {
  createCsrfMiddleware,
  createIsomorphicFn,
} from '@tanstack/react-start';

import { requiresCsrfCheck } from '../server/http/csrf.ts';
import { responseCommitMiddleware } from './response-commit.ts';
import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from './sentry-middleware.server.ts';

// サーバーのエントリと同じ条件と判定でTanStack側でも検証し、サーバー関数のGETを守る。originとallowRequestsWithoutOriginCheckを指定しないことで、Originは要求のオリジンとの完全一致になり、ヘッダーがすべて無い要求は拒否される
const createFrontendCsrfMiddleware = () =>
  createCsrfMiddleware({
    referer: false,
    filter: ({ request }) => requiresCsrfCheck(request, new URL(request.url)),
  });

// ブラウザ向けのSDKの両ミドルウェアは何もしない空の実装である。ブラウザのバンドルが同じパッケージを静的に参照するとSDKの遅延読み込みの動的importが別のチャンクに分かれないため、サーバーの分岐だけで参照する
const readSentryMiddleware = createIsomorphicFn()
  .server(() => ({
    request: [sentryGlobalRequestMiddleware] as const,
    fn: [sentryGlobalFunctionMiddleware] as const,
  }))
  .client(() => ({ request: [] as const, fn: [] as const }));

// Sentryのミドルウェアは後続の例外を送るため、各配列の先頭に置く。応答の送り始めの記録は描画とサーバー関数の処理が戻った直後を捉えるため、最後に置く
export function createFrontendStartOptions() {
  return () => {
    const sentry = readSentryMiddleware();
    return {
      requestMiddleware: [
        ...sentry.request,
        createFrontendCsrfMiddleware(),
        responseCommitMiddleware,
      ] as const,
      functionMiddleware: [...sentry.fn] as const,
    };
  };
}
