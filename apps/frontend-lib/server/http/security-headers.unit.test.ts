import { describe, expect, spyOn, test } from 'bun:test';

import {
  applySecurityHeaders,
  BASE_SECURITY_HEADERS,
  type SecurityHeadersInput,
} from './security-headers.ts';
import {
  buildPageContentSecurityPolicy,
  buildPermissionsPolicy,
  NON_PAGE_CONTENT_SECURITY_POLICY,
} from './security-policy.ts';

// api-gatewayのSECURITY_HEADERSと同じ値
const EXPECTED_BASE_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
} as const;

const PAGE_INPUT: SecurityHeadersInput = {
  contentSecurityPolicy: buildPageContentSecurityPolicy({
    nonce: 'q0Zx4mT3bY8vR2kL9pW1sA==',
    sources: {},
    upgradeInsecureRequests: true,
  }),
  permissionsPolicy: buildPermissionsPolicy({}),
  noIndex: false,
};

const NON_PAGE_INPUT: SecurityHeadersInput = {
  ...PAGE_INPUT,
  contentSecurityPolicy: NON_PAGE_CONTENT_SECURITY_POLICY,
};

const expectSecurityHeaders = (
  response: Response,
  input: SecurityHeadersInput,
): void => {
  for (const [name, value] of Object.entries(EXPECTED_BASE_HEADERS)) {
    expect(response.headers.get(name)).toBe(value);
  }
  expect(response.headers.get('Content-Security-Policy')).toBe(
    input.contentSecurityPolicy,
  );
  expect(response.headers.get('Permissions-Policy')).toBe(
    input.permissionsPolicy,
  );
  expect(response.headers.get('Cache-Control')).toBe('no-store');
};

describe('BASE_SECURITY_HEADERS', () => {
  test('api-gatewayと同じHSTS・X-Content-Type-Options・Referrer-Policyを持つ', () => {
    expect(BASE_SECURITY_HEADERS).toStrictEqual(EXPECTED_BASE_HEADERS);
  });

  test('凍結されている', () => {
    expect(Object.isFrozen(BASE_SECURITY_HEADERS)).toBe(true);
  });
});

describe('applySecurityHeaders', () => {
  test('ページの応答にページのCSPと全てのセキュリティヘッダーとno-storeを付け、状態・本文・他のヘッダーを保つ', async () => {
    const response = new Response('<!doctype html><p>ok</p>', {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });

    const applied = applySecurityHeaders(response, PAGE_INPUT);

    expectSecurityHeaders(applied, PAGE_INPUT);
    expect(applied.status).toBe(404);
    expect(applied.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8',
    );
    expect(await applied.text()).toBe('<!doctype html><p>ok</p>');
  });

  test('ページ以外の応答にはページ以外のCSPを付ける', () => {
    const response = Response.json({ ok: true }, { status: 429 });

    const applied = applySecurityHeaders(response, NON_PAGE_INPUT);

    expectSecurityHeaders(applied, NON_PAGE_INPUT);
    expect(applied.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  test('応答が既に持つセキュリティヘッダーとキャッシュの指示を上書きする', () => {
    const response = new Response('ok', {
      headers: {
        'Content-Security-Policy': 'default-src *',
        'Permissions-Policy': 'camera=*',
        'Strict-Transport-Security': 'max-age=0',
        'X-Content-Type-Options': 'sniff',
        'Referrer-Policy': 'unsafe-url',
        'Cache-Control': 'public, max-age=31536000',
      },
    });

    const applied = applySecurityHeaders(response, PAGE_INPUT);

    expectSecurityHeaders(applied, PAGE_INPUT);
  });

  test('検索除外の指示があればX-Robots-Tagを付ける', () => {
    const applied = applySecurityHeaders(new Response('ok'), {
      ...PAGE_INPUT,
      noIndex: true,
    });

    expect(applied.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  test('検索除外の指示が無ければX-Robots-Tagを付けない', () => {
    const applied = applySecurityHeaders(new Response('ok'), PAGE_INPUT);

    expect(applied.headers.has('X-Robots-Tag')).toBe(false);
  });

  test('ヘッダーが不変の応答は複製してから付け、状態・本文・他のヘッダーを保つ', async () => {
    const response = new Response('moved', {
      status: 302,
      headers: { Location: 'https://app.example/next' },
    });
    spyOn(response.headers, 'set').mockImplementation(() => {
      throw new TypeError('immutable');
    });

    const applied = applySecurityHeaders(response, {
      ...NON_PAGE_INPUT,
      noIndex: true,
    });

    expect(applied).not.toBe(response);
    expectSecurityHeaders(applied, NON_PAGE_INPUT);
    expect(applied.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(applied.status).toBe(302);
    expect(applied.headers.get('Location')).toBe('https://app.example/next');
    expect(await applied.text()).toBe('moved');
  });

  test('TypeError以外の例外はそのまま投げる', () => {
    const response = new Response('ok');
    spyOn(response.headers, 'set').mockImplementation(() => {
      throw new RangeError('unexpected');
    });

    expect(() => applySecurityHeaders(response, PAGE_INPUT)).toThrow(
      RangeError,
    );
  });
});
