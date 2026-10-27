import type {
  Breadcrumb,
  DataCollection,
  ErrorEvent,
  EventHint,
  Exception,
  RequestEventData,
  StreamedSpanJSON,
} from '@sentry/core';

import { isExpectedFailure } from '../graphql/graphql-result.ts';
import { redactDeep, redactText } from './redaction-patterns.ts';

export { isExpectedFailure };

const ALLOWED_REQUEST_HEADERS = ['accept', 'content-type', 'user-agent'];

// SDKの既定は利用者の情報・Cookie・ヘッダー・本文・クエリを全て集めるため、SDKの段階で集めない
export const SENTRY_DATA_COLLECTION: DataCollection = {
  userInfo: false,
  cookies: false,
  httpHeaders: {
    request: { allow: [...ALLOWED_REQUEST_HEADERS] },
    response: false,
  },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

// Sentryが利用者のIPアドレスの取得に使う12種のヘッダー(@sentry/coreのgetClientIPAddress)とCloudflareが付けるIPアドレスのヘッダーに、Cookie・認証と、中継する元のクライアントIP・セッション識別子・bot判定のトークンのヘッダーを加える
const REMOVED_HEADER_NAMES: ReadonlySet<string> = new Set([
  'cf-connecting-ipv6',
  'cf-pseudo-ipv4',
  'cookie',
  'authorization',
  'x-client-ip',
  'x-forwarded-for',
  'fly-client-ip',
  'cf-connecting-ip',
  'fastly-client-ip',
  'true-client-ip',
  'x-real-ip',
  'x-cluster-client-ip',
  'x-forwarded',
  'forwarded-for',
  'forwarded',
  'x-vercel-forwarded-for',
  'x-original-client-ip',
  'x-session-token',
  'cf-turnstile-response',
]);

const URL_HEADER_NAMES: ReadonlySet<string> = new Set(['referer']);

const REMOVED_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  'cookies',
  'data',
  'query_string',
]);

const BREADCRUMB_URL_KEYS: ReadonlySet<string> = new Set(['url', 'from', 'to']);

const REMOVED_URL_PART_KEYS: ReadonlySet<string> = new Set([
  'url.query',
  'url.fragment',
  'http.query',
  'http.fragment',
]);

const REMOVED_SPAN_ATTRIBUTES: ReadonlySet<string> = new Set([
  ...REMOVED_URL_PART_KEYS,
  'client.address',
  'network.peer.address',
  'http.request.body.data',
  // 非推奨の旧来の属性名でもクエリ付きの経路と接続元のIPアドレスを持ち得る
  'http.target',
  'http.url',
  'http.client_ip',
  'net.peer.ip',
  'net.sock.peer.addr',
]);

const ALLOWED_SPAN_REQUEST_HEADERS: ReadonlySet<string> = new Set(
  ALLOWED_REQUEST_HEADERS,
);

const REQUEST_HEADER_ATTRIBUTE_PREFIX = 'http.request.header.';
const RESPONSE_HEADER_ATTRIBUTE_PREFIX = 'http.response.header.';
const USER_ATTRIBUTE_PREFIX = 'user.';
const URL_FULL_ATTRIBUTE = 'url.full';

const URL_QUERY_OR_FRAGMENT_PATTERN = /[?#].*$/su;

const stripUrlQuery = (url: string): string =>
  redactText(url.replace(URL_QUERY_OR_FRAGMENT_PATTERN, ''));

const redactTextFields = <T extends object>(
  object: T,
  keys: readonly (keyof T & string)[],
): T => {
  const targetKeys: ReadonlySet<string> = new Set(keys);
  return Object.fromEntries(
    Object.entries(object).map(([key, value]: [string, unknown]) => [
      key,
      targetKeys.has(key) && typeof value === 'string'
        ? redactText(value)
        : value,
    ]),
  ) as T;
};

const stripUrlQueryOf = (value: unknown): unknown =>
  typeof value === 'string' ? stripUrlQuery(value) : value;

const scrubHeaders = (
  headers: Readonly<Record<string, string>>,
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => !REMOVED_HEADER_NAMES.has(name.toLowerCase()))
      .map(([name, value]) => [
        name,
        URL_HEADER_NAMES.has(name.toLowerCase()) ? stripUrlQuery(value) : value,
      ]),
  );

