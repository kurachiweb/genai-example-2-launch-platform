import { createRoute } from '@tanstack/react-router';
import type { Mock } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { loadReportsPage } from '../src/components/reporting/shared/load-reports-page.ts';
import {
  AdminReportCasesDocument,
  type AdminReportCasesQueryVariables,
  AdminReportCategoriesDocument,
  type AdminReportCategoriesQuery,
  type AdminReportCaseSummaryFragment,
  type AdminRole,
} from '../src/graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as ReportsRoute } from '../src/routes/_authenticated/reports/index.tsx';
import { success } from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';
import {
  REPORT_COMMENT_ID,
  REPORT_PRODUCT_ID,
  REPORT_USER_ID,
  reportCaseNodeOf,
  reportCasesQueryOf,
  type ReportingGraphQLHandler,
  respondReportingGraphQL,
} from './reporting-fixtures.ts';

export const REPORTS_PATH = '/reports';

export const REPORT_CASE_DETAIL_STUB_HEADING = '案件の詳細のページ';

export const INFRINGEMENT_CATEGORY_ID = '01JE0000000000000000000001';

export const OTHER_CATEGORY_ID = '01JE0000000000000000000002';

export const SPAM_CATEGORY_ID = '01JE0000000000000000000003';

export const PRODUCT_CASE_NODE: AdminReportCaseSummaryFragment =
  Object.freeze(reportCaseNodeOf());

export const USER_CASE_NODE: AdminReportCaseSummaryFragment = Object.freeze(
  reportCaseNodeOf({
    id: '01KA0REP0RTCASE00000000002',
    target: {
      kind: 'USER',
      id: REPORT_USER_ID,
      detached: false,
      available: true,
      handle: 'maker_ai',
      label: 'サンプル太郎',
      excerpt: null,
      productId: null,
      productName: null,
      productHandle: null,
    },
    status: 'IN_PROGRESS',
    reportCount: 1234,
    categoryCounts: [
      { categoryId: SPAM_CATEGORY_ID, name: 'スパム', count: 1234 },
    ],
    firstReportedAt: '2026-10-20T00:00:00.000Z',
    lastReportedAt: '2026-11-01T15:30:00.000Z',
    infringement: false,
    responseTime: null,
  }),
);

export const COMMENT_CASE_NODE: AdminReportCaseSummaryFragment = Object.freeze(
  reportCaseNodeOf({
    id: '01KA0REP0RTCASE00000000003',
    target: {
      kind: 'COMMENT',
      id: REPORT_COMMENT_ID,
      detached: false,
      available: true,
      handle: null,
      label: null,
      excerpt: '**強調**のつもりの<b>文字列</b>\n2行目',
      productId: REPORT_PRODUCT_ID,
      productName: 'Pitch Notes',
      productHandle: 'pitch-notes',
    },
    reportCount: 1,
    categoryCounts: [
      { categoryId: SPAM_CATEGORY_ID, name: 'スパム', count: 1 },
    ],
    infringement: false,
    responseTime: null,
  }),
);

export const UNAVAILABLE_CASE_NODE: AdminReportCaseSummaryFragment =
  Object.freeze(
    reportCaseNodeOf({
      id: '01KA0REP0RTCASE00000000004',
      target: {
        kind: 'PRODUCT',
        id: '01KA0PR0DVCT00000000000002',
        detached: false,
        available: false,
        handle: null,
        label: null,
        excerpt: null,
        productId: null,
        productName: null,
        productHandle: null,
      },
      reportCount: 1,
      categoryCounts: [
        { categoryId: OTHER_CATEGORY_ID, name: 'その他', count: 1 },
      ],
      infringement: false,
      responseTime: null,
    }),
  );

export const DETACHED_CASE_NODE: AdminReportCaseSummaryFragment = Object.freeze(
  reportCaseNodeOf({
    id: '01KA0REP0RTCASE00000000005',
    target: {
      kind: 'COMMENT',
      id: null,
      detached: true,
      available: false,
      handle: null,
      label: null,
      excerpt: null,
      productId: null,
      productName: null,
      productHandle: null,
    },
    status: 'RESOLVED',
    reportCount: 2,
    categoryCounts: [
      { categoryId: INFRINGEMENT_CATEGORY_ID, name: '権利侵害', count: 2 },
    ],
    responseTime: {
      startedAt: '2026-10-01T00:00:00.000Z',
      completedAt: '2026-10-11T04:00:00.000Z',
      elapsedSeconds: (10 * 24 + 4) * 60 * 60,
      alerts: ['DECISION_OVERDUE'],
    },
  }),
);

export const REPORT_CASE_NODES: readonly AdminReportCaseSummaryFragment[] =
  Object.freeze([
    PRODUCT_CASE_NODE,
    USER_CASE_NODE,
    COMMENT_CASE_NODE,
    UNAVAILABLE_CASE_NODE,
    DETACHED_CASE_NODE,
  ]);

