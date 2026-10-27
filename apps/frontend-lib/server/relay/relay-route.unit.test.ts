import { describe, expect, test } from 'bun:test';

import { getLogger } from '@logtape/logtape';

import {
  defineRelayRoute,
  findRelayRoute,
  GRAPHQL_RELAY_ROUTE,
  type RelayLogger,
  type RelayRoute,
} from './relay-route.ts';

const MEDIA_ROUTE = defineRelayRoute({
  path: '/_bff/media/*',
  methods: ['PUT'],
  upstreamPath: () => '/internal/media',
  acceptContentTypes: ['image/png'],
  timeoutMs: 60_000,
});

const STATUS_ROUTE = defineRelayRoute({
  path: '/_bff/status',
  methods: ['GET'],
  upstreamPath: () => '/internal/status',
  timeoutMs: 5000,
});

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

describe('GRAPHQL_RELAY_ROUTE', () => {
  test('/_bff/graphqlのPOSTをapplication/jsonだけ受け付け、上流の/graphqlへ15秒で中継する', () => {
    expect(GRAPHQL_RELAY_ROUTE.path).toBe('/_bff/graphql');
    expect(GRAPHQL_RELAY_ROUTE.methods).toEqual(['POST']);
    expect(
      GRAPHQL_RELAY_ROUTE.upstreamPath(
        new URL('https://app.example/_bff/graphql?x=1'),
      ),
    ).toBe('/graphql');
    expect(GRAPHQL_RELAY_ROUTE.acceptContentTypes).toEqual([
      'application/json',
    ]);
    expect(GRAPHQL_RELAY_ROUTE.extraForwardedHeaders).toEqual([]);
    expect(GRAPHQL_RELAY_ROUTE.timeoutMs).toBe(15_000);
  });

  test('凍結されている', () => {
    expect(Object.isFrozen(GRAPHQL_RELAY_ROUTE)).toBe(true);
    expect(Object.isFrozen(GRAPHQL_RELAY_ROUTE.methods)).toBe(true);
    expect(Object.isFrozen(GRAPHQL_RELAY_ROUTE.acceptContentTypes)).toBe(true);
  });
});

