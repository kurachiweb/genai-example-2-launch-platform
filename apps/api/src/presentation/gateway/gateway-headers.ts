export const CALLER_KINDS = Object.freeze(['client', 'admin'] as const);
export type CallerKind = (typeof CALLER_KINDS)[number];

export {
  APP_ENVIRONMENTS,
  type AppEnvironment,
  isDeployedEnvironment,
} from '../../../lib/core/env/app-environment.ts';

// HTTPヘッダーは大文字小文字を区別しないため、Headersが返す小文字の名前で定義する
export const GATEWAY_HEADERS = Object.freeze({
  caller: 'x-internal-caller',
  clientIp: 'x-original-client-ip',
  sessionToken: 'x-session-token',
  botToken: 'cf-turnstile-response',
  debugCaller: 'x-debug-caller',
} as const);

export const SESSION_RESPONSE_HEADERS = Object.freeze({
  issue: 'x-session-issue',
  maxAge: 'x-session-max-age',
  clear: 'x-session-clear',
} as const);
