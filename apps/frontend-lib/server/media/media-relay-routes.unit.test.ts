import { describe, expect, test } from 'bun:test';

import { ATTACHMENT_MEDIA_TYPES } from '../../../common-lib/media/media-types.ts';
import {
  decodeFileNameHeader,
  downloadPathOf,
  encodeFileNameHeader,
  FILE_RELAY_PREFIX,
  UPLOAD_FILE_NAME_HEADER,
  UPLOAD_RELAY_PREFIX,
} from '../../../common-lib/media/upload-protocol.ts';
import {
  BAGGAGE,
  BOT_TOKEN,
  CLIENT_COOKIE,
  CLIENT_IP,
  CLIENT_TOKEN,
  depsOf,
  firstCall,
  respondingWith,
  SENTRY_TRACE,
} from '../../test/relay-route-fixtures.ts';
import {
  findRelayRoute,
  GRAPHQL_RELAY_ROUTE,
  relayToApi,
} from '../relay/relay-route.ts';
import {
  FILE_DOWNLOAD_RELAY_ROUTE,
  UPLOAD_RELAY_ROUTE,
} from './media-relay-routes.ts';

const APP_ORIGIN = 'https://app.example';

const RELAY_TIMEOUT_MS = 120_000;

const FILE_ID = '01JBQ7ZK3M8N4P5R6S7T8V9W0X';

const IMAGE_BODY = 'image-body';

const IMAGE_BYTES = new TextEncoder().encode(IMAGE_BODY);

const urlOf = (path: string): URL => new URL(path, APP_ORIGIN);

const errorBodyOf = (code: string): unknown => ({
  error: { code, message: expect.any(String) as unknown as string },
});

const uploadRequest = (
  path: string,
  contentType: string,
  fileName = '製品ロゴ.png',
): Request =>
  new Request(urlOf(path), {
    method: 'POST',
    headers: {
      'CF-Connecting-IP': CLIENT_IP,
      Cookie: `${CLIENT_COOKIE}=${CLIENT_TOKEN}`,
      'Content-Type': contentType,
      'Content-Length': String(IMAGE_BYTES.byteLength),
      [UPLOAD_FILE_NAME_HEADER]: encodeFileNameHeader(fileName),
      'cf-turnstile-response': BOT_TOKEN,
      'x-session-token': 'spoofed',
    },
    body: IMAGE_BYTES,
  });

const downloadRequest = (fileId: string, method = 'GET'): Request =>
  new Request(urlOf(downloadPathOf(fileId)), {
    method,
    headers: {
      'CF-Connecting-IP': CLIENT_IP,
      Cookie: `${CLIENT_COOKIE}=${CLIENT_TOKEN}`,
    },
  });

describe('UPLOAD_RELAY_ROUTE', () => {
  test('アップロードの接頭辞の下のPOSTを、全用途の許可形式の範囲だけ受け付け、120秒で中継する', () => {
    expect(UPLOAD_RELAY_ROUTE.path).toBe(`${UPLOAD_RELAY_PREFIX}*`);
    expect(UPLOAD_RELAY_ROUTE.path).toBe('/_bff/uploads/*');
    expect(UPLOAD_RELAY_ROUTE.methods).toEqual(['POST']);
    expect(UPLOAD_RELAY_ROUTE.acceptContentTypes).toEqual([
      ...ATTACHMENT_MEDIA_TYPES,
    ]);
    expect(UPLOAD_RELAY_ROUTE.timeoutMs).toBe(RELAY_TIMEOUT_MS);
  });

  test('本文の長さとファイル名の項目を追加で引き継ぐ', () => {
    expect(UPLOAD_RELAY_ROUTE.extraForwardedHeaders).toEqual([
      'content-length',
      UPLOAD_FILE_NAME_HEADER,
    ]);
  });

  test('上流のアップロードの経路へ、用途名を百分率符号化して渡す', () => {
    expect(
      UPLOAD_RELAY_ROUTE.upstreamPath(urlOf('/_bff/uploads/product-logo?x=1')),
    ).toBe('/internal/media/uploads/product-logo');
  });

  test.each([
    ['空白', '/_bff/uploads/a b', '/internal/media/uploads/a%20b'],
    [
      '日本語',
      '/_bff/uploads/画像',
      `/internal/media/uploads/${encodeURIComponent('画像')}`,
    ],
    ['区切りの/', '/_bff/uploads/a/b', '/internal/media/uploads/a%2Fb'],
    ['符号化した/', '/_bff/uploads/a%2Fb', '/internal/media/uploads/a%2Fb'],
    [
      '符号化した..',
      '/_bff/uploads/x%2F..%2F..%2Fgraphql',
      '/internal/media/uploads/x%2F..%2F..%2Fgraphql',
    ],
    [
      '不正な百分率符号化',
      '/_bff/uploads/%E0%A4%A',
      '/internal/media/uploads/%25E0%25A4%25A',
    ],
  ])('用途名の%sは上流のパスの1つの区画に収める', (_label, path, expected) => {
    expect(UPLOAD_RELAY_ROUTE.upstreamPath(urlOf(path))).toBe(expected);
  });

  test('凍結されている', () => {
    expect(Object.isFrozen(UPLOAD_RELAY_ROUTE)).toBe(true);
    expect(Object.isFrozen(UPLOAD_RELAY_ROUTE.methods)).toBe(true);
    expect(Object.isFrozen(UPLOAD_RELAY_ROUTE.acceptContentTypes)).toBe(true);
    expect(Object.isFrozen(UPLOAD_RELAY_ROUTE.extraForwardedHeaders)).toBe(
      true,
    );
  });
});

