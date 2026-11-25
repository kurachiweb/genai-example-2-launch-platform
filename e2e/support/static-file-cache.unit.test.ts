import { describe, expect, test } from 'bun:test';

import {
  createStaticFileCache,
  isStaticFileUrl,
  rememberStaticFile,
  replayStaticFile,
  type StaticFile,
  type StaticFileResponse,
} from './static-file-cache.ts';

const FILE_URL = 'https://client.example/assets/index-BjBqYS8L.js';

const IMMUTABLE_HEADERS: Readonly<Record<string, string>> = {
  'cache-control': 'public, max-age=31536000, immutable',
  'content-type': 'text/javascript',
  'x-content-type-options': 'nosniff',
};

interface FakeResponseOptions {
  readonly url?: string;
  readonly method?: string;
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: () => Promise<Buffer>;
}

const fakeResponse = ({
  url = FILE_URL,
  method = 'GET',
  status = 200,
  headers = IMMUTABLE_HEADERS,
  body = () => Promise.resolve(Buffer.from('export {};')),
}: FakeResponseOptions = {}): StaticFileResponse => ({
  url: () => url,
  status: () => status,
  headers: () => ({ ...headers }),
  request: () => ({ method: () => method }),
  body,
});

const fakeRoute = (url: string, method = 'GET') => {
  const calls: (StaticFile | 'fallback')[] = [];
  return {
    calls: (): readonly (StaticFile | 'fallback')[] => [...calls],
    request: () => ({ url: () => url, method: () => method }),
    fallback: async (): Promise<void> => {
      calls.push('fallback');
      await Promise.resolve();
    },
    fulfill: async (file: StaticFile): Promise<void> => {
      calls.push(file);
      await Promise.resolve();
    },
  };
};

describe('isStaticFileUrl', () => {
  test('ビルドの成果物の置き場所の下のURLだけを対象にする', () => {
    expect(isStaticFileUrl(new URL(FILE_URL))).toBe(true);
    expect(isStaticFileUrl(new URL('https://client.example/favicon.ico'))).toBe(
      false,
    );
    expect(
      isStaticFileUrl(new URL('https://client.example/system/assets/x.js')),
    ).toBe(false);
    expect(
      isStaticFileUrl(new URL('http://localhost:48044/@vite/client')),
    ).toBe(false);
  });
});

describe('静的なファイルの使い回し', () => {
  test('覚えていないファイルの要求はそのまま対象へ送る', async () => {
    const route = fakeRoute(FILE_URL);

    await replayStaticFile(createStaticFileCache(), route);

    expect(route.calls()).toEqual(['fallback']);
  });

  test('覚えたファイルの要求には、対象へ送らずに同じ状態コード・ヘッダー・本文で応答する', async () => {
    const cache = createStaticFileCache();
    await rememberStaticFile(cache, fakeResponse());
    const route = fakeRoute(FILE_URL);

    await replayStaticFile(cache, route);

    expect(route.calls()).toEqual([
      {
        status: 200,
        headers: IMMUTABLE_HEADERS,
        body: Buffer.from('export {};'),
      },
    ]);
  });

  test('本文は復号した後の値のため、転送時の符号化と長さのヘッダーを除いて応答する', async () => {
    const cache = createStaticFileCache();
    await rememberStaticFile(
      cache,
      fakeResponse({
        headers: {
          ...IMMUTABLE_HEADERS,
          'content-encoding': 'br',
          'content-length': '5',
          'transfer-encoding': 'chunked',
        },
      }),
    );
    const route = fakeRoute(FILE_URL);

    await replayStaticFile(cache, route);

    expect(route.calls()).toEqual([
      expect.objectContaining({ headers: IMMUTABLE_HEADERS }),
    ]);
  });

  test('GET以外の要求には覚えたファイルで応答しない', async () => {
    const cache = createStaticFileCache();
    await rememberStaticFile(cache, fakeResponse());
    const route = fakeRoute(FILE_URL, 'HEAD');

    await replayStaticFile(cache, route);

    expect(route.calls()).toEqual(['fallback']);
  });

  test.each<readonly [string, FakeResponseOptions]>([
    ['200以外の応答', { status: 429 }],
    [
      '再検証なしの長期のキャッシュを許さない応答',
      { headers: { 'cache-control': 'no-store' } },
    ],
    ['Cache-Controlの無い応答', { headers: {} }],
    ['GET以外の応答', { method: 'HEAD' }],
    [
      'ビルドの成果物の置き場所の外の応答',
      { url: 'https://client.example/favicon.ico' },
    ],
    [
      '本文を読めなかった応答',
      { body: () => Promise.reject(new Error('Target page has been closed')) },
    ],
  ])('%sは覚えない', async (_name, options) => {
    const cache = createStaticFileCache();
    const response = fakeResponse(options);

    await rememberStaticFile(cache, response);

    const route = fakeRoute(response.url());
    await replayStaticFile(cache, route);
    expect(route.calls()).toEqual(['fallback']);
  });

  test('覚えたファイルの応答の本文を読み直さない', async () => {
    const cache = createStaticFileCache();
    await rememberStaticFile(cache, fakeResponse());
    let bodyReads = 0;

    await rememberStaticFile(
      cache,
      fakeResponse({
        body: () => {
          bodyReads += 1;
          return Promise.resolve(Buffer.from(''));
        },
      }),
    );

    expect(bodyReads).toBe(0);
  });
});
