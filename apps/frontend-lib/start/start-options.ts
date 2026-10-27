import {
  sentryGlobalFunctionMiddleware,
  sentryGlobalRequestMiddleware,
} from '@sentry/tanstackstart-react';
import { createCsrfMiddleware } from '@tanstack/react-start';

import { requiresCsrfCheck } from '../server/http/csrf.ts';

// サーバーのエントリと同じ条件と判定でTanStack側でも検証し、サーバー関数のGETを守る。originとallowRequestsWithoutOriginCheckを指定しないことで、Originは要求のオリジンとの完全一致になり、ヘッダーがすべて無い要求は拒否される
const createFrontendCsrfMiddleware = () =>
  createCsrfMiddleware({
    referer: false,
    filter: ({ request }) => requiresCsrfCheck(request, new URL(request.url)),
  });

// Sentryのミドルウェアは後続の例外を送るため、各配列の先頭に置く
export function createFrontendStartOptions() {
  return () => ({
    requestMiddleware: [
      sentryGlobalRequestMiddleware,
      createFrontendCsrfMiddleware(),
    ] as const,
    functionMiddleware: [sentryGlobalFunctionMiddleware] as const,
  });
}
