import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { GATEWAY_HEADERS } from '../../../apps/api/src/presentation/gateway/gateway-headers.ts';
import {
  expectErrorCode,
  expectPageNonce,
  expectSecurityHeaders,
  HTML_ACCEPT_HEADER,
  SET_COOKIE_HEADER_NAME,
} from '../../support/security-baseline-checks.ts';
import { annotateSkippedCheck } from '../../support/system-status-page.ts';
import {
  type BackendTargetName,
  isLocalOrigin,
  resolveBackendBaselineTargets,
} from './baseline-targets.ts';

const BASELINE_TAGS = ['@smoke', '@prod-check'];

const CLIENT_ROUTE_PATHS = [
  '/',
  '/p',
  '/help',
  '/legal',
  '/auth/login',
  '/auth/register',
];

const RELAY_GRAPHQL_PATH = '/_bff/graphql';

const PUBLIC_API_SPEC_PATH = '/v1/openapi.json';

const PUBLIC_API_DATA_PATH = '/v1/products';

// 公開の仕様書とプリフライトの成功の応答は認証の情報を含まず、Cache-Controlを付けない。no-storeを求めない種別で他のヘッダーを確かめ、no-storeは認証の失敗の応答で確かめる
const PUBLIC_API_CACHEABLE_TARGET = 'static-file';

const CORS_ORIGIN = 'https://customer-site.example';

const IMAGE_OBJECT_KEY_LENGTH = 32;

const DOCUMENT_ID_LENGTH = 64;

const SESSION_COOKIE_PLACEHOLDER = '__Host-ls_session=' + 'a'.repeat(64);

const randomHex = (length: number): string =>
  randomBytes(length).toString('hex').slice(0, length);

// 対象外なら理由をテストの記録に残し、呼び出し側が検査を省いて成功で終えられるよう`undefined`を返す
function targetOriginOf(
  name: BackendTargetName,
  baseURL: string | undefined,
): string | undefined {
  const target = resolveBackendBaselineTargets(process.env, baseURL ?? '')[
    name
  ];
  if (target.kind === 'skip') {
    annotateSkippedCheck(target.reason);
    return undefined;
  }
  return target.origin;
}

const relayHeadersOf = (
  baseURL: string | undefined,
): Readonly<Record<string, string>> => ({
  origin: new URL(baseURL ?? '').origin,
  accept: 'application/graphql-response+json',
});

interface GraphQLErrorBody {
  readonly errors: readonly {
    readonly extensions: { readonly code: string };
  }[];
}

test.describe(
  '利用者側の代表の経路のセキュリティの基線',
  { tag: BASELINE_TAGS },
  () => {
    for (const path of CLIENT_ROUTE_PATHS) {
      test(`${path}はセキュリティヘッダーとnonce付きのCSPを返し、全てのスクリプトが同じnonceを持つ`, async ({
        request,
      }) => {
        const response = await request.get(path, {
          headers: HTML_ACCEPT_HEADER,
        });

        expect(response.status()).toBe(200);
        expectSecurityHeaders(response, 'page');
        await expectPageNonce(response);
      });
    }

    test('存在しない経路の404もセキュリティヘッダーとnonce付きのCSPを返す', async ({
      request,
    }) => {
      const response = await request.get(`/${randomHex(16)}`, {
        headers: HTML_ACCEPT_HEADER,
      });

      expect(response.status()).toBe(404);
      expectSecurityHeaders(response, 'page');
      await expectPageNonce(response);
    });
  },
);

