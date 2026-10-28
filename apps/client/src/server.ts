// Zodはスキーマを作る時点でJITの可否を判定するため、どのスキーマを持つモジュールよりも先にjitlessの設定を評価させる
import '../lib/utilities/validation/zod.ts';

import { captureException, getTraceData, withSentry } from '@sentry/cloudflare';
import { wrapFetchWithSentry } from '@sentry/tanstackstart-react';
import handler from '@tanstack/react-start/server-entry';

import {
  createFrontendServerEntry,
  type StartHandler,
} from '../lib/server/entry/create-frontend-server-entry.ts';
import type { FrontendRequestContext } from '../lib/server/entry/request-context.ts';
import { buildServerSentryOptions } from '../lib/server/observability/server-sentry-options.ts';
import { CLIENT_PROFILE } from './composition/app-profile.ts';
import { RELAY_ROUTES } from './composition/relay-routes.ts';
import { CLIENT_SECURITY_POLICY } from './composition/security-policy.ts';

// wrapFetchWithSentryは渡したオブジェクトのfetchを置き換えるため、TanStack Startのハンドラーそのものではなく包んだオブジェクトを渡す
const instrumentedHandler = wrapFetchWithSentry({
  fetch: (
    request: Request,
    options: { readonly context: FrontendRequestContext },
  ) => handler.fetch(request, options),
});

const startHandler: StartHandler = {
  fetch: async (request, options) =>
    await instrumentedHandler.fetch(request, options),
};

export default withSentry(
  (env) => buildServerSentryOptions(env),
  createFrontendServerEntry({
    profile: CLIENT_PROFILE,
    startHandler,
    relayRoutes: RELAY_ROUTES,
    securityPolicy: CLIENT_SECURITY_POLICY,
    reportUnexpected: captureException,
    traceHeaders: () => ({ ...getTraceData() }),
  }),
);

declare module '@tanstack/react-start' {
  interface Register {
    server: { requestContext: FrontendRequestContext };
  }
}
