import { expect, type Page, test } from '@playwright/test';

import {
  API_DOCS_MESSAGES,
  API_DOCS_PAGE_TITLE,
} from '../../apps/client/src/components/public-api/api-docs-messages.ts';
import { API_DOCS_HREF } from '../../apps/client/src/components/public-api/api-key-list-messages.ts';
import { resolveLocalWorkerOrigin } from '../support/local-worker-origins.ts';
import {
  installCspViolationRecorder,
  readCspViolations,
} from '../support/security-assertions.ts';

const PUBLIC_API_ORIGIN = new URL(resolveLocalWorkerOrigin('api', process.env))
  .origin;

const DOCUMENT_URL = `${PUBLIC_API_ORIGIN}/v1/openapi.json`;

// 公開APIの読み取りと更新の代表の経路。経路の一覧が仕様書から描かれたことを、方式とパスの組で確かめる
const LISTED_OPERATIONS = [
  { method: 'get', path: '/products' },
  { method: 'get', path: '/products/{handle}' },
  { method: 'get', path: '/users/{handle}/upvotes' },
  { method: 'patch', path: '/me/profile' },
  { method: 'put', path: '/me/products/{handle}/description' },
] as const;

// Swagger UIの描く経路の行は役割を持たないため、配布物の部品の名前とパスの属性で探す
const operationRow = (page: Page, method: string, path: string) =>
  page
    .getByRole('region', { name: API_DOCS_MESSAGES.referenceHeading })
    .locator(`.opblock-${method}`)
    .filter({ has: page.locator(`[data-path="${path}"]`) });

// ページの読み込みで送った要求のうち、本サービスのオリジンと公開APIのオリジンのどちらでもないもの
const recordForeignRequests = (page: Page, siteOrigin: string): string[] => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol === 'data:' || url.protocol === 'blob:') {
      return;
    }
    if (url.origin !== siteOrigin && url.origin !== PUBLIC_API_ORIGIN) {
      foreign.push(url.href);
    }
  });
  return foreign;
};

test.describe('APIドキュメントのページ', () => {
  test('ログインせずに開くと、Swagger UIに公開APIの経路の一覧を表示し、CSPの違反が無く、本サービスと公開API以外のオリジンへ要求しない', async ({
    page,
    baseURL,
  }) => {
    await installCspViolationRecorder(page);
    const foreignRequests = recordForeignRequests(
      page,
      new URL(API_DOCS_HREF, baseURL).origin,
    );
    const documentResponse = page.waitForResponse(DOCUMENT_URL);

    await page.goto(API_DOCS_HREF);

    await expect(
      page.getByRole('heading', { level: 1, name: API_DOCS_PAGE_TITLE }),
    ).toBeVisible();
    expect((await documentResponse).status()).toBe(200);
    for (const { method, path } of LISTED_OPERATIONS) {
      await expect(
        operationRow(page, method, path),
        `${method} ${path}`,
      ).toBeVisible();
    }
    await expect(
      page.getByRole('combobox').filter({ hasText: `${PUBLIC_API_ORIGIN}/v1` }),
    ).toBeVisible();
    expect(await readCspViolations(page)).toEqual([]);
    expect(foreignRequests).toEqual([]);
  });
});
