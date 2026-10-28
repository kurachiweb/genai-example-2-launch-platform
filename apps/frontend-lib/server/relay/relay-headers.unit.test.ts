import { describe, expect, test } from 'bun:test';

import type { FrontendAppProfile } from '../entry/app-profile.ts';
import {
  buildRelayHeaders,
  createRelayContext,
  type RelayContext,
} from './relay-headers.ts';

const CLIENT_IP = '203.0.113.5';
const SPOOFED_IP = '198.51.100.99';
const CLIENT_TOKEN = `client${'A'.repeat(31)}_-9xyz`;
const ADMIN_TOKEN = `admin${'B'.repeat(32)}-_8wvu`;
const BOT_TOKEN = '0.bot-verification-token';
const SENTRY_TRACE = '771a43a4192642f0b136d5159a501700-b0e6f15b45c36b12-1';
const BAGGAGE = 'sentry-environment=staging,sentry-public_key=abc';

const profileOf = (
  caller: FrontendAppProfile['caller'],
  sessionCookieName: FrontendAppProfile['sessionCookieName'],
): FrontendAppProfile => ({
  caller,
  sessionCookieName,
  indexable: () => false,
  webAnalytics: false,
  contactAvailable: false,
});

const CLIENT_PROFILE = profileOf('client', '__Host-test_session');
const ADMIN_PROFILE = profileOf('admin', '__Host-test_admin_session');

const TRACE_HEADERS = Object.freeze({
  'sentry-trace': SENTRY_TRACE,
  baggage: BAGGAGE,
});

const browserRequest = (): Request =>
  new Request('https://app.example/_bff/graphql', {
    method: 'POST',
    headers: {
      'CF-Connecting-IP': CLIENT_IP,
      Cookie: `__Host-test_session=${CLIENT_TOKEN}; __Host-test_admin_session=${ADMIN_TOKEN}; theme=dark`,
      'Content-Type': 'application/json',
      Accept: 'application/graphql-response+json',
      'cf-turnstile-response': BOT_TOKEN,
      'x-internal-caller': 'admin',
      'x-debug-caller': 'admin',
      'x-original-client-ip': SPOOFED_IP,
      'x-session-token': 'spoofed-session-token',
      'X-Forwarded-For': SPOOFED_IP,
      'X-Real-IP': SPOOFED_IP,
      Authorization: 'Bearer spoofed',
      Origin: 'https://app.example',
      Referer: 'https://app.example/items',
      'User-Agent': 'Mozilla/5.0',
      'sentry-trace': 'browser-trace',
      baggage: 'browser-baggage',
      'x-session-issue': 'spoofed',
    },
  });

const contextOf = (overrides: Partial<RelayContext> = {}): RelayContext => ({
  clientIp: CLIENT_IP,
  sessionToken: CLIENT_TOKEN,
  traceHeaders: TRACE_HEADERS,
  ...overrides,
});

const entriesOf = (headers: Headers): Record<string, string> =>
  Object.fromEntries(headers.entries());

const errorOf = (action: () => unknown): Error => {
  try {
    action();
  } catch (error) {
    if (error instanceof Error) {
      return error;
    }
  }
  throw new Error('例外が投げられなかった');
};

describe('createRelayContext', () => {
  test('接続元のIP・自分のセッションのCookieの値・トレースの項目を持つ', () => {
    expect(
      createRelayContext(browserRequest(), CLIENT_PROFILE, TRACE_HEADERS),
    ).toEqual({
      clientIp: CLIENT_IP,
      sessionToken: CLIENT_TOKEN,
      traceHeaders: TRACE_HEADERS,
    });
  });

  test('トレースの項目は値が文字列のものだけを持ち、値の無い項目を中継で付けない', () => {
    const context = createRelayContext(browserRequest(), CLIENT_PROFILE, {
      'sentry-trace': SENTRY_TRACE,
      baggage: undefined,
    });

    expect(context.traceHeaders).toEqual({ 'sentry-trace': SENTRY_TRACE });
    expect(buildRelayHeaders(context, undefined).has('baggage')).toBeFalse();
  });

  test('管理者側は管理者側のCookieの値だけを持つ', () => {
    expect(
      createRelayContext(browserRequest(), ADMIN_PROFILE, {}).sessionToken,
    ).toBe(ADMIN_TOKEN);
  });

  test('相手側のCookieしか無ければセッション識別子を持たない', () => {
    const request = new Request('https://app.example/', {
      headers: { Cookie: `__Host-test_admin_session=${ADMIN_TOKEN}` },
    });

    expect(
      createRelayContext(request, CLIENT_PROFILE, {}).sessionToken,
    ).toBeUndefined();
  });

  test('接続元のIPが分からなければ元のクライアントIPを名乗る項目を使わない', () => {
    const request = new Request('https://app.example/', {
      headers: { 'x-original-client-ip': SPOOFED_IP },
    });

    expect(
      createRelayContext(request, CLIENT_PROFILE, {}).clientIp,
    ).toBeUndefined();
  });
});

