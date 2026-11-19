import { describe, expect, test } from 'bun:test';

import type { BrowserContext, Route } from '@playwright/test';

import {
  assumeDistinctClientIp,
  CONNECTING_IP_HEADER,
  randomDocumentationIpv6,
} from './client-ip.ts';

type UrlMatcher = (url: URL) => boolean;

type RouteHandler = (route: Route) => Promise<void>;

interface RegisteredRoute {
  readonly matches: UrlMatcher;
  readonly handle: RouteHandler;
}

const DOCUMENTATION_IPV6_PATTERN = /^2001:db8:(?:[0-9a-f]{4}:){5}[0-9a-f]{4}$/u;

const BASE_URL = 'http://localhost:48080/products?page=2';

// ブラウザの文脈の経路の登録だけを記録する偽物
function fakeContext(): {
  readonly context: BrowserContext;
  readonly routes: RegisteredRoute[];
} {
  const routes: RegisteredRoute[] = [];
  const context = {
    route: (matches: UrlMatcher, handle: RouteHandler) => {
      routes.push({ matches, handle });
      return Promise.resolve();
    },
  } as unknown as BrowserContext;
  return { context, routes };
}

// 元の要求のヘッダーを返し、続行の時に渡された内容を記録する偽物
function fakeRoute(headers: Readonly<Record<string, string>>): {
  readonly route: Route;
  readonly continued: unknown[];
} {
  const continued: unknown[] = [];
  const route = {
    request: () => ({ headers: () => headers }),
    continue: (options: unknown) => {
      continued.push(options);
      return Promise.resolve();
    },
  } as unknown as Route;
  return { route, continued };
}

describe('randomDocumentationIpv6', () => {
  test('文書用に予約されたIPv6のアドレス範囲から、呼ぶごとに別の値を選ぶ', () => {
    const first = randomDocumentationIpv6();
    const second = randomDocumentationIpv6();

    expect(first).toMatch(DOCUMENTATION_IPV6_PATTERN);
    expect(second).toMatch(DOCUMENTATION_IPV6_PATTERN);
    expect(second).not.toBe(first);
  });
});

describe('assumeDistinctClientIp', () => {
  test('対象のオリジンへの要求にだけ、元のヘッダーを保って名乗る接続元のIPアドレスを加え、そのアドレスを返す', async () => {
    const { context, routes } = fakeContext();

    const clientIp = await assumeDistinctClientIp(context, BASE_URL);

    expect(clientIp).toMatch(DOCUMENTATION_IPV6_PATTERN);
    expect(routes).toHaveLength(1);
    const [registered] = routes;
    expect(registered?.matches(new URL('http://localhost:48080/login'))).toBe(
      true,
    );
    expect(
      registered?.matches(
        new URL('https://challenges.cloudflare.example/turnstile.js'),
      ),
    ).toBe(false);
    const { route, continued } = fakeRoute({ accept: 'text/html' });
    await registered?.handle(route);
    expect(continued).toStrictEqual([
      { headers: { accept: 'text/html', [CONNECTING_IP_HEADER]: clientIp } },
    ]);
  });

  test('ブラウザの文脈ごとに別の接続元のIPアドレスを名乗る', async () => {
    const first = await assumeDistinctClientIp(fakeContext().context, BASE_URL);
    const second = await assumeDistinctClientIp(
      fakeContext().context,
      BASE_URL,
    );

    expect(second).not.toBe(first);
  });

  test('E2E対象のURLが無ければ、経路を登録せずに例外を投げる', async () => {
    const { context, routes } = fakeContext();

    const error = await assumeDistinctClientIp(context, undefined).then(
      () => undefined,
      (reason: unknown) => reason,
    );

    expect(error).toStrictEqual(new Error('E2E対象のURLが設定されていません'));
    expect(routes).toHaveLength(0);
  });
});