test.describe(
  '利用者側の中継の経路のセキュリティの基線',
  { tag: BASELINE_TAGS },
  () => {
    test('登録されていない操作の識別子を400で拒否する', async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(RELAY_GRAPHQL_PATH, {
        headers: relayHeadersOf(baseURL),
        data: { documentId: randomHex(DOCUMENT_ID_LENGTH), variables: {} },
      });

      expect(response.status()).toBe(400);
      const body = (await response.json()) as GraphQLErrorBody;
      expect(body.errors[0]?.extensions.code).toBe(
        'persisted_operation_not_found',
      );
      expectSecurityHeaders(response, 'non-page');
    });

    test('操作の識別子を持たずクエリの本文だけの要求を400で拒否する', async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(RELAY_GRAPHQL_PATH, {
        headers: relayHeadersOf(baseURL),
        data: { query: '{ __typename }' },
      });

      expect(response.status()).toBe(400);
      const body = (await response.json()) as GraphQLErrorBody;
      expect(body.errors[0]?.extensions.code).toBe(
        'persisted_operation_required',
      );
    });

    test('introspectionのクエリの本文を400で拒否する', async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(RELAY_GRAPHQL_PATH, {
        headers: relayHeadersOf(baseURL),
        data: { query: '{ __schema { types { name } } }' },
      });

      expect(response.status()).toBe(400);
    });

    test('登録されていない中継の経路を404で拒否する', async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(`/_bff/${randomHex(16)}`, {
        headers: { origin: new URL(baseURL ?? '').origin },
        data: {},
      });

      await expectErrorCode(response, 404, 'not_found');
      expectSecurityHeaders(response, 'non-page');
    });

    test('GraphQLの中継の経路へのGETを405で拒否する', async ({ request }) => {
      const response = await request.get(RELAY_GRAPHQL_PATH);

      expect(response.status()).toBe(405);
      expect(response.headers().allow).toBe('POST');
      expectSecurityHeaders(response, 'non-page');
    });
  },
);

