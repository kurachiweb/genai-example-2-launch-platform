import type { ServiceFetcher } from '../env/frontend-env.ts';
import { errorEnvelopeResponse } from '../http/error-responses.ts';
import {
  GATEWAY_CALLER_HEADERS,
  GRAPHQL_RELAY_PATH,
  GRAPHQL_UPSTREAM_PATH,
  RELAY_PATH_PREFIX,
  RELAY_REQUEST_HEADERS,
  RELAY_TRACE_HEADERS,
  SESSION_INSTRUCTION_HEADERS,
} from './relay-contract.ts';
import { buildRelayHeaders, type RelayContext } from './relay-headers.ts';
import {
  type SessionCookieLogger,
  type SessionCookieName,
  toBrowserResponse,
} from './session-cookie.ts';

export type RelayMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RelayRoute {
  // RELAY_PATH_PREFIXで始まる完全一致のパス、または末尾が/*の接頭辞
  readonly path: string;
  readonly methods: readonly RelayMethod[];
  readonly upstreamPath: (url: URL) => string;
  readonly acceptContentTypes?: readonly string[];
  readonly extraForwardedHeaders?: readonly string[];
  readonly timeoutMs: number;
}

export interface RelayLogger {
  warn(message: string, properties: Readonly<Record<string, unknown>>): void;
}

export interface RelayDeps {
  readonly api: ServiceFetcher;
  readonly context: RelayContext;
  readonly cookieName: SessionCookieName;
  readonly logger: RelayLogger;
  readonly sessionLogger: SessionCookieLogger;
  readonly reportUnexpected: (error: unknown) => void;
}

export const UPSTREAM_RETRY_AFTER_SECONDS = 5;

// Service Bindingsはホスト名を見ずに束縛先のWorkerへ届けるため、オリジンは上流のパスを組み立てる基準にだけ使う
const API_INTERNAL_ORIGIN = 'https://api.internal';

const RELAY_METHODS: ReadonlySet<string> = new Set<RelayMethod>([
  'GET',
  'POST',
  'PUT',
  'DELETE',
]);

const BODY_METHODS: ReadonlySet<string> = new Set<RelayMethod>(['POST', 'PUT']);

const PREFIX_WILDCARD = '/*';

const PATH_SEGMENT = '[A-Za-z0-9_~-][A-Za-z0-9._~-]*';

const ROUTE_PATH_PATTERN = new RegExp(
  `^${RELAY_PATH_PREFIX}${PATH_SEGMENT}(?:/${PATH_SEGMENT})*(?:/\\*)?$`,
  'u',
);

const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;

const HEADER_NAME_PATTERN = /^[a-z0-9!#$%&'*+.^_`|~-]+$/u;

// 接続元・セッション・呼び出し元・トレース・Cookieの指示は契約の値からだけ付けるため、経路の定義で引き継がせない
const RESERVED_HEADER_NAMES: ReadonlySet<string> = new Set([
  'cookie',
  RELAY_REQUEST_HEADERS.clientIp,
  RELAY_REQUEST_HEADERS.sessionToken,
  ...Object.values(GATEWAY_CALLER_HEADERS),
  ...RELAY_TRACE_HEADERS,
  ...Object.values(SESSION_INSTRUCTION_HEADERS),
]);

const assertRoutePath = (path: string): void => {
  if (!ROUTE_PATH_PATTERN.test(path)) {
    throw new TypeError(
      `中継の経路は${RELAY_PATH_PREFIX}の下の完全一致のパスか、末尾が/*の接頭辞で指定してください: ${path}`,
    );
  }
};

const assertMethods = (path: string, methods: readonly string[]): void => {
  if (methods.length === 0 || new Set(methods).size !== methods.length) {
    throw new TypeError(
      `中継の経路${path}のメソッドは重複なく1つ以上指定してください`,
    );
  }
  for (const method of methods) {
    if (!RELAY_METHODS.has(method)) {
      throw new TypeError(
        `中継の経路${path}のメソッドが不正です: ${JSON.stringify(method)}`,
      );
    }
  }
};

const assertTimeout = (path: string, timeoutMs: number): void => {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(
      `中継の経路${path}の待ち時間は正の整数のミリ秒で指定してください`,
    );
  }
};