const REPORT_CATEGORIES_QUERY: AdminReportCategoriesQuery = Object.freeze({
  adminReportCategories: [
    {
      id: INFRINGEMENT_CATEGORY_ID,
      name: '権利侵害',
      systemDefault: true,
      infringement: true,
      reportCount: 4,
    },
    {
      id: SPAM_CATEGORY_ID,
      name: 'スパム',
      systemDefault: false,
      infringement: false,
      reportCount: 1235,
    },
    {
      id: OTHER_CATEGORY_ID,
      name: 'その他',
      systemDefault: true,
      infringement: false,
      reportCount: 2,
    },
  ],
});

export const reportCasesPageOf = (
  nodes: readonly AdminReportCaseSummaryFragment[],
  endCursor: string | null = null,
) => ({
  adminReportCases: {
    ...reportCasesQueryOf(nodes).adminReportCases,
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
  },
});

export type ReportCasesHandler = (
  variables: AdminReportCasesQueryVariables,
) => Promise<unknown>;

export interface ReportsPageRenderOptions {
  readonly role?: AdminRole;
  readonly cases?: ReportCasesHandler;
  readonly categories?: () => Promise<unknown>;
  readonly handlers?: ReadonlyMap<unknown, ReportingGraphQLHandler>;
  readonly path?: string;
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す。検索パラメータの検証・loaderの依存・loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す(同じ関数であることは画面のテストが確かめる)。詳細のページは一覧からの移動だけを確かめるため、見出しだけの部品にする
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const reportsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'reports',
  });
  return [
    authenticatedRoute.addChildren([
      reportsRoute.addChildren([
        createRoute({
          getParentRoute: () => reportsRoute,
          path: '/',
          validateSearch: ReportsRoute.options.validateSearch,
          loaderDeps: ({ search }) => search,
          loader: loadReportsPage,
          component: ReportsRoute.options.component,
        }),
        createRoute({
          getParentRoute: () => reportsRoute,
          path: '$caseId',
          component: () => <h1>{REPORT_CASE_DETAIL_STUB_HEADING}</h1>,
        }),
      ]),
    ]),
  ];
};

export const reportCasesVariablesOf = (
  executeGraphQL: Mock,
): readonly AdminReportCasesQueryVariables[] =>
  executeGraphQL.mock.calls
    .filter(([document]) => document === AdminReportCasesDocument)
    .map(([, variables]) => variables as AdminReportCasesQueryVariables);

// テストのファイルごとに差し替えたGraphQLの実行で、通報の一覧のページを描き、送った一覧の条件を読む。操作の結果のトーストは文書の外枠が置くため、ページのルーターの外に置く
export const reportsPageHarness = (executeGraphQL: Mock) => ({
  renderWith: async ({
    role = 'VIEWER',
    cases = () => success(reportCasesPageOf(REPORT_CASE_NODES)),
    categories = () => success(REPORT_CATEGORIES_QUERY),
    handlers = new Map(),
    path = REPORTS_PATH,
  }: ReportsPageRenderOptions = {}) => {
    respondReportingGraphQL(executeGraphQL, {
      role,
      handlers: new Map<unknown, ReportingGraphQLHandler>([
        [
          AdminReportCasesDocument,
          (variables) => cases(variables as AdminReportCasesQueryVariables),
        ],
        [AdminReportCategoriesDocument, categories],
        ...handlers,
      ]),
    });
    await render(<Toaster />);
    return renderPageRouter({
      path,
      createRoutes,
      cachedViewer: adminWithRole(role),
    });
  },
  lastVariables: () => reportCasesVariablesOf(executeGraphQL).at(-1),
});

export const main = () => page.getByRole('main');
export const table = () => main().getByRole('table', { name: '通報の案件' });
export const listHeading = () =>
  main().getByRole('heading', { level: 2, name: '通報の案件' });
export const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
export const filterForm = () =>
  main().getByRole('search', { name: '絞り込み' });
export const filterSelect = (name: string) =>
  filterForm().getByRole('combobox', { name, exact: true });
export const dateField = (name: string) =>
  filterForm().getByLabelText(name, { exact: true });
export const applyButton = () =>
  filterForm().getByRole('button', { name: '適用', exact: true });
export const resetButton = () =>
  filterForm().getByRole('button', { name: '解除', exact: true });
export const pagination = () =>
  main().getByRole('navigation', { name: 'ページ送り' });
export const nextButton = () =>
  pagination().getByRole('button', { name: '次へ' });
export const previousButton = () =>
  pagination().getByRole('button', { name: '前へ' });
export const actionButton = (name: string) =>
  table().getByRole('button', { name, exact: true });
export const dialog = () => page.getByRole('dialog');
export const reasonBox = () =>
  dialog().getByRole('textbox', { name: '理由(必須)', exact: true });

export const cellTexts = (text: string) =>
  [...rowOf(text).element().querySelectorAll('td')].map(
    (cell) => cell.textContent,
  );

export async function chooseOption(
  selectName: string,
  optionName: string,
): Promise<void> {
  await userEvent.click(filterSelect(selectName));
  await userEvent.click(
    page.getByRole('option', { name: optionName, exact: true }),
  );
}

export const optionNamesOf = async (
  selectName: string,
): Promise<readonly (string | null)[]> => {
  await userEvent.click(filterSelect(selectName));
  const names = page
    .getByRole('option')
    .elements()
    .map((option) => option.textContent);
  await userEvent.keyboard('{Escape}');
  return names;
};
