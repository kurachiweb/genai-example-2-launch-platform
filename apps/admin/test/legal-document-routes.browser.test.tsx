import { createRoute } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import {
  loadAdminLegalDocument,
  loadAdminLegalDocumentVersion,
} from '../src/graphql/admin-legal-documents.ts';
import {
  AdminLegalDocumentDocument,
  type AdminLegalDocumentVersionQueryVariables,
  AdminLegalDocumentVersionDocument,
  AdminViewerDocument,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as LegalDocumentEditorRoute } from '../src/routes/_authenticated/legal-documents/$kind/index.tsx';
import { Route as LegalDocumentVersionRoute } from '../src/routes/_authenticated/legal-documents/$kind/revisions/$versionNumber.tsx';
import { failure, success } from './admin-accounts-fixtures.ts';
import { adminViewerResult, adminWithRole } from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const SUPER_ADMIN = {
  id: '01JC0ADMIN000000000000000002',
  nickname: '統括の担当',
};

const PUBLISHED_VERSION_NUMBER = 2;

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });

const respond = ({
  documentFails = false,
}: { readonly documentFails?: boolean } = {}) => {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    if (document === AdminViewerDocument) {
      return Promise.resolve(adminViewerResult(adminWithRole('VIEWER')));
    }
    if (document === AdminLegalDocumentDocument) {
      return documentFails
        ? failure({
            code: 'internal_error',
            message: '処理中に問題が発生しました。',
            status: 500,
          })
        : success({
            adminLegalDocument: {
              kind: 'TERMS',
              stateVersion: 1,
              latestBody: null,
              draft: null,
              revisions: [],
            },
          });
    }
    if (document === AdminLegalDocumentVersionDocument) {
      const { versionNumber } =
        variables as AdminLegalDocumentVersionQueryVariables;
      return success({
        adminLegalDocumentVersion:
          versionNumber === PUBLISHED_VERSION_NUMBER
            ? {
                kind: 'TERMS',
                versionNumber,
                publishedAt: '2026-11-02T03:04:05.000Z',
                changeSummary: '第3条を改めました。',
                body: '# 第1条',
                isLatest: true,
                publishedBy: SUPER_ADMIN,
              }
            : null,
      });
    }
    throw new Error('想定していない操作が実行されました。');
  });
};

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す。loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることを下のテストで確かめる)
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  return [
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: 'legal-documents/$kind/',
        loader: loadAdminLegalDocument,
        component: LegalDocumentEditorRoute.options.component,
      }),
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: 'legal-documents/$kind/revisions/$versionNumber',
        loader: loadAdminLegalDocumentVersion,
        component: LegalDocumentVersionRoute.options.component,
      }),
    ]),
  ];
};

const renderAt = (path: string) =>
  renderPageRouter({
    path,
    createRoutes,
    cachedViewer: adminWithRole('VIEWER'),
  });

beforeEach(() => {
  executeGraphQL.mockReset();
});

test('経路の設定は画面のテストが写したものと同じ読み込みの関数を使う', () => {
  expect(LegalDocumentEditorRoute.options.loader).toBe(loadAdminLegalDocument);
  expect(LegalDocumentVersionRoute.options.loader).toBe(
    loadAdminLegalDocumentVersion,
  );
});

describe('編集の画面の経路', () => {
  test('種類のURLで文書の名前の見出しを表示する', async () => {
    respond();
    await renderAt('/legal-documents/terms');

    await expect.element(pageTitle()).toHaveTextContent('利用規約');
  });

  test('種類の形式違反は存在しないページにする', async () => {
    respond();
    await renderAt('/legal-documents/terms-of-service');

    await expect
      .element(pageTitle())
      .toHaveTextContent('ページが見つかりません。');
  });

  test('取得の失敗はエラーの画面にし、問い合わせの導線を出さない', async () => {
    respond({ documentFails: true });
    await renderAt('/legal-documents/terms');

    await expect
      .element(main().getByRole('button', { name: '再試行' }))
      .toBeVisible();
    expect(main().element().textContent).not.toContain('お問い合わせ');
  });
});

describe('版の表示の経路', () => {
  test('種類と版番号のURLで「<文書の名前>(第N版)」の見出しを表示する', async () => {
    respond();
    await renderAt('/legal-documents/terms/revisions/2');

    await expect.element(pageTitle()).toHaveTextContent('利用規約(第2版)');
  });

  test.each([
    '/legal-documents/terms/revisions/9',
    '/legal-documents/terms/revisions/02',
    '/legal-documents/terms/revisions/abc',
    '/legal-documents/unknown/revisions/2',
  ])('存在しない版と形式違反(%s)は存在しないページにする', async (path) => {
    respond();
    await renderAt(path);

    await expect
      .element(pageTitle())
      .toHaveTextContent('ページが見つかりません。');
  });
});