const assertContentTypes = (
  route: Pick<RelayRoute, 'path' | 'methods'>,
  contentTypes: readonly string[],
): void => {
  for (const contentType of contentTypes) {
    if (!MEDIA_TYPE_PATTERN.test(contentType)) {
      throw new TypeError(
        `中継の経路${route.path}の受け付ける形式は引数の無い小文字の型/副型で指定してください: ${contentType}`,
      );
    }
  }
  const takesBody = route.methods.some((method) => BODY_METHODS.has(method));
  if (takesBody && contentTypes.length === 0) {
    throw new TypeError(
      `本文を受け取る中継の経路${route.path}には受け付ける形式を指定してください`,
    );
  }
};

const assertExtraHeaders = (path: string, names: readonly string[]): void => {
  for (const name of names) {
    if (!HEADER_NAME_PATTERN.test(name)) {
      throw new TypeError(
        `中継の経路${path}で追加で引き継ぐ項目名は小文字で指定してください: ${name}`,
      );
    }
    if (RESERVED_HEADER_NAMES.has(name)) {
      throw new TypeError(
        `中継の項目${name}は経路${path}の追加の項目として引き継げません`,
      );
    }
  }
};

export function defineRelayRoute(route: RelayRoute): RelayRoute {
  const acceptContentTypes = route.acceptContentTypes ?? [];
  const extraForwardedHeaders = route.extraForwardedHeaders ?? [];
  assertRoutePath(route.path);
  assertMethods(route.path, route.methods);
  assertTimeout(route.path, route.timeoutMs);
  assertContentTypes(route, acceptContentTypes);
  assertExtraHeaders(route.path, extraForwardedHeaders);
  return Object.freeze({
    path: route.path,
    methods: Object.freeze([...route.methods]),
    upstreamPath: route.upstreamPath,
    acceptContentTypes: Object.freeze([...acceptContentTypes]),
    extraForwardedHeaders: Object.freeze([...extraForwardedHeaders]),
    timeoutMs: route.timeoutMs,
  });
}

export const GRAPHQL_RELAY_ROUTE: RelayRoute = defineRelayRoute({
  path: GRAPHQL_RELAY_PATH,
  methods: ['POST'],
  upstreamPath: () => GRAPHQL_UPSTREAM_PATH,
  acceptContentTypes: ['application/json'],
  timeoutMs: 15_000,
});

const matchesRoute = (route: RelayRoute, pathname: string): boolean => {
  if (!route.path.endsWith(PREFIX_WILDCARD)) {
    return pathname === route.path;
  }
  const prefix = route.path.slice(0, -1);
  return pathname.startsWith(prefix) && pathname.length > prefix.length;
};

export function findRelayRoute(
  routes: readonly RelayRoute[],
  url: URL,
): RelayRoute | undefined {
  return routes.find((route) => matchesRoute(route, url.pathname));
}

const mediaTypeOf = (contentType: string | null): string | undefined =>
  contentType?.split(';')[0]?.trim().toLowerCase();

const acceptsContentType = (route: RelayRoute, headers: Headers): boolean => {
  const mediaType = mediaTypeOf(headers.get('Content-Type'));
  return (
    mediaType !== undefined &&
    (route.acceptContentTypes ?? []).includes(mediaType)
  );
};