const scrubRequest = (request: RequestEventData): RequestEventData => {
  const { url, headers } = request;
  const kept = Object.fromEntries(
    Object.entries(request).filter(([key]) => !REMOVED_REQUEST_FIELDS.has(key)),
  ) as RequestEventData;
  return {
    ...kept,
    ...(url !== undefined && { url: stripUrlQuery(url) }),
    ...(headers && { headers: scrubHeaders(headers) }),
  };
};

const scrubBreadcrumbData = (
  data: NonNullable<Breadcrumb['data']>,
): NonNullable<Breadcrumb['data']> =>
  redactDeep(
    Object.fromEntries(
      Object.entries(data)
        .filter(([key]) => !REMOVED_URL_PART_KEYS.has(key))
        .map(([key, value]: [string, unknown]) => [
          key,
          BREADCRUMB_URL_KEYS.has(key) ? stripUrlQueryOf(value) : value,
        ]),
    ),
  );

const scrubBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb => {
  const { data } = breadcrumb;
  return {
    ...redactTextFields(breadcrumb, ['message']),
    ...(data && { data: scrubBreadcrumbData(data) }),
  };
};

const scrubException = (exception: Exception): Exception =>
  redactTextFields(exception, ['type', 'value']);

const scrubFreeText = (
  event: ErrorEvent,
): Pick<ErrorEvent, 'exception' | 'logentry' | 'breadcrumbs'> => {
  const { exception, logentry, breadcrumbs } = event;
  return {
    ...(exception && {
      exception: {
        ...exception,
        ...(exception.values && {
          values: exception.values.map(scrubException),
        }),
      },
    }),
    // 型はformattedを持たないが、イベントの形式が定めていて付け得るため、params以外も含め全ての文字列を伏せる
    ...(logentry && { logentry: redactDeep(logentry) }),
    ...(breadcrumbs && { breadcrumbs: breadcrumbs.map(scrubBreadcrumb) }),
  };
};

export const scrubSentryEvent = (
  event: ErrorEvent,
  hint: EventHint,
): ErrorEvent | null => {
  if (isExpectedFailure(hint.originalException)) {
    return null;
  }
  const { request } = event;
  const kept = Object.fromEntries(
    Object.entries(event).filter(([key]) => key !== 'user'),
  ) as ErrorEvent;
  return {
    ...redactTextFields(kept, ['message', 'transaction']),
    ...(request && { request: scrubRequest(request) }),
    ...scrubFreeText(event),
  };
};

const isRemovedSpanAttribute = (key: string): boolean => {
  const lowerKey = key.toLowerCase();
  if (lowerKey.startsWith(REQUEST_HEADER_ATTRIBUTE_PREFIX)) {
    return !ALLOWED_SPAN_REQUEST_HEADERS.has(
      lowerKey.slice(REQUEST_HEADER_ATTRIBUTE_PREFIX.length),
    );
  }
  return (
    lowerKey.startsWith(RESPONSE_HEADER_ATTRIBUTE_PREFIX) ||
    lowerKey.startsWith(USER_ATTRIBUTE_PREFIX) ||
    REMOVED_SPAN_ATTRIBUTES.has(lowerKey)
  );
};

const isAttributeObject = (
  value: unknown,
): value is { readonly value: unknown } =>
  typeof value === 'object' && value !== null && 'value' in value;

// 逐次送信のスパンの属性は値そのものか、単位を伴う{ value, unit }の形を取る
const stripUrlQueryOfAttribute = (value: unknown): unknown =>
  isAttributeObject(value)
    ? { ...value, value: stripUrlQueryOf(value.value) }
    : stripUrlQueryOf(value);

export const scrubSentrySpan = (span: StreamedSpanJSON): StreamedSpanJSON => ({
  ...redactTextFields(span, ['name']),
  attributes: redactDeep(
    Object.fromEntries(
      Object.entries(span.attributes)
        .filter(([key]) => !isRemovedSpanAttribute(key))
        .map(([key, value]: [string, unknown]) => [
          key,
          key.toLowerCase() === URL_FULL_ATTRIBUTE
            ? stripUrlQueryOfAttribute(value)
            : value,
        ]),
    ),
  ),
});