describe('FILE_DOWNLOAD_RELAY_ROUTE', () => {
  test('ファイルの接頭辞の下のGETだけを、本文の形式と追加の項目なしで120秒で中継する', () => {
    expect(FILE_DOWNLOAD_RELAY_ROUTE.path).toBe(`${FILE_RELAY_PREFIX}*`);
    expect(FILE_DOWNLOAD_RELAY_ROUTE.path).toBe('/_bff/files/*');
    expect(FILE_DOWNLOAD_RELAY_ROUTE.methods).toEqual(['GET']);
    expect(FILE_DOWNLOAD_RELAY_ROUTE.acceptContentTypes).toEqual([]);
    expect(FILE_DOWNLOAD_RELAY_ROUTE.extraForwardedHeaders).toEqual([]);
    expect(FILE_DOWNLOAD_RELAY_ROUTE.timeoutMs).toBe(RELAY_TIMEOUT_MS);
  });

  test.each([[FILE_ID], ['a b'], ['a/b'], ['添付'], ['%']])(
    'downloadPathOf(%j)の経路を、上流のファイルの経路へ識別子を百分率符号化して渡す',
    (fileId) => {
      expect(
        FILE_DOWNLOAD_RELAY_ROUTE.upstreamPath(urlOf(downloadPathOf(fileId))),
      ).toBe(`/internal/media/files/${encodeURIComponent(fileId)}`);
    },
  );

  test('凍結されている', () => {
    expect(Object.isFrozen(FILE_DOWNLOAD_RELAY_ROUTE)).toBe(true);
    expect(Object.isFrozen(FILE_DOWNLOAD_RELAY_ROUTE.methods)).toBe(true);
  });
});

describe('経路の照合', () => {
  const routes = [
    GRAPHQL_RELAY_ROUTE,
    UPLOAD_RELAY_ROUTE,
    FILE_DOWNLOAD_RELAY_ROUTE,
  ];

  test.each([
    ['/_bff/uploads/product-logo', UPLOAD_RELAY_ROUTE],
    [downloadPathOf(FILE_ID), FILE_DOWNLOAD_RELAY_ROUTE],
    ['/_bff/graphql', GRAPHQL_RELAY_ROUTE],
  ])('%sは対応する経路に一致する', (path, expected) => {
    expect(findRelayRoute(routes, urlOf(path))).toBe(expected);
  });

  test.each([['/_bff/uploads/'], ['/_bff/files/'], ['/_bff/uploads']])(
    '接頭辞そのもの(%s)はどの経路にも一致しない',
    (path) => {
      expect(findRelayRoute(routes, urlOf(path))).toBeUndefined();
    },
  );
});