const JSON_MEDIA_TYPE_PATTERN = /^application\/(?:[a-z0-9!#$&^_.-]+\+)?json$/u;

const SERVER_ERROR_STATUS = 500;

// APIサーバーの応答は常に共通のエラー形式(JSON)のため、JSONでない5xxは実行基盤がAPIサーバーに代わって返した失敗(束縛先の不在・資源の超過など)とみなす
const isPlatformFailure = (upstream: Response): boolean => {
  if (upstream.status < SERVER_ERROR_STATUS) {
    return false;
  }
  const mediaType = mediaTypeOf(upstream.headers.get('Content-Type'));
  return mediaType === undefined || !JSON_MEDIA_TYPE_PATTERN.test(mediaType);
};

const resolveUpstreamUrl = (route: RelayRoute, url: URL): URL => {
  const path = route.upstreamPath(url);
  const upstream = new URL(path, API_INTERNAL_ORIGIN);
  if (!path.startsWith('/') || upstream.origin !== API_INTERNAL_ORIGIN) {
    throw new TypeError(
      `中継の経路${route.path}の上流のパスはAPIサーバーの絶対パスで返してください`,
    );
  }
  return upstream;
};

const extraHeadersOf = (
  route: RelayRoute,
  browser: Headers,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    (route.extraForwardedHeaders ?? []).flatMap((name) => {
      const value = browser.get(name);
      return value === null ? [] : [[name, value]];
    }),
  );

// 上流がAbortSignalに従わない場合でも待ち時間で打ち切るため、合図そのものとも競わせる
const ABORTED = Symbol('aborted');

const whenAborted = (signal: AbortSignal): Promise<typeof ABORTED> =>
  new Promise((resolve) => {
    signal.addEventListener(
      'abort',
      () => {
        resolve(ABORTED);
      },
      { once: true },
    );
  });

const upstreamFailure = (
  route: RelayRoute,
  deps: RelayDeps,
  error: unknown,
  timedOut: boolean,
): Response => {
  const code = timedOut ? 'upstream_timeout' : 'upstream_unavailable';
  deps.logger.warn('APIサーバーへの中継に失敗しました', {
    code,
    route: route.path,
  });
  deps.reportUnexpected(error);
  return errorEnvelopeResponse({
    status: 503,
    code,
    retryAfterSeconds: UPSTREAM_RETRY_AFTER_SECONDS,
  });
};

export async function relayToApi(
  route: RelayRoute,
  request: Request,
  deps: RelayDeps,
): Promise<Response> {
  const { method } = request;
  if (!route.methods.some((allowed) => allowed === method)) {
    return errorEnvelopeResponse({
      status: 405,
      code: 'method_not_allowed',
      allow: route.methods,
    });
  }
  const takesBody = BODY_METHODS.has(method);
  if (takesBody && !acceptsContentType(route, request.headers)) {
    return errorEnvelopeResponse({
      status: 415,
      code: 'unsupported_media_type',
    });
  }

  const signal = AbortSignal.timeout(route.timeoutMs);
  const upstreamRequest = new Request(
    resolveUpstreamUrl(route, new URL(request.url)),
    {
      method,
      headers: buildRelayHeaders(
        deps.context,
        request.headers,
        extraHeadersOf(route, request.headers),
      ),
      body: takesBody ? request.body : null,
      signal,
    },
  );

  let upstream: Response | typeof ABORTED;
  try {
    upstream = await Promise.race([
      deps.api.fetch(upstreamRequest),
      whenAborted(signal),
    ]);
  } catch (error) {
    return upstreamFailure(route, deps, error, signal.aborted);
  }
  if (upstream === ABORTED) {
    return upstreamFailure(route, deps, signal.reason, true);
  }
  if (isPlatformFailure(upstream)) {
    // 捨てる本文のストリームが既に失敗していても、実行基盤の失敗として応答する
    await upstream.body?.cancel().catch(() => undefined);
    return upstreamFailure(
      route,
      deps,
      new Error(
        `APIサーバーの代わりに共通のエラー形式ではない状態${String(upstream.status)}の応答が返りました`,
      ),
      false,
    );
  }
  return toBrowserResponse(upstream, deps.cookieName, deps.sessionLogger);
}
