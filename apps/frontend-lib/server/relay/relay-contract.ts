// api-gatewayの契約の値の写し(apps/apiのgateway-headers.ts・session-verifier.ts)。片方を変えたらもう片方も見直す
// HTTPヘッダーは大文字小文字を区別しないため、Headersが返す小文字の名前で定義する
export const RELAY_REQUEST_HEADERS = Object.freeze({
  clientIp: 'x-original-client-ip',
  sessionToken: 'x-session-token',
  botToken: 'cf-turnstile-response',
} as const);

// 呼び出し元はService Bindingsの名前付きエントリポイントが付けるため、フロントエンドサーバーは付けない
export const GATEWAY_CALLER_HEADERS = Object.freeze({
  caller: 'x-internal-caller',
  debugCaller: 'x-debug-caller',
} as const);

export const SESSION_INSTRUCTION_HEADERS = Object.freeze({
  issue: 'x-session-issue',
  maxAge: 'x-session-max-age',
  clear: 'x-session-clear',
} as const);

export const SESSION_CLEAR_VALUE = '1';

export const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// ブラウザはCookieのMax-Ageを400日で切り詰めるため、それを超える有効期間の指示は受け付けない
export const MAX_SESSION_MAX_AGE_SECONDS = 34_560_000;

export const FORWARDED_BROWSER_HEADERS = Object.freeze([
  'content-type',
  'accept',
  RELAY_REQUEST_HEADERS.botToken,
] as const);

export const RELAY_TRACE_HEADERS = Object.freeze([
  'sentry-trace',
  'baggage',
] as const);

export const RELAY_PATH_PREFIX = '/_bff/';

// ブラウザがGraphQLを送る中継の経路と、その中継先のAPIサーバーの経路。ブラウザ向けのコードからも読むため、中継の処理と切り離してここに置く
export const GRAPHQL_RELAY_PATH = `${RELAY_PATH_PREFIX}graphql`;

export const GRAPHQL_UPSTREAM_PATH = '/graphql';
