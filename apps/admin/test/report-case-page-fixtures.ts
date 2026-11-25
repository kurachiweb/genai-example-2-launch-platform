import { createRoute } from '@tanstack/react-router';
import { createElement } from 'react';
import type { Mock } from 'vitest';
import { render } from 'vitest-browser-react';

import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { loadReportCasePage } from '../src/graphql/admin-reporting-cases.ts';
import {
  AdminReportCaseDocument,
  type AdminReportCaseQuery,
  type AdminReportCaseSummaryFragment,
  type AdminRole,
} from '../src/graphql/generated/graphql.ts';
import { Route as ReportCaseRoute } from '../src/routes/_authenticated/reports/$caseId.tsx';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { success } from './admin-accounts-fixtures.ts';
import { adminWithRole } from './admin-viewer-fixtures.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';
import {
  REPORT_CASE_ID,
  reportCaseNodeOf,
  type ReportingGraphQLHandler,
  respondReportingGraphQL,
} from './reporting-fixtures.ts';

export const REPORT_CASE_PATH = `/reports/${REPORT_CASE_ID}`;

export type ReportCaseDetailData = NonNullable<
  AdminReportCaseQuery['adminReportCase']
>;

type ReportData = ReportCaseDetailData['reports'][number];

export const MEMBER_REPORT: ReportData = Object.freeze({
  id: '01KA0REP0RT000000000000001',
  categoryName: '権利侵害',
  reason: '**無断転載**の<b>画像</b>です\n2行目',
  reportedAt: '2026-11-01T00:00:00.000Z',
  reporter: {
    kind: 'member',
    nickname: '通報花子',
    handle: 'hanako',
    hasContact: false,
  },
});

export const GUEST_REPORT_WITH_CONTACT: ReportData = Object.freeze({
  id: '01KA0REP0RT000000000000002',
  categoryName: '権利侵害',
  reason: '権利者として申し出ます',
  reportedAt: '2026-11-01T12:00:00.000Z',
  reporter: { kind: 'guest', nickname: null, handle: null, hasContact: true },
});

export const GUEST_REPORT_WITHOUT_CONTACT: ReportData = Object.freeze({
  id: '01KA0REP0RT000000000000003',
  categoryName: 'その他',
  reason: '気になる内容です',
  reportedAt: '2026-11-02T03:00:00.000Z',
  reporter: { kind: 'guest', nickname: null, handle: null, hasContact: false },
});

export interface ReportCaseDetailPatch extends Partial<
  Omit<ReportCaseDetailData, 'case'>
> {
  readonly case?: Partial<AdminReportCaseSummaryFragment>;
}

export const reportCaseDetailOf = ({
  case: casePatch = {},
  ...patch
}: ReportCaseDetailPatch = {}): ReportCaseDetailData => ({
  case: reportCaseNodeOf(casePatch),
  statusChangedAt: '2026-11-02T04:00:00.000Z',
  resolution: null,
  closingReason: null,
  closedAt: null,
  lastInquiry: null,
  inquiryAvailable: false,
  reports: [
    MEMBER_REPORT,
    GUEST_REPORT_WITH_CONTACT,
    GUEST_REPORT_WITHOUT_CONTACT,
  ],
  ...patch,
});

export const IN_PROGRESS_INFRINGEMENT_DETAIL = reportCaseDetailOf({
  case: { status: 'IN_PROGRESS' },
  inquiryAvailable: true,
});

export interface ReportCaseDetailStore {
  // 次の詳細の照会から返す案件を替える
  readonly replace: (detail: ReportCaseDetailData | null) => void;
  readonly detailRequests: () => number;
}

// 詳細の照会に差し替えられる案件を返し、操作はテストが渡した応答にする
export function respondReportCaseGraphQL(
  executeGraphQL: Mock,
  {
    role,
    detail,
    handlers = new Map(),
  }: {
    readonly role: AdminRole;
    readonly detail: ReportCaseDetailData | null;
    readonly handlers?: ReadonlyMap<unknown, ReportingGraphQLHandler>;
  },
): ReportCaseDetailStore {
  let current = detail;
  let requests = 0;
  respondReportingGraphQL(executeGraphQL, {
    role,
    handlers: new Map([
      [
        AdminReportCaseDocument,
        () => {
          requests += 1;
          return success({ adminReportCase: current });
        },
      ],
      ...handlers,
    ]),
  });
  return {
    replace: (next) => {
      current = next;
    },
    detailRequests: () => requests,
  };
}

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置(同じ経路のID)の経路へ写す。loaderは型がアプリの経路の木に結び付き写せないため、同じ関数を渡す
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
          path: '$caseId',
          loader: loadReportCasePage,
          component: ReportCaseRoute.options.component,
          notFoundComponent: ReportCaseRoute.options.notFoundComponent,
        }),
      ]),
    ]),
  ];
};

// 操作の結果のトーストを確かめられるよう、通知の置き場所も描く
export async function renderReportCasePage(
  role: AdminRole,
  path = REPORT_CASE_PATH,
) {
  await render(createElement(Toaster));
  return renderPageRouter({
    path,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });
}
