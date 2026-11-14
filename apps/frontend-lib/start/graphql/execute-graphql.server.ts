import {
  getRequest,
  getResponseHeaders,
  setResponseHeader,
} from '@tanstack/react-start/server';

import type { FrontendRequestContext } from '../../server/entry/request-context.ts';
import { getFrontendLogger } from '../../server/observability/logging.ts';
import {
  GRAPHQL_RELAY_ROUTE,
  relayToApi,
} from '../../server/relay/relay-route.ts';
import { mergeSessionSetCookies } from '../../server/relay/session-cookie.ts';
import {
  createNetworkError,
  type GraphQLResult,
  parseGraphQLResponse,
} from '../../utilities/graphql/graphql-result.ts';
import { readFrontendRequestContext } from '../request-context.server.ts';
import { isResponseCommitted } from '../response-commit.ts';
import {
  type AnyPersistedDocument,
  buildGraphQLRequest,
  type ExecuteOptions,
} from './browser-transport.ts';

const sessionLoggerOf = (context: FrontendRequestContext) =>
  getFrontendLogger([context.caller, 'relay', 'session']);

// ブラウザからの中継と同じ要求を組み立てて同じ中継の処理へ渡し、項目の引き継ぎ・待ち時間・失敗の扱い・Cookieの指示の解釈をそろえる
const relayFromPage = (
  context: FrontendRequestContext,
  pageRequest: Request,
  graphqlRequest: ReturnType<typeof buildGraphQLRequest>,
): Promise<Response> =>
  relayToApi(
    GRAPHQL_RELAY_ROUTE,
    new Request(new URL(GRAPHQL_RELAY_ROUTE.path, pageRequest.url), {
      method: 'POST',
      headers: graphqlRequest.headers,
      body: graphqlRequest.body,
    }),
    {
      api: context.api,
      context: context.relay,
      cookieName: context.sessionCookieName,
      logger: getFrontendLogger([context.caller, 'relay']),
      sessionLogger: sessionLoggerOf(context),
      reportUnexpected: context.reportUnexpected,
    },
  );

const applySessionCookie = (
  context: FrontendRequestContext,
  pageRequest: Request,
  relayed: Headers,
): void => {
  const setCookies = relayed.getSetCookie();
  if (setCookies.length === 0) {
    return;
  }
  if (isResponseCommitted(pageRequest)) {
    sessionLoggerOf(context).warn(
      'ページの応答を送り始めた後に届いたセッションの指示を捨てました',
      { reason: 'response_committed' },
    );
    return;
  }
  setResponseHeader(
    'set-cookie',
    mergeSessionSetCookies(
      getResponseHeaders().getSetCookie(),
      setCookies,
      context.sessionCookieName,
    ),
  );
};

// 中継の処理は待ち時間で上流を打ち切るため、呼び出し元の中断の合図は使わない
export async function executeGraphQLOnServer<TResult>(
  document: AnyPersistedDocument<TResult>,
  variables: unknown,
  options: ExecuteOptions = {},
): Promise<GraphQLResult<TResult>> {
  const context = readFrontendRequestContext();
  const pageRequest = getRequest();
  const relayed = await relayFromPage(
    context,
    pageRequest,
    buildGraphQLRequest(document, variables, options.turnstileToken),
  );
  applySessionCookie(context, pageRequest, relayed.headers);
  let body: string;
  try {
    body = await relayed.text();
  } catch (error) {
    return { ok: false, error: createNetworkError(error) };
  }
  return parseGraphQLResponse<TResult>({
    status: relayed.status,
    headers: relayed.headers,
    body,
  });
}
