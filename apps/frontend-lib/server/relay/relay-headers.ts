import type { FrontendAppProfile } from '../entry/app-profile.ts';
import { resolveClientIp } from '../http/client-ip.ts';
import {
  FORWARDED_BROWSER_HEADERS,
  GATEWAY_CALLER_HEADERS,
  RELAY_REQUEST_HEADERS,
  RELAY_TRACE_HEADERS,
} from './relay-contract.ts';
import { readSessionToken } from './session-cookie.ts';

export interface RelayContext {
  readonly clientIp: string | undefined;
  readonly sessionToken: string | undefined;
  readonly traceHeaders: Readonly<Record<string, string>>;
}

const TRACE_HEADER_NAMES: ReadonlySet<string> = new Set(RELAY_TRACE_HEADERS);

// 呼び出し側のコードが渡すextraでも、接続元・セッション・呼び出し元を名乗る項目は契約の値以外から付けさせない
const RESERVED_EXTRA_HEADER_NAMES: ReadonlySet<string> = new Set([
  'cookie',
  RELAY_REQUEST_HEADERS.clientIp,
  RELAY_REQUEST_HEADERS.sessionToken,
  GATEWAY_CALLER_HEADERS.caller,
  GATEWAY_CALLER_HEADERS.debugCaller,
]);

// Sentry.getTraceDataの型はbaggageなどを省略可能とし、値の無い項目を含み得る
export type TraceData = Readonly<Record<string, string | undefined>>;

const pickStringValues = (
  traceData: TraceData,
): Readonly<Record<string, string>> =>
  Object.fromEntries(
    Object.entries(traceData).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );

export function createRelayContext(
  request: Request,
  profile: FrontendAppProfile,
  traceData: TraceData,
): RelayContext {
  return {
    clientIp: resolveClientIp(request),
    sessionToken: readSessionToken(request, profile.sessionCookieName),
    traceHeaders: pickStringValues(traceData),
  };
}

const copyForwardedBrowserHeaders = (
  target: Headers,
  browser: Headers,
): void => {
  for (const name of FORWARDED_BROWSER_HEADERS) {
    const value = browser.get(name);
    if (value !== null) {
      target.set(name, value);
    }
  }
};

const copyExtraHeaders = (
  target: Headers,
  extra: Readonly<Record<string, string>>,
): void => {
  for (const [name, value] of Object.entries(extra)) {
    const normalizedName = name.toLowerCase();
    if (RESERVED_EXTRA_HEADER_NAMES.has(normalizedName)) {
      throw new TypeError(
        `中継の項目${normalizedName}は追加の項目として付けられません`,
      );
    }
    target.set(normalizedName, value);
  }
};

const copyTraceHeaders = (
  target: Headers,
  traceHeaders: Readonly<Record<string, string>>,
): void => {
  for (const [name, value] of Object.entries(traceHeaders)) {
    const normalizedName = name.toLowerCase();
    if (TRACE_HEADER_NAMES.has(normalizedName)) {
      target.set(normalizedName, value);
    }
  }
};

export function buildRelayHeaders(
  context: RelayContext,
  browser: Headers | undefined,
  extra: Readonly<Record<string, string>> = {},
): Headers {
  const headers = new Headers();
  if (browser !== undefined) {
    copyForwardedBrowserHeaders(headers, browser);
  }
  copyExtraHeaders(headers, extra);
  copyTraceHeaders(headers, context.traceHeaders);
  if (context.clientIp !== undefined) {
    headers.set(RELAY_REQUEST_HEADERS.clientIp, context.clientIp);
  }
  if (context.sessionToken !== undefined) {
    headers.set(RELAY_REQUEST_HEADERS.sessionToken, context.sessionToken);
  }
  return headers;
}
