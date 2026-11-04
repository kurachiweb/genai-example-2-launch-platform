import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';

import {
  loadAdminLegalDocument,
  loadAdminLegalDocuments,
} from '../src/graphql/admin-legal-documents.ts';
import {
  type AdminLegalDocumentsQuery,
  AdminLegalDocumentsDocument,
  type AdminRole,
  AdminViewerDocument,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as LegalDocumentEditorRoute } from '../src/routes/_authenticated/legal-documents/$kind/index.tsx';
import { Route as LegalDocumentsRoute } from '../src/routes/_authenticated/legal-documents/index.tsx';
import { success } from './admin-accounts-fixtures.ts';
import { adminViewerResult, adminWithRole } from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';

export const LEGAL_DOCUMENTS_PATH = '/legal-documents';

export const TERMS_PUBLISHED_AT = '2026-11-02T03:04:05.000Z';

export const LEGAL_NOTICE_PUBLISHED_AT = '2026-10-01T00:00:00.000Z';

// 利用規約は第3版を公開済みで下書きあり、プライバシーポリシーは未公開、法的通知は第1版を公開済みで下書きなし
export const LEGAL_DOCUMENT_SUMMARIES: AdminLegalDocumentsQuery = Object.freeze(
  {
    adminLegalDocuments: [
      {
        kind: 'TERMS',
        latestVersionNumber: 3,
        latestPublishedAt: TERMS_PUBLISHED_AT,
        hasDraft: true,
      },
      {
        kind: 'PRIVACY',
        latestVersionNumber: null,
        latestPublishedAt: null,
        hasDraft: false,
      },
      {
        kind: 'LEGAL_NOTICE',
        latestVersionNumber: 1,
        latestPublishedAt: LEGAL_NOTICE_PUBLISHED_AT,
        hasDraft: false,
      },
    ],
  },
);

export type LegalDocumentsHandler = () => Promise<unknown>;

// ログイン中の管理者の取得に既定の応答を返し、法務文書の一覧の取得はテストが渡した応答にする
export function respondLegalDocumentsGraphQL(
  executeGraphQL: Mock,
  {
    role,
    legalDocuments = () => success(LEGAL_DOCUMENT_SUMMARIES),
  }: {
    readonly role: AdminRole;
    readonly legalDocuments?: LegalDocumentsHandler;
  },
): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === AdminLegalDocumentsDocument) {
      return legalDocuments();
    }
    if (document === AdminViewerDocument) {
      return Promise.resolve(adminViewerResult(adminWithRole(role)));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す。経路の設定のloaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const legalDocumentsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'legal-documents',
  });
  return [
    authenticatedRoute.addChildren([
      legalDocumentsRoute.addChildren([
        createRoute({
          getParentRoute: () => legalDocumentsRoute,
          path: '/',
          loader: loadAdminLegalDocuments,
          component: LegalDocumentsRoute.options.component,
        }),
      ]),
    ]),
  ];
};

export const renderLegalDocumentsPage = (role: AdminRole) =>
  renderPageRouter({
    path: LEGAL_DOCUMENTS_PATH,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });

const createEditorRoutes = (rootRoute: PageRootRoute) => {
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
    ]),
  ];
};

export const renderLegalDocumentEditorPage = (role: AdminRole, path: string) =>
  renderPageRouter({
    path,
    createRoutes: createEditorRoutes,
    cachedViewer: adminWithRole(role),
  });