test.describe('APIサーバーのセキュリティの基線', { tag: BASELINE_TAGS }, () => {
  test('ヘルスチェックの応答にセキュリティヘッダーが付く', async ({
    request,
    baseURL,
  }) => {
    const origin = targetOriginOf('api', baseURL);
    if (origin === undefined) {
      return;
    }

    const response = await request.get(`${origin}/health`);

    expect(response.status()).toBe(200);
    expectSecurityHeaders(response, 'non-page');
  });

  test('外部からのGraphQLへの要求を、呼び出し元を名乗っても404で拒否する', async ({
    request,
    baseURL,
  }) => {
    const origin = targetOriginOf('api', baseURL);
    if (origin === undefined) {
      return;
    }
    if (isLocalOrigin(origin)) {
      annotateSkippedCheck(
        'ローカルでは外部からの要求をGraphiQLの要求として応答するため、GraphQLの404は確かめない',
      );
      return;
    }

    const plain = await request.get(`${origin}/graphql`);
    const spoofed = await request.post(`${origin}/graphql`, {
      headers: { [GATEWAY_HEADERS.caller]: 'user' },
      data: { query: '{ __typename }' },
    });

    await expectErrorCode(plain, 404, 'not_found');
    await expectErrorCode(spoofed, 404, 'not_found');
    expectSecurityHeaders(spoofed, 'non-page');
  });

  test('内部RESTの経路を、呼び出し元を名乗っても404で拒否する', async ({
    request,
    baseURL,
  }) => {
    const origin = targetOriginOf('api', baseURL);
    if (origin === undefined) {
      return;
    }

    const response = await request.get(
      `${origin}/internal/media/uploads/${randomHex(8)}`,
      { headers: { [GATEWAY_HEADERS.caller]: 'user' } },
    );

    await expectErrorCode(response, 404, 'not_found');
    expectSecurityHeaders(response, 'non-page');
  });

  test('公開APIの仕様書の応答に、資格情報を許さないCORSのヘッダーが付く', async ({
    request,
    baseURL,
  }) => {
    const origin = targetOriginOf('api', baseURL);
    if (origin === undefined) {
      return;
    }

    const response = await request.get(`${origin}${PUBLIC_API_SPEC_PATH}`, {
      headers: { origin: CORS_ORIGIN },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    expect(
      response.headers()['access-control-allow-credentials'],
    ).toBeUndefined();
    expectSecurityHeaders(response, PUBLIC_API_CACHEABLE_TARGET);
  });

  test('公開APIをAPIキーなしで呼ぶと401で拒否し、CORSのヘッダーとno-storeが付く', async ({
    request,
    baseURL,
  }) => {
    const origin = targetOriginOf('api', baseURL);
    if (origin === undefined) {
      return;
    }

    const response = await request.get(`${origin}${PUBLIC_API_DATA_PATH}`, {
      headers: { origin: CORS_ORIGIN },
    });

    expect(response.status()).toBe(401);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    expect(response.headers()['www-authenticate']).toContain('Bearer');
    expectSecurityHeaders(response, 'non-page');
  });

  test('公開APIのプリフライトを認証なしで204と許可するメソッドで応答する', async ({
    request,
    baseURL,
  }) => {
    const origin = targetOriginOf('api', baseURL);
    if (origin === undefined) {
      return;
    }

    const response = await request.fetch(`${origin}${PUBLIC_API_SPEC_PATH}`, {
      method: 'OPTIONS',
      headers: {
        origin: CORS_ORIGIN,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });

    expect(response.status()).toBe(204);
    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-methods']).toContain('GET');
    expect(headers['access-control-allow-headers']).toContain('Authorization');
    expect(headers['access-control-allow-credentials']).toBeUndefined();
    expectSecurityHeaders(response, PUBLIC_API_CACHEABLE_TARGET);
  });
});

test.describe(
  'イベントサーバーのセキュリティの基線',
  { tag: BASELINE_TAGS },
  () => {
    test('ヘルスチェックと未登録の経路の応答にセキュリティヘッダーが付く', async ({
      request,
      baseURL,
    }) => {
      const origin = targetOriginOf('event', baseURL);
      if (origin === undefined) {
        return;
      }

      const health = await request.get(`${origin}/health`);
      const missing = await request.get(`${origin}/${randomHex(16)}`);

      expect(health.status()).toBe(200);
      expectSecurityHeaders(health, 'non-page');
      await expectErrorCode(missing, 404, 'not_found');
      expectSecurityHeaders(missing, 'non-page');
    });
  },
);

test.describe('画像配信のセキュリティの基線', { tag: BASELINE_TAGS }, () => {
  test('存在しない画像の404にセキュリティヘッダーが付き、認証のCookieを送ってもSet-Cookieを付けない', async ({
    request,
    baseURL,
  }) => {
    const origin = targetOriginOf('images', baseURL);
    if (origin === undefined) {
      return;
    }
    const url = `${origin}/${randomHex(IMAGE_OBJECT_KEY_LENGTH)}/avatar.webp`;

    const anonymous = await request.get(url);
    const withCookie = await request.get(url, {
      headers: { cookie: SESSION_COOKIE_PLACEHOLDER },
    });

    for (const response of [anonymous, withCookie]) {
      await expectErrorCode(response, 404, 'not_found');
      expectSecurityHeaders(response, 'non-page');
      expect(response.headers()[SET_COOKIE_HEADER_NAME]).toBeUndefined();
    }
  });

  test('画像の形式でない経路を404で拒否し、Set-Cookieを付けない', async ({
    request,
    baseURL,
  }) => {
    const origin = targetOriginOf('images', baseURL);
    if (origin === undefined) {
      return;
    }

    const response = await request.get(`${origin}/${randomHex(16)}`);

    await expectErrorCode(response, 404, 'not_found');
    expect(response.headers()[SET_COOKIE_HEADER_NAME]).toBeUndefined();
  });

  test('ローカル以外では、画像配信のホスト名が利用者側と異なり、認証のCookieが届かない', ({
    baseURL,
  }) => {
    const origin = targetOriginOf('images', baseURL);
    if (origin === undefined) {
      return;
    }
    if (isLocalOrigin(origin)) {
      annotateSkippedCheck(
        'ローカルのCookieはポートで分かれないため、ホスト名の分離は確かめない',
      );
      return;
    }

    expect(new URL(origin).hostname).not.toBe(new URL(baseURL ?? '').hostname);
  });
});
