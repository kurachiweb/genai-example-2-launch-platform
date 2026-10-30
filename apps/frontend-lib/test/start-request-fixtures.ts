import {
  createServerEntry,
  getResponseHeaders,
} from '@tanstack/react-start/server';
// @tanstack/react-startが完全固定の版で推移的に依存するパッケージ。描画中の要求の文脈をテストで作る公開の手段がここにしか無いため直接読み込む
import {
  runWithStartContext,
  type StartStorageContext,
} from '@tanstack/start-storage-context';

import type { FrontendRequestContext } from '../server/entry/request-context.ts';
import type { ServiceFetcher } from '../server/env/frontend-env.ts';
import { ensureFrontendLoggingConfigured } from '../server/observability/logging.ts';
import { responseCommitMiddleware } from '../start/response-commit.ts';
import type { DocumentId } from '../utilities/graphql/persisted-document.ts';

export const PAGE_ORIGIN = 'https://app.example';

export const CLIENT_SESSION_COOKIE = '__Host-test_session';

export const BROWSER_SESSION_TOKEN = `browser${'S'.repeat(30)}_-1abc`;

export const ISSUED_SESSION_TOKEN = `issued${'I'.repeat(31)}_-2def`;

export const CLIENT_IP = '203.0.113.5';

export const TRACE_HEADERS: Readonly<Record<string, string>> = {
  'sentry-trace': '0123456789abcdef0123456789abcdef-0123456789abcdef-1',
  baggage: 'sentry-environment=staging',
};

export const TEST_DOCUMENT_ID: DocumentId = `sha256:${'0123456789abcdef'.repeat(4)}`;

export const NONCE = 'AAECAwQFBgcICQoLDA0ODw==';

export interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

// 描画中のログを確かめるため、出力先を記録用に差し替えて設定する。テストの後でresetSyncを呼ぶこと
export const recordFrontendLogs = (): (() => readonly LoggedObject[]) => {
  const records: LoggedObject[] = [];
  const record = (...args: unknown[]): void => {
    records.push(args[0] as LoggedObject);
  };
  ensureFrontendLoggingConfigured({
    caller: 'client',
    level: 'debug',
    console: {
      trace: record,
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return () => records;
};

export interface RecordingApi extends ServiceFetcher {
  readonly requests: Request[];
}

export const recordingApi = (
  respond: (request: Request) => Promise<Response>,
): RecordingApi => {
  const requests: Request[] = [];
  return {
    requests,
    fetch: (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      return respond(request);
    },
  };
};

export const graphqlResponse = (
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
): Response =>
  new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/graphql-response+json',
      ...headers,
    },
  });

export interface RenderContextOptions {
  readonly api: ServiceFetcher;
  readonly sessionToken?: string | undefined;
  readonly reported?: unknown[];
}

export const renderContextOf = (
  options: RenderContextOptions,
): FrontendRequestContext => ({
  caller: 'client',
  nonce: NONCE,
  correlationId: 'correlation-id-of-request',
  display: { timeZone: 'Asia/Tokyo', locale: 'ja-JP' },
  publicConfig: {
    environment: 'staging',
    turnstileSiteKey: '1x00000000000000000000BB',
    sentry: { dsn: undefined, environment: 'staging', tracesSampleRate: 0.1 },
    webAnalyticsToken: undefined,
  },
  relay: {
    clientIp: CLIENT_IP,
    sessionToken: options.sessionToken,
    traceHeaders: TRACE_HEADERS,
  },
  api: options.api,
  sessionCookieName: CLIENT_SESSION_COOKIE,
  reportUnexpected: (error) => {
    options.reported?.push(error);
  },
});

type MiddlewareServer = (options: {
  readonly request: Request;
  readonly pathname: string;
  readonly context: object;
  readonly handlerType: 'serverFn' | 'router';
  readonly next: () => Promise<{ readonly response: Response }>;
}) => Promise<{ readonly response: Response }>;

const commitMiddlewareServer = (): MiddlewareServer => {
  // TanStackのミドルウェアの型はserverの引数を登録した文脈の型で持つため、テストで渡す最小の形の関数として呼ぶ
  const server = (
    responseCommitMiddleware.options as {
      readonly server?: MiddlewareServer | undefined;
    }
  ).server;
  if (server === undefined) {
    throw new Error(
      '応答の送り始めのミドルウェアにサーバーの処理がありません。',
    );
  }
  return server;
};

export const pageRequestOf = (headers: HeadersInit = {}): Request =>
  new Request(`${PAGE_ORIGIN}/launches?page=2`, {
    headers: {
      Accept: 'text/html',
      ...Object.fromEntries(new Headers(headers)),
    },
  });

export interface StartRequestOptions {
  // 中継の文脈を持たない要求を試す時はFrontendRequestContext以外の値を渡す
  readonly context: unknown;
  readonly request?: Request;
  readonly render: () => Promise<Response>;
}

// TanStack Startは後続の処理が返した応答を要求のミドルウェアへ渡す時に、それまでにsetResponseHeaderなどで設定した項目を合成する(createStartHandlerのreconcileResponse)。テストではその合成を公開の読み取りで再現する
const withHelperHeaders = (response: Response): Response => {
  const helperHeaders = getResponseHeaders();
  const headers = new Headers(response.headers);
  for (const [name, value] of helperHeaders) {
    if (name !== 'set-cookie') {
      headers.set(name, value);
    }
  }
  for (const cookie of helperHeaders.getSetCookie()) {
    headers.append('set-cookie', cookie);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

// TanStack Startと同じく、要求の範囲と文脈の中で、応答の送り始めのミドルウェアを通して描画の処理を実行する
export const runInStartRequest = (
  options: StartRequestOptions,
): Promise<Response> => {
  const request = options.request ?? pageRequestOf();
  const server = commitMiddlewareServer();
  const entry = createServerEntry({
    fetch: (incoming: Request) => {
      const startContext: StartStorageContext = {
        getRouter: () => {
          throw new Error('テストではルーターを使わない');
        },
        request: incoming,
        startOptions: {},
        contextAfterGlobalMiddlewares: options.context,
        executedRequestMiddlewares: new Set(),
        handlerType: 'router',
      };
      return runWithStartContext(startContext, async () => {
        const result = await server({
          request: incoming,
          pathname: new URL(incoming.url).pathname,
          context: {},
          handlerType: 'router',
          next: async () => ({
            response: withHelperHeaders(await options.render()),
          }),
        });
        return result.response;
      });
    },
  });
  return Promise.resolve(entry.fetch(request));
};

export const htmlResponse = (headers: HeadersInit = {}): Response =>
  new Response('<!doctype html><html></html>', {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      ...Object.fromEntries(new Headers(headers)),
    },
  });
