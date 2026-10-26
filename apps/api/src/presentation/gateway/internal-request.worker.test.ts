import { describe, expect, test } from 'vitest';

import { type CallerKind, GATEWAY_HEADERS } from './gateway-headers.ts';
import {
  markInternalRequest,
  parseClientIp,
  readInternalCaller,
  resolveGatewayClientIp,
  stripGatewayHeaders,
} from './internal-request.ts';

const GRAPHQL_URL = 'https://api.launch.example/graphql';
const CONNECTING_IP_HEADER = 'CF-Connecting-IP';
const CONNECTING_IP = '198.51.100.20';
const RELAYED_IP = '203.0.113.7';
const REQUEST_CF = { country: 'JP', colo: 'NRT' };

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request(GRAPHQL_URL, { headers });
}

function requestWithCf(headers: Record<string, string> = {}): Request {
  return new Request(GRAPHQL_URL, { headers, cf: REQUEST_CF });
}

describe('markInternalRequest', () => {
  test.each(['client', 'admin'] as const satisfies readonly CallerKind[])(
    '呼び出し元のヘッダーに%sを付ける',
    (caller) => {
      const marked = markInternalRequest(requestWithHeaders({}), caller);

      expect(marked.headers.get(GATEWAY_HEADERS.caller)).toBe(caller);
    },
  );

  test('要求が名乗る呼び出し元のヘッダーを、指定した呼び出し元で上書きする', () => {
    const request = requestWithHeaders({ 'X-Internal-Caller': 'admin' });

    const marked = markInternalRequest(request, 'client');

    expect(marked.headers.get(GATEWAY_HEADERS.caller)).toBe('client');
  });

  test('元の要求のヘッダーを書き換えない', () => {
    const request = requestWithHeaders({ [GATEWAY_HEADERS.caller]: 'admin' });

    markInternalRequest(request, 'client');

    expect(request.headers.get(GATEWAY_HEADERS.caller)).toBe('admin');
  });

  test('メソッド・URL・本文・他のヘッダーを保つ', async () => {
    const request = new Request(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
      },
      body: '{"documentId":"sha256:abc"}',
    });

    const marked = markInternalRequest(request, 'admin');

    expect(marked.method).toBe('POST');
    expect(marked.url).toBe(GRAPHQL_URL);
    expect(marked.headers.get('content-type')).toBe('application/json');
    expect(marked.headers.get(GATEWAY_HEADERS.clientIp)).toBe(RELAYED_IP);
    expect(await marked.text()).toBe('{"documentId":"sha256:abc"}');
  });

  test('cfの情報を保つ', () => {
    const marked = markInternalRequest(requestWithCf(), 'client');

    expect(marked.cf).toMatchObject(REQUEST_CF);
  });
});

describe('stripGatewayHeaders', () => {
  test('呼び出し元と元のクライアントIPのヘッダーを大文字小文字を問わず除く', () => {
    const request = requestWithHeaders({
      'X-Internal-Caller': 'admin',
      'X-Original-Client-IP': RELAYED_IP,
    });

    const stripped = stripGatewayHeaders(request);

    expect(stripped.headers.has(GATEWAY_HEADERS.caller)).toBe(false);
    expect(stripped.headers.has(GATEWAY_HEADERS.clientIp)).toBe(false);
  });

  test('接続元のIPやセッション識別子など他のヘッダーを保つ', () => {
    const request = requestWithHeaders({
      [CONNECTING_IP_HEADER]: CONNECTING_IP,
      [GATEWAY_HEADERS.sessionToken]: 'session-token',
      [GATEWAY_HEADERS.caller]: 'client',
    });

    const stripped = stripGatewayHeaders(request);

    expect(stripped.headers.get(CONNECTING_IP_HEADER)).toBe(CONNECTING_IP);
    expect(stripped.headers.get(GATEWAY_HEADERS.sessionToken)).toBe(
      'session-token',
    );
  });

  test('元の要求のヘッダーを書き換えない', () => {
    const request = requestWithHeaders({ [GATEWAY_HEADERS.caller]: 'admin' });

    stripGatewayHeaders(request);

    expect(request.headers.get(GATEWAY_HEADERS.caller)).toBe('admin');
  });

  test('cfの情報を保つ', () => {
    const stripped = stripGatewayHeaders(
      requestWithCf({ [GATEWAY_HEADERS.caller]: 'admin' }),
    );

    expect(stripped.cf).toMatchObject(REQUEST_CF);
  });

  test('外部経路で偽の呼び出し元とIPを名乗る要求は、内部経路として扱われず接続元のIPが使われる', () => {
    const request = requestWithHeaders({
      [GATEWAY_HEADERS.caller]: 'admin',
      [GATEWAY_HEADERS.clientIp]: RELAYED_IP,
      [CONNECTING_IP_HEADER]: CONNECTING_IP,
    });

    const stripped = stripGatewayHeaders(request);

    expect(readInternalCaller(stripped)).toBeUndefined();
    expect(resolveGatewayClientIp(stripped)).toBe(CONNECTING_IP);
  });
});