describe('relayToApi(アップロード)', () => {
  test('本文と許可した項目を上流のアップロードの経路へ中継し、上流の応答を返す', async () => {
    const uploaded = JSON.stringify({ data: { fileId: FILE_ID } });
    const api = respondingWith(
      () =>
        new Response(uploaded, {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const response = await relayToApi(
      UPLOAD_RELAY_ROUTE,
      uploadRequest('/_bff/uploads/product-logo', 'image/png'),
      depsOf(api).deps,
    );

    const call = firstCall(api);
    expect(call.url).toBe(
      'https://api.internal/internal/media/uploads/product-logo',
    );
    expect(call.method).toBe('POST');
    expect(call.headers).toEqual({
      'x-original-client-ip': CLIENT_IP,
      'x-session-token': CLIENT_TOKEN,
      'cf-turnstile-response': BOT_TOKEN,
      'content-type': 'image/png',
      'content-length': String(IMAGE_BYTES.byteLength),
      [UPLOAD_FILE_NAME_HEADER]: encodeFileNameHeader('製品ロゴ.png'),
      'sentry-trace': SENTRY_TRACE,
      baggage: BAGGAGE,
    });
    expect(
      decodeFileNameHeader(call.headers[UPLOAD_FILE_NAME_HEADER] ?? null),
    ).toBe('製品ロゴ.png');
    expect(call.body).toBe(IMAGE_BODY);
    expect(response.status).toBe(201);
    expect(await response.text()).toBe(uploaded);
  });

  test.each([['application/zip'], ['image/avif'], ['multipart/form-data']])(
    '受け付ける形式に無い%sは上流へ送らずに415のunsupported_media_typeにする',
    async (contentType) => {
      const api = respondingWith(() => new Response(null, { status: 201 }));

      const response = await relayToApi(
        UPLOAD_RELAY_ROUTE,
        uploadRequest('/_bff/uploads/product-logo', contentType),
        depsOf(api).deps,
      );

      expect(response.status).toBe(415);
      expect(await response.json()).toEqual(
        errorBodyOf('unsupported_media_type'),
      );
      expect(api.calls).toHaveLength(0);
    },
  );

  test('上流のJSONでない5xxは503のupstream_unavailableにする', async () => {
    const api = respondingWith(
      () =>
        new Response('Worker exceeded resource limits', {
          status: 503,
          headers: { 'Content-Type': 'text/html' },
        }),
    );

    const response = await relayToApi(
      UPLOAD_RELAY_ROUTE,
      uploadRequest('/_bff/uploads/product-logo', 'image/png'),
      depsOf(api).deps,
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(await response.json()).toEqual(errorBodyOf('upstream_unavailable'));
  });
});

describe('relayToApi(ダウンロード)', () => {
  const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n');

  const DISPOSITION = `attachment; filename="file.pdf"; filename*=UTF-8''${encodeURIComponent('資料.pdf')}`;

  test('上流のファイルの経路へ本文なしで中継し、Content-Type・Content-Disposition・Content-Lengthと本文を残して返す', async () => {
    const api = respondingWith(
      () =>
        new Response(PDF_BYTES, {
          status: 200,
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': DISPOSITION,
            'Content-Length': String(PDF_BYTES.byteLength),
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          },
        }),
    );

    const response = await relayToApi(
      FILE_DOWNLOAD_RELAY_ROUTE,
      downloadRequest(FILE_ID),
      depsOf(api).deps,
    );

    const call = firstCall(api);
    expect(call.url).toBe(
      `https://api.internal/internal/media/files/${FILE_ID}`,
    );
    expect(call.method).toBe('GET');
    expect(call.body).toBe('');
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe(DISPOSITION);
    expect(response.headers.get('Content-Length')).toBe(
      String(PDF_BYTES.byteLength),
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PDF_BYTES);
  });

  test('上流の共通のエラー形式の404はそのまま返す', async () => {
    const notFound = '{"error":{"code":"not_found","message":"x"}}';
    const api = respondingWith(
      () =>
        new Response(notFound, {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }),
    );

    const response = await relayToApi(
      FILE_DOWNLOAD_RELAY_ROUTE,
      downloadRequest(FILE_ID),
      depsOf(api).deps,
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(notFound);
  });

  test('GET以外は上流へ送らずに405にする', async () => {
    const api = respondingWith(() => new Response(null, { status: 200 }));

    const response = await relayToApi(
      FILE_DOWNLOAD_RELAY_ROUTE,
      downloadRequest(FILE_ID, 'DELETE'),
      depsOf(api).deps,
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    expect(api.calls).toHaveLength(0);
  });
});
