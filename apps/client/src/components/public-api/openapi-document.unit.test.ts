import { afterEach, describe, expect, spyOn, test } from 'bun:test';

import {
  fetchOpenApiDocument,
  openApiDocumentUrl,
  withAbsoluteServers,
} from './openapi-document.ts';

const PUBLIC_API_ORIGIN = 'https://api.example';
const LOCAL_PUBLIC_API_ORIGIN = 'http://localhost:48042';

let restoreFetch: (() => void) | undefined;

const fetchSpy = () => {
  const spy = spyOn(globalThis, 'fetch');
  restoreFetch = () => {
    spy.mockRestore();
  };
  return spy;
};

const failureOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => undefined,
    (error: unknown) => error,
  );

afterEach(() => {
  restoreFetch?.();
  restoreFetch = undefined;
});

describe('openApiDocumentUrl', () => {
  test('公開APIのオリジンの/v1/openapi.jsonを指す', () => {
    expect(openApiDocumentUrl(PUBLIC_API_ORIGIN)).toBe(
      'https://api.example/v1/openapi.json',
    );
    expect(openApiDocumentUrl(LOCAL_PUBLIC_API_ORIGIN)).toBe(
      'http://localhost:48042/v1/openapi.json',
    );
  });
});

describe('withAbsoluteServers', () => {
  test('相対のサーバーのURLを、公開APIのオリジンの絶対URLにする', () => {
    const document = {
      openapi: '3.1.0',
      servers: [{ url: '/v1', description: '公開API' }],
    };

    expect(
      withAbsoluteServers(document, LOCAL_PUBLIC_API_ORIGIN),
    ).toStrictEqual({
      openapi: '3.1.0',
      servers: [{ url: 'http://localhost:48042/v1', description: '公開API' }],
    });
  });

  test('絶対のサーバーのURLは変えない', () => {
    const document = {
      openapi: '3.1.0',
      servers: [{ url: 'https://other.example/v1' }, { url: '/v1' }],
    };

    expect(withAbsoluteServers(document, PUBLIC_API_ORIGIN)).toStrictEqual({
      openapi: '3.1.0',
      servers: [
        { url: 'https://other.example/v1' },
        { url: 'https://api.example/v1' },
      ],
    });
  });

  test('サーバーが無ければ、公開APIのオリジンの/v1を入れる', () => {
    expect(
      withAbsoluteServers({ openapi: '3.1.0' }, PUBLIC_API_ORIGIN),
    ).toStrictEqual({
      openapi: '3.1.0',
      servers: [{ url: 'https://api.example/v1' }],
    });
    expect(
      withAbsoluteServers({ openapi: '3.1.0', servers: [] }, PUBLIC_API_ORIGIN),
    ).toStrictEqual({
      openapi: '3.1.0',
      servers: [{ url: 'https://api.example/v1' }],
    });
  });

  test('渡した仕様書を書き換えない', () => {
    const servers = [{ url: '/v1' }];
    const document = { openapi: '3.1.0', servers };

    withAbsoluteServers(document, PUBLIC_API_ORIGIN);

    expect(document).toStrictEqual({
      openapi: '3.1.0',
      servers: [{ url: '/v1' }],
    });
    expect(document.servers).toBe(servers);
  });
});

describe('fetchOpenApiDocument', () => {
  test('公開APIの仕様書をCookieを送らずに取得し、JSONのオブジェクトを返す', async () => {
    const spy = fetchSpy().mockResolvedValue(
      Response.json({ openapi: '3.1.0', servers: [{ url: '/v1' }] }),
    );
    const controller = new AbortController();

    const document = await fetchOpenApiDocument(
      PUBLIC_API_ORIGIN,
      controller.signal,
    );

    expect(document).toStrictEqual({
      openapi: '3.1.0',
      servers: [{ url: '/v1' }],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] ?? [];
    expect(url).toBe('https://api.example/v1/openapi.json');
    expect(init).toMatchObject({
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
  });

  test('成功でない状態コードは失敗にする', async () => {
    fetchSpy().mockResolvedValue(
      Response.json(
        { error: { code: 'rate_limit_exceeded' } },
        { status: 429 },
      ),
    );

    expect(
      await failureOf(fetchOpenApiDocument(PUBLIC_API_ORIGIN)),
    ).toBeInstanceOf(Error);
  });

  test('JSONのオブジェクトでない応答は失敗にする', async () => {
    fetchSpy().mockResolvedValue(Response.json(['openapi']));

    expect(
      await failureOf(fetchOpenApiDocument(PUBLIC_API_ORIGIN)),
    ).toBeInstanceOf(Error);
  });

  test('通信の失敗はそのまま失敗にする', async () => {
    fetchSpy().mockRejectedValue(new TypeError('Failed to fetch'));

    expect(
      await failureOf(fetchOpenApiDocument(PUBLIC_API_ORIGIN)),
    ).toBeInstanceOf(TypeError);
  });
});