describe('readInternalCaller', () => {
  test.each(['client', 'admin'] as const satisfies readonly CallerKind[])(
    '呼び出し元のヘッダーが%sならその呼び出し元を返す',
    (caller) => {
      const request = requestWithHeaders({ [GATEWAY_HEADERS.caller]: caller });

      expect(readInternalCaller(request)).toBe(caller);
    },
  );

  test('呼び出し元のヘッダーが無ければundefinedを返す', () => {
    expect(readInternalCaller(requestWithHeaders({}))).toBeUndefined();
  });

  test.each(['root', 'Client', ''])(
    '呼び出し元の種類に無い値%pならundefinedを返す',
    (value) => {
      const request = requestWithHeaders({ [GATEWAY_HEADERS.caller]: value });

      expect(readInternalCaller(request)).toBeUndefined();
    },
  );
});

describe('parseClientIp', () => {
  test.each(['203.0.113.7', '2001:db8::1', '::1', '2001:db8:0:0:0:0:0:1'])(
    'IPアドレスとして解釈できる値%sをそのまま返す',
    (value) => {
      expect(parseClientIp(value)).toBe(value);
    },
  );

  test('値が無ければundefinedを返す', () => {
    expect(parseClientIp(null)).toBeUndefined();
  });

  test.each([
    '',
    'not-an-ip',
    '256.0.0.1',
    '203.0.113',
    '203.0.113.7:8080',
    '203.0.113.7, 198.51.100.1',
    '2001:db8::g',
    '[2001:db8::1]',
  ])('IPアドレスとして解釈できない値%pならundefinedを返す', (value) => {
    expect(parseClientIp(value)).toBeUndefined();
  });
});

describe('resolveGatewayClientIp', () => {
  test.each([RELAYED_IP, '2001:db8::7'])(
    '内部経路では引き継いだIPアドレス%sを接続元より優先して返す',
    (relayedIp) => {
      const request = requestWithHeaders({
        [GATEWAY_HEADERS.caller]: 'client',
        [GATEWAY_HEADERS.clientIp]: relayedIp,
        [CONNECTING_IP_HEADER]: CONNECTING_IP,
      });

      expect(resolveGatewayClientIp(request)).toBe(relayedIp);
    },
  );

  test('内部経路で引き継いだIPアドレスが無ければ、接続元があっても不明として返す', () => {
    const request = requestWithHeaders({
      [GATEWAY_HEADERS.caller]: 'admin',
      [CONNECTING_IP_HEADER]: CONNECTING_IP,
    });

    expect(resolveGatewayClientIp(request)).toBeUndefined();
  });

  test('内部経路で引き継いだIPアドレスが不正なら、接続元があっても不明として返す', () => {
    const request = requestWithHeaders({
      [GATEWAY_HEADERS.caller]: 'client',
      [GATEWAY_HEADERS.clientIp]: 'not-an-ip',
      [CONNECTING_IP_HEADER]: CONNECTING_IP,
    });

    expect(resolveGatewayClientIp(request)).toBeUndefined();
  });

  test('外部経路では接続元のIPアドレスを返す', () => {
    const request = requestWithHeaders({
      [CONNECTING_IP_HEADER]: CONNECTING_IP,
    });

    expect(resolveGatewayClientIp(request)).toBe(CONNECTING_IP);
  });

  test('外部経路で接続元のIPアドレスが無ければ不明として返す', () => {
    expect(resolveGatewayClientIp(requestWithHeaders({}))).toBeUndefined();
  });
});
