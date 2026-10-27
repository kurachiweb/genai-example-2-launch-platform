import type { ServiceFetcher } from '../server/env/frontend-env.ts';
import type { RelayContext } from '../server/relay/relay-headers.ts';
import type { RelayDeps, RelayLogger } from '../server/relay/relay-route.ts';
import type { SessionCookieLogger } from '../server/relay/session-cookie.ts';

export const CLIENT_IP = '203.0.113.5';
export const SPOOFED_IP = '198.51.100.99';
export const CLIENT_COOKIE = '__Host-test_session';
export const CLIENT_TOKEN = `client${'A'.repeat(31)}_-9xyz`;
export const ISSUED_TOKEN = `issued${'C'.repeat(31)}_-7tsr`;
export const BOT_TOKEN = '0.bot-verification-token';
export const SENTRY_TRACE =
  '771a43a4192642f0b136d5159a501700-b0e6f15b45c36b12-1';
export const BAGGAGE = 'sentry-environment=staging,sentry-public_key=abc';
export const GRAPHQL_BODY = JSON.stringify({
  documentId: `sha256:${'a'.repeat(64)}`,
  variables: { first: 10 },
});

const CONTEXT: RelayContext = Object.freeze({
  clientIp: CLIENT_IP,
  sessionToken: CLIENT_TOKEN,
  traceHeaders: Object.freeze({
    'sentry-trace': SENTRY_TRACE,
    baggage: BAGGAGE,
  }),
});

export interface WarningRecord {
  readonly message: string;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface Recorder {
  readonly warnings: WarningRecord[];
  readonly sessionWarnings: WarningRecord[];
  readonly reported: unknown[];
}

export interface UpstreamCall {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal;
}

export interface RecordingFetcher extends ServiceFetcher {
  readonly calls: UpstreamCall[];
}

export const fetcherOf = (
  respond: (request: Request) => Promise<Response>,
): RecordingFetcher => {
  const calls: UpstreamCall[] = [];
  return {
    calls,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      calls.push({
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        body: await request.clone().text(),
        signal: request.signal,
      });
      return respond(request);
    },
  };
};

export const respondingWith = (response: () => Response): RecordingFetcher =>
  fetcherOf(() => Promise.resolve(response()));

// Service Bindingsのfetchと同じく、中止の合図を受けたら失敗する
export const neverResponding = (): RecordingFetcher =>
  fetcherOf(
    (request) =>
      new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener('abort', () => {
          reject(new Error('中止された', { cause: request.signal.reason }));
        });
      }),
  );

export const ignoringAbort = (): RecordingFetcher =>
  fetcherOf(() => new Promise<Response>(() => undefined));

export const rejecting = (error: Error): RecordingFetcher =>
  fetcherOf(() => Promise.reject(error));

export const depsOf = (
  api: ServiceFetcher,
): { readonly deps: RelayDeps; readonly recorder: Recorder } => {
  const recorder: Recorder = {
    warnings: [],
    sessionWarnings: [],
    reported: [],
  };
  const logger: RelayLogger = {
    warn: (message, properties) => {
      recorder.warnings.push({ message, properties });
    },
  };
  const sessionLogger: SessionCookieLogger = {
    warn: (message, properties) => {
      recorder.sessionWarnings.push({ message, properties });
    },
  };
  return {
    recorder,
    deps: {
      api,
      context: CONTEXT,
      cookieName: CLIENT_COOKIE,
      logger,
      sessionLogger,
      reportUnexpected: (error) => {
        recorder.reported.push(error);
      },
    },
  };
};

export const graphqlRequest = (
  init: { readonly method?: string; readonly headers?: HeadersInit } = {},
  path = '/_bff/graphql',
): Request => {
  const method = init.method ?? 'POST';
  return new Request(`https://app.example${path}`, {
    method,
    headers: init.headers ?? {
      'CF-Connecting-IP': CLIENT_IP,
      Cookie: `${CLIENT_COOKIE}=${CLIENT_TOKEN}; theme=dark`,
      'Content-Type': 'application/json',
      Accept: 'application/graphql-response+json',
      'cf-turnstile-response': BOT_TOKEN,
      'x-original-client-ip': SPOOFED_IP,
      'x-internal-caller': 'admin',
      'User-Agent': 'Mozilla/5.0',
    },
    body: method === 'GET' || method === 'HEAD' ? undefined : GRAPHQL_BODY,
  });
};

export const okResponse = (): Response =>
  new Response('{"data":{"ok":true}}', {
    status: 200,
    headers: { 'Content-Type': 'application/graphql-response+json' },
  });

export const firstCall = (fetcher: RecordingFetcher): UpstreamCall => {
  const [call] = fetcher.calls;
  if (call === undefined) {
    throw new Error('上流が呼ばれなかった');
  }
  return call;
};
