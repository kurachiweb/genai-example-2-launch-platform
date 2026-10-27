import { expect } from 'bun:test';

import type { FrontendAppProfile } from '../server/entry/app-profile.ts';
import {
  createFrontendServerEntry,
  type FrontendServerEntryOptions,
  type StartHandler,
} from '../server/entry/create-frontend-server-entry.ts';
import type { FrontendRequestContext } from '../server/entry/request-context.ts';
import type { RateLimiter } from '../server/env/frontend-env.ts';
import { GRAPHQL_RELAY_ROUTE } from '../server/relay/relay-route.ts';
import {
  CLIENT_COOKIE,
  okResponse,
  type RecordingFetcher,
  respondingWith,
} from './relay-route-fixtures.ts';

export const APP_ORIGIN = 'https://app.example';
export const IMAGES_ORIGIN = 'https://images.example';
export const SENTRY_ORIGIN = 'https://o1.ingest.sentry.example';
// シークレット検出が実物の値と誤検知しないよう、テスト用の値を部品から組み立てる
export const SENTRY_DSN = `https://${['public', 'dsn', 'part'].join('-')}@o1.ingest.sentry.example/1`;
export const ANALYTICS_ORIGIN = 'https://static.cloudflareinsights.example';
export const TRACE_HEADERS = Object.freeze({
  'sentry-trace': '771a43a4192642f0b136d5159a501700-b0e6f15b45c36b12-1',
  baggage: 'sentry-environment=prod',
});

export const CLIENT_TEST_PROFILE: FrontendAppProfile =
  Object.freeze<FrontendAppProfile>({
    caller: 'client',
    sessionCookieName: CLIENT_COOKIE,
    indexable: (environment) => environment === 'prod',
    webAnalytics: true,
  });

export const ADMIN_TEST_PROFILE: FrontendAppProfile =
  Object.freeze<FrontendAppProfile>({
    caller: 'admin',
    sessionCookieName: '__Host-test_admin_session',
    indexable: () => false,
    webAnalytics: false,
  });

export const APP_SECURITY_POLICY = Object.freeze({
  scriptSrc: [ANALYTICS_ORIGIN],
  connectSrc: [ANALYTICS_ORIGIN],
  permissions: { payment: ['self'] },
});

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

export interface StartCall {
  readonly request: Request;
  readonly context: FrontendRequestContext;
}

export interface RecordingLimiter extends RateLimiter {
  readonly keys: string[];
}

export const limiterOf = (success: boolean): RecordingLimiter => {
  const keys: string[] = [];
  return {
    keys,
    limit: ({ key }) => {
      keys.push(key);
      return Promise.resolve({ success });
    },
  };
};

export const baseEnvOf = (
  api: RecordingFetcher,
  limiter: RateLimiter,
): Record<string, unknown> => ({
  API: api,
  IP_RATE_LIMITER: limiter,
  APP_ENVIRONMENT: 'prod',
  LOG_LEVEL: 'info',
  SENTRY_ENVIRONMENT: 'prod',
  SENTRY_TRACES_SAMPLE_RATE: '0.1',
  SENTRY_DSN,
  TURNSTILE_SITE_KEY: 'turnstile-site-key',
  IMAGES_ORIGIN,
  WEB_ANALYTICS_TOKEN: 'analytics-token',
});

export const htmlResponse = (): Response =>
  new Response('<!doctype html><html><body>page</body></html>', {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });

export interface HarnessOptions {
  readonly profile?: FrontendAppProfile;
  readonly env?: Readonly<Record<string, unknown>>;
  readonly rawEnv?: unknown;
  readonly limited?: boolean;
  readonly api?: RecordingFetcher;
  readonly respond?: (call: StartCall) => Response | Promise<Response>;
  readonly entryOptions?: Partial<FrontendServerEntryOptions>;
}

export interface Harness {
  readonly env: unknown;
  readonly api: RecordingFetcher;
  readonly limiter: RecordingLimiter;
  readonly startCalls: StartCall[];
  readonly reported: unknown[];
  readonly logs: () => LoggedObject[];
  readonly fetch: (request: Request) => Promise<Response>;
}

const NOW_STEP_MS = 42;

export const createHarness = (options: HarnessOptions = {}): Harness => {
  const api = options.api ?? respondingWith(okResponse);
  const limiter = limiterOf(!(options.limited ?? false));
  const env =
    'rawEnv' in options
      ? options.rawEnv
      : { ...baseEnvOf(api, limiter), ...options.env };
  const startCalls: StartCall[] = [];
  const reported: unknown[] = [];
  const consoleCalls: (readonly unknown[])[] = [];
  const record = (...args: unknown[]): void => {
    consoleCalls.push(args);
  };
  const recorder: Pick<Console, ConsoleMethod> = {
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
  };
  const startHandler: StartHandler = {
    fetch: async (request, { context }) => {
      const call = { request, context };
      startCalls.push(call);
      return (await options.respond?.(call)) ?? htmlResponse();
    },
  };
  let clock = 1_000;
  const entry = createFrontendServerEntry({
    profile: options.profile ?? CLIENT_TEST_PROFILE,
    startHandler,
    relayRoutes: [GRAPHQL_RELAY_ROUTE],
    securityPolicy: APP_SECURITY_POLICY,
    reportUnexpected: (error) => {
      reported.push(error);
    },
    traceHeaders: () => TRACE_HEADERS,
    console: recorder as Console,
    now: () => {
      const current = clock;
      clock += NOW_STEP_MS;
      return current;
    },
    ...options.entryOptions,
  });
  return {
    env,
    api,
    limiter,
    startCalls,
    reported,
    logs: () =>
      consoleCalls.map((args) => {
        expect(args).toHaveLength(1);
        return args[0] as LoggedObject;
      }),
    fetch: (request) =>
      entry.fetch(request, env, { waitUntil: () => undefined }),
  };
};

export const ACCESS_LOG_DURATION_MS = NOW_STEP_MS;

export const logsOf = (
  harness: Harness,
  category: string,
): readonly LoggedObject[] =>
  harness.logs().filter((logged) => logged.category === category);

export const pageRequest = (
  path = '/launches',
  headers: HeadersInit = {},
): Request =>
  new Request(`${APP_ORIGIN}${path}`, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'CF-Connecting-IP': '203.0.113.5',
      ...Object.fromEntries(new Headers(headers)),
    },
  });

export const sameOriginPost = (
  path: string,
  headers: HeadersInit = {},
): Request =>
  new Request(`${APP_ORIGIN}${path}`, {
    method: 'POST',
    headers: {
      'Sec-Fetch-Site': 'same-origin',
      'Content-Type': 'application/json',
      'CF-Connecting-IP': '203.0.113.5',
      ...Object.fromEntries(new Headers(headers)),
    },
    body: JSON.stringify({ documentId: `sha256:${'a'.repeat(64)}` }),
  });

export const withCf = (request: Request, cf: unknown): Request => {
  Object.defineProperty(request, 'cf', { value: cf });
  return request;
};
