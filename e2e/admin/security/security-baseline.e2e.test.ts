import { randomBytes } from 'node:crypto';

import { expect, test } from '@playwright/test';

import {
  expectErrorCode,
  expectPageNonce,
  expectSecurityHeaders,
  HTML_ACCEPT_HEADER,
} from '../../support/security-baseline-checks.ts';

const BASELINE_TAGS = ['@smoke', '@prod-check'];

const ADMIN_ROUTE_PATHS = ['/auth/login'];

const RELAY_GRAPHQL_PATH = '/_bff/graphql';

const DOCUMENT_ID_BYTES = 32;

const randomHex = (bytes: number): string => randomBytes(bytes).toString('hex');

test.describe(
  '管理者側の代表の経路のセキュリティの基線',
  { tag: BASELINE_TAGS },
  () => {
    for (const path of ADMIN_ROUTE_PATHS) {
      test(`${path}はセキュリティヘッダーとnonce付きのCSPを返し、キャッシュと検索への掲載を許さない`, async ({
        request,
      }) => {
        const response = await request.get(path, {
          headers: HTML_ACCEPT_HEADER,
        });

        expect(response.status()).toBe(200);
        expectSecurityHeaders(response, 'page');
        await expectPageNonce(response);
        expect(response.headers()['cache-control']).toContain('no-store');
        expect(response.headers()['x-robots-tag']).toContain('noindex');
      });
    }

    test('未ログインでログインが要る経路を開くと、ログインへ移し、移す応答にもセキュリティヘッダーとno-storeが付く', async ({
      request,
    }) => {
      const response = await request.get('/', {
        headers: HTML_ACCEPT_HEADER,
        maxRedirects: 0,
      });

      expect(response.status()).toBeGreaterThanOrEqual(300);
      expect(response.status()).toBeLessThan(400);
      expect(response.headers().location).toContain('/auth/login');
      expectSecurityHeaders(response, 'non-page');
    });

    test('存在しない経路の404もセキュリティヘッダーとnonce付きのCSPを返す', async ({
      request,
    }) => {
      const response = await request.get(`/${randomHex(8)}`, {
        headers: HTML_ACCEPT_HEADER,
      });

      expect(response.status()).toBe(404);
      expectSecurityHeaders(response, 'page');
      await expectPageNonce(response);
    });
  },
);

test.describe(
  '管理者側の中継の経路のセキュリティの基線',
  { tag: BASELINE_TAGS },
  () => {
    test('登録されていない操作の識別子を400で拒否し、応答にセキュリティヘッダーが付く', async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(RELAY_GRAPHQL_PATH, {
        headers: {
          origin: new URL(baseURL ?? '').origin,
          accept: 'application/graphql-response+json',
        },
        data: { documentId: randomHex(DOCUMENT_ID_BYTES), variables: {} },
      });

      expect(response.status()).toBe(400);
      const body = (await response.json()) as {
        errors: readonly { extensions: { code: string } }[];
      };
      expect(body.errors[0]?.extensions.code).toBe(
        'persisted_operation_not_found',
      );
      expectSecurityHeaders(response, 'non-page');
    });

    test('登録されていない中継の経路を404で拒否する', async ({
      request,
      baseURL,
    }) => {
      const response = await request.post(`/_bff/${randomHex(8)}`, {
        headers: { origin: new URL(baseURL ?? '').origin },
        data: {},
      });

      await expectErrorCode(response, 404, 'not_found');
      expectSecurityHeaders(response, 'non-page');
    });
  },
);