describe('defineRelayRoute', () => {
  test('経路の定義を凍結した写しで返す', () => {
    const methods = ['PUT'] as const;
    const route = defineRelayRoute({
      path: '/_bff/media/*',
      methods,
      upstreamPath: () => '/internal/media',
      acceptContentTypes: ['image/png'],
      extraForwardedHeaders: ['content-length'],
      timeoutMs: 60_000,
    });

    expect(route.methods).toEqual(['PUT']);
    expect(route.methods).not.toBe(methods);
    expect(route.extraForwardedHeaders).toEqual(['content-length']);
    expect(Object.isFrozen(route)).toBe(true);
    expect(Object.isFrozen(route.extraForwardedHeaders)).toBe(true);
  });

  test.each([
    ['/graphql'],
    ['/_bff'],
    ['/_bff/'],
    ['/_bff/*'],
    ['/_bff/media*'],
    ['/_bff/a/*/b'],
    ['/_bff/a b'],
    ['/_bff/a?b'],
    ['/_bff/a/'],
    ['/_bff/a//b'],
  ])('経路%sは中継の接頭辞の下の正しい形でないため例外になる', (path) => {
    expect(() =>
      defineRelayRoute({
        path,
        methods: ['GET'],
        upstreamPath: () => '/internal',
        timeoutMs: 1000,
      }),
    ).toThrow(TypeError);
  });

  test('メソッドが無い・重複する・中継できないメソッドの場合は例外になる', () => {
    const base = {
      path: '/_bff/status',
      upstreamPath: () => '/internal',
      timeoutMs: 1000,
    };

    expect(() => defineRelayRoute({ ...base, methods: [] })).toThrow(TypeError);
    expect(() =>
      defineRelayRoute({ ...base, methods: ['GET', 'GET'] }),
    ).toThrow(TypeError);
    expect(() =>
      defineRelayRoute({
        ...base,
        methods: ['PATCH' as RelayRoute['methods'][number]],
      }),
    ).toThrow(TypeError);
  });

  test.each([[0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY]])(
    '待ち時間%pは正の整数でないため例外になる',
    (timeoutMs) => {
      expect(() =>
        defineRelayRoute({
          path: '/_bff/status',
          methods: ['GET'],
          upstreamPath: () => '/internal',
          timeoutMs,
        }),
      ).toThrow(RangeError);
    },
  );

  test.each([['POST'], ['PUT']] as const)(
    '本文を受け取る%sで受け付ける形式が無い場合は例外になる',
    (method) => {
      const base = {
        path: '/_bff/upload',
        methods: [method],
        upstreamPath: () => '/internal',
        timeoutMs: 1000,
      };

      expect(() =>
        defineRelayRoute({ ...base, acceptContentTypes: [] }),
      ).toThrow(TypeError);
      expect(() => defineRelayRoute(base)).toThrow(TypeError);
    },
  );

  test.each([
    ['Application/JSON'],
    ['application/json; charset=utf-8'],
    ['json'],
  ])('受け付ける形式%sは小文字の型/副型でないため例外になる', (contentType) => {
    expect(() =>
      defineRelayRoute({
        path: '/_bff/upload',
        methods: ['POST'],
        upstreamPath: () => '/internal',
        acceptContentTypes: [contentType],
        timeoutMs: 1000,
      }),
    ).toThrow(TypeError);
  });

  test.each([
    ['cookie'],
    ['x-original-client-ip'],
    ['x-session-token'],
    ['x-internal-caller'],
    ['x-debug-caller'],
    ['sentry-trace'],
    ['baggage'],
    ['x-session-issue'],
    ['x-session-max-age'],
    ['x-session-clear'],
    ['Content-Length'],
    ['bad header'],
  ])(
    '追加で引き継ぐ項目%sは予約名か小文字の項目名でないため、項目名だけを含む例外になる',
    (name) => {
      const error = errorOf(() =>
        defineRelayRoute({
          path: '/_bff/upload',
          methods: ['GET'],
          upstreamPath: () => '/internal',
          extraForwardedHeaders: [name],
          timeoutMs: 1000,
        }),
      );

      expect(error).toBeInstanceOf(TypeError);
      expect(error.message).toContain(name);
    },
  );
});

describe('findRelayRoute', () => {
  const routes = [GRAPHQL_RELAY_ROUTE, MEDIA_ROUTE, STATUS_ROUTE];
  const find = (url: string): RelayRoute | undefined =>
    findRelayRoute(routes, new URL(url));

  test('完全一致の経路をクエリを無視して見つける', () => {
    expect(find('https://app.example/_bff/graphql')).toBe(GRAPHQL_RELAY_ROUTE);
    expect(find('https://app.example/_bff/graphql?op=1')).toBe(
      GRAPHQL_RELAY_ROUTE,
    );
    expect(find('https://app.example/_bff/status')).toBe(STATUS_ROUTE);
  });

  test('末尾が/*の経路は接頭辞の下の経路に一致する', () => {
    expect(find('https://app.example/_bff/media/a/b.png')).toBe(MEDIA_ROUTE);
  });

  test.each([
    ['https://app.example/_bff/graphql/'],
    ['https://app.example/_bff/graphqlx'],
    ['https://app.example/_bff/GRAPHQL'],
    ['https://app.example/_bff/%67raphql'],
    ['https://app.example/_bff/media/'],
    ['https://app.example/_bff/media'],
    ['https://app.example/_bff/unknown'],
    ['https://app.example/graphql'],
  ])('%sは登録した経路に一致しない', (url) => {
    expect(find(url)).toBeUndefined();
  });

  test('登録が無ければ一致しない', () => {
    expect(
      findRelayRoute([], new URL('https://app.example/_bff/graphql')),
    ).toBeUndefined();
  });
});

describe('RelayLogger', () => {
  test('LogTapeのロガーを中継の失敗のロガーとして渡せる', () => {
    const logger: RelayLogger = getLogger(['frontend-lib-test', 'relay']);

    expect(typeof logger.warn).toBe('function');
  });
});