describe('buildRelayHeaders', () => {
  test('ブラウザからの中継では契約の項目・トレースの項目・許可したブラウザの項目だけを付ける', () => {
    const request = browserRequest();
    const context = createRelayContext(request, CLIENT_PROFILE, TRACE_HEADERS);

    expect(entriesOf(buildRelayHeaders(context, request.headers))).toEqual({
      'x-original-client-ip': CLIENT_IP,
      'x-session-token': CLIENT_TOKEN,
      'cf-turnstile-response': BOT_TOKEN,
      'content-type': 'application/json',
      accept: 'application/graphql-response+json',
      'sentry-trace': SENTRY_TRACE,
      baggage: BAGGAGE,
    });
  });

  test('ブラウザが送ったCookie・呼び出し元・元のクライアントIP・セッション識別子を名乗る項目を引き継がない', () => {
    const headers = buildRelayHeaders(
      contextOf({ clientIp: undefined, sessionToken: undefined }),
      browserRequest().headers,
    );

    for (const name of [
      'cookie',
      'x-internal-caller',
      'x-debug-caller',
      'x-original-client-ip',
      'x-session-token',
      'x-forwarded-for',
      'x-real-ip',
      'cf-connecting-ip',
      'authorization',
      'origin',
      'referer',
      'user-agent',
      'x-session-issue',
    ]) {
      expect(headers.has(name)).toBe(false);
    }
  });

  test('元のクライアントIPはブラウザが名乗った値ではなく接続元のIPで付ける', () => {
    const headers = buildRelayHeaders(contextOf(), browserRequest().headers);

    expect(headers.get('x-original-client-ip')).toBe(CLIENT_IP);
  });

  test('トレースの項目はブラウザが送った値ではなくサーバー側の値で付ける', () => {
    const headers = buildRelayHeaders(contextOf(), browserRequest().headers);

    expect(headers.get('sentry-trace')).toBe(SENTRY_TRACE);
    expect(headers.get('baggage')).toBe(BAGGAGE);
  });

  test('トレースの項目のうちsentry-traceとbaggage以外は付けない', () => {
    const headers = buildRelayHeaders(
      contextOf({
        traceHeaders: {
          'Sentry-Trace': SENTRY_TRACE,
          traceparent:
            '00-771a43a4192642f0b136d5159a501700-b0e6f15b45c36b12-01',
          cookie: 'injected=1',
          'x-internal-caller': 'admin',
        },
      }),
      undefined,
    );

    expect(entriesOf(headers)).toEqual({
      'x-original-client-ip': CLIENT_IP,
      'x-session-token': CLIENT_TOKEN,
      'sentry-trace': SENTRY_TRACE,
    });
  });

  test('IP・セッション識別子・トレースの項目が無ければ付けない', () => {
    const headers = buildRelayHeaders(
      { clientIp: undefined, sessionToken: undefined, traceHeaders: {} },
      new Headers({ 'content-type': 'application/json' }),
    );

    expect(entriesOf(headers)).toEqual({ 'content-type': 'application/json' });
  });

  test('サーバー側の描画では要求の形式とbot判定のトークンをextraから付ける', () => {
    const headers = buildRelayHeaders(contextOf(), undefined, {
      'Content-Type': 'application/json',
      Accept: 'application/graphql-response+json',
      'cf-turnstile-response': BOT_TOKEN,
    });

    expect(entriesOf(headers)).toEqual({
      'x-original-client-ip': CLIENT_IP,
      'x-session-token': CLIENT_TOKEN,
      'cf-turnstile-response': BOT_TOKEN,
      'content-type': 'application/json',
      accept: 'application/graphql-response+json',
      'sentry-trace': SENTRY_TRACE,
      baggage: BAGGAGE,
    });
  });

  test('extraの値はブラウザが送った同名の項目より優先する', () => {
    const headers = buildRelayHeaders(contextOf(), browserRequest().headers, {
      'content-length': '12',
      'content-type': 'application/octet-stream',
    });

    expect(headers.get('content-length')).toBe('12');
    expect(headers.get('content-type')).toBe('application/octet-stream');
  });

  test.each([
    'cookie',
    'Cookie',
    'x-internal-caller',
    'x-debug-caller',
    'x-original-client-ip',
    'X-Session-Token',
  ])(
    'extraに契約で決まる項目や%sを渡すと値を含めずにTypeErrorを投げる',
    (name) => {
      const secret = `secret-${CLIENT_TOKEN}-${SPOOFED_IP}`;

      const error = errorOf(() =>
        buildRelayHeaders(contextOf(), undefined, { [name]: secret }),
      );

      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toContain(name.toLowerCase());
      expect(error.message).not.toContain(secret);
      expect(error.message).not.toContain(CLIENT_TOKEN);
      expect(error.message).not.toContain(SPOOFED_IP);
    },
  );

  test('ブラウザの要求のヘッダーを書き換えない', () => {
    const browser = browserRequest().headers;
    const before = entriesOf(browser);

    buildRelayHeaders(contextOf(), browser, { accept: 'application/json' });

    expect(entriesOf(browser)).toEqual(before);
  });
});
