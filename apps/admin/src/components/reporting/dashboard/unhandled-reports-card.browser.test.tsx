import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import {
  callsOf,
  failure,
  type GraphQLHandler,
  respondAdminGraphQL,
  success,
} from '../../../../test/admin-accounts-fixtures.ts';
import { adminWithRole } from '../../../../test/admin-viewer-fixtures.ts';
import { respondWeeklyStatistics } from '../../../../test/moderation-statistics-fixtures.ts';
import {
  type PageRootRoute,
  renderPageRouter,
} from '../../../../test/page-router.tsx';
import { reportCasesQueryOf } from '../../../../test/reporting-fixtures.ts';
import {
  type ReportSummaryHandler,
  respondReportSummaries,
  unhandledReportSummaryOf,
} from '../../../../test/reporting-summary-fixtures.ts';
import { DASHBOARD_CARDS } from '../../../composition/dashboard-cards.ts';
import { adminUnhandledReportSummaryQueryOptions } from '../../../graphql/admin-reporting-summaries.ts';
import {
  AdminReportCasesDocument,
  AdminReportCategoriesDocument,
  type AdminRole,
  AdminUnhandledInquiryCountDocument,
  AdminUnhandledReportSummaryDocument,
} from '../../../graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../../../routes/_authenticated/route.tsx';
import { Route as DashboardRoute } from '../../../routes/_authenticated/index.tsx';
import { Route as ReportsRoute } from '../../../routes/_authenticated/reports/index.tsx';
import { loadReportsPage } from '../shared/load-reports-page.ts';
import { toReportSearch } from '../shared/report-search.ts';
import { UnhandledReportsCard } from './unhandled-reports-card.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const CARD_TITLE = '未対応の通報';

const ALL_ROLES: readonly AdminRole[] = Object.freeze([
  'VIEWER',
  'MODERATOR',
  'SUPER_ADMIN',
]);

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: '処理中に問題が発生しました。',
  status: 500,
});

const main = () => page.getByRole('main');
const card = () => main().getByRole('region', { name: CARD_TITLE });
const cardHeading = () =>
  card().getByRole('heading', { level: 2, name: CARD_TITLE });
const cardLink = () => card().getByRole('link', { name: CARD_TITLE });

const summaryCalls = () =>
  callsOf(executeGraphQL, AdminUnhandledReportSummaryDocument);

// アプリの経路と同じログイン必須のレイアウトとダッシュボードと通報の一覧の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
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
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/',
        component: DashboardRoute.options.component,
      }),
      reportsRoute.addChildren([
        createRoute({
          getParentRoute: () => reportsRoute,
          path: '/',
          validateSearch: toReportSearch,
          loaderDeps: ({ search }) => search,
          loader: loadReportsPage,
          component: ReportsRoute.options.component,
        }),
      ]),
    ]),
  ];
};

const renderDashboard = (
  unhandled: ReportSummaryHandler,
  role: AdminRole = 'VIEWER',
) => {
  respondAdminGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, GraphQLHandler>([
      [
        AdminUnhandledInquiryCountDocument,
        () => success({ adminUnhandledInquiryCount: 0 }),
      ],
      [AdminReportCasesDocument, () => success(reportCasesQueryOf([]))],
      [
        AdminReportCategoriesDocument,
        () => success({ adminReportCategories: [] }),
      ],
    ]),
  });
  respondWeeklyStatistics(executeGraphQL);
  respondReportSummaries(executeGraphQL, { unhandled });
  return renderPageRouter({
    path: '/',
    createRoutes,
    cachedViewer: adminWithRole(role),
  });
};

beforeEach(async () => {
  executeGraphQL.mockReset();
  await page.viewport(1280, 800);
});

afterEach(() => {
  applyColorScheme('light');
});

describe('ダッシュボードのカードの登録', () => {
  test('未対応の通報のカードを順序30・半分の幅で登録する', () => {
    expect(DASHBOARD_CARDS).toContainEqual({
      id: 'content-reporting.unhandled-reports',
      order: 30,
      width: 'half',
      component: UnhandledReportsCard,
    });
  });
});

describe('UnhandledReportsCard', () => {
  test('ダッシュボードに、未対応の案件の件数とそのうちの権利侵害の件数を3桁区切りで表示する', async () => {
    await renderDashboard(() => success(unhandledReportSummaryOf(1234, 1001)));

    await expect
      .element(card())
      .toHaveTextContent('1,234件(うち権利侵害1,001件)');
    expect(summaryCalls()).toHaveLength(1);
    expect(summaryCalls()[0]?.[1]).toStrictEqual({});
  });

  test('権利侵害の案件が無くても、内訳を0件と表示する', async () => {
    await renderDashboard(() => success(unhandledReportSummaryOf(3, 0)));

    await expect.element(card()).toHaveTextContent('3件(うち権利侵害0件)');
  });

  test('未対応の案件が0件なら、件数の代わりに未対応の通報が無い旨を表示する', async () => {
    await renderDashboard(() => success(unhandledReportSummaryOf(0, 0)));

    await expect
      .element(card())
      .toHaveTextContent('未対応の通報はありません。');
    expect(card().element().textContent).not.toContain('0件');
  });

  test.each(ALL_ROLES)('%sの管理者にもカードを表示する', async (role) => {
    await renderDashboard(() => success(unhandledReportSummaryOf(2, 1)), role);

    await expect.element(card()).toHaveTextContent('2件(うち権利侵害1件)');
  });

  test('題名のリンクは「未対応」で絞り込んだ通報の一覧へ移る', async () => {
    const router = await renderDashboard(() =>
      success(unhandledReportSummaryOf(3, 1)),
    );
    await expect
      .element(cardLink())
      .toHaveAttribute('href', '/reports?status=OPEN');

    await userEvent.click(cardLink());

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('通報');
    expect(router.state.location.pathname).toBe('/reports');
    expect(router.state.location.search).toEqual({ status: 'OPEN' });
    expect(
      callsOf(executeGraphQL, AdminReportCasesDocument).at(-1)?.[1],
    ).toMatchObject({ filter: { status: 'OPEN' } });
  });

  test('取り直しに失敗したときは、表示中の件数を残し、失敗と再試行を示さない', async () => {
    let failing = false;
    const router = await renderDashboard(() =>
      failing
        ? failure(INTERNAL_ERROR)
        : success(unhandledReportSummaryOf(4, 2)),
    );
    await expect.element(card()).toHaveTextContent('4件(うち権利侵害2件)');
    const { queryClient } = router.options.context;
    const { queryKey } = adminUnhandledReportSummaryQueryOptions();

    failing = true;
    await queryClient.refetchQueries({ queryKey });

    expect(queryClient.getQueryState(queryKey)?.status).toBe('error');
    await expect.element(card()).toHaveTextContent('4件(うち権利侵害2件)');
    expect(card().getByRole('alert').elements()).toHaveLength(0);
    expect(
      card().getByRole('button', { name: '再試行' }).elements(),
    ).toHaveLength(0);
    expect(summaryCalls()).toHaveLength(2);
  });

  test('取得を待つ間は、カードの中に読み込み中を示す', async () => {
    await renderDashboard(() => new Promise<never>(() => undefined));

    await expect
      .element(card().getByRole('status'))
      .toHaveTextContent('読み込み中');
  });

  test('取得の失敗はカードの中だけに問い合わせを促さない文言と再試行で示し、再試行でカードの見出しへフォーカスを移して件数を表示する', async () => {
    let available = false;
    await renderDashboard(() =>
      available
        ? success(unhandledReportSummaryOf(5, 1))
        : failure(INTERNAL_ERROR),
    );

    await expect
      .element(card().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    expect(main().getByRole('alert').elements()).toHaveLength(1);
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('ダッシュボード');
    await expect
      .element(main().getByRole('region', { name: '未対応の問い合わせ' }))
      .toHaveTextContent('0件');
    expect(
      main().getByRole('link', { name: 'お問い合わせ' }).elements(),
    ).toHaveLength(0);
    expect(main().element().textContent).not.toContain('お問い合わせください');

    available = true;
    await userEvent.click(card().getByRole('button', { name: '再試行' }));

    await expect.element(card()).toHaveTextContent('5件(うち権利侵害1件)');
    await expect.element(cardHeading()).toHaveFocus();
    expect(card().getByRole('alert').elements()).toHaveLength(0);
  });

  test('定期の取り直しをせず、画面を表示している間も一度だけ取得する', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      await renderDashboard(() => success(unhandledReportSummaryOf(1, 0)));
      await expect.element(card()).toHaveTextContent('1件(うち権利侵害0件)');

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);

      expect(summaryCalls()).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、件数の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDashboard(() => success(unhandledReportSummaryOf(7, 3)));
      await expect.element(card()).toHaveTextContent('7件(うち権利侵害3件)');

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sの配色で、件数の取得の失敗の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDashboard(() => failure(INTERNAL_ERROR));
      await expect.element(card().getByRole('alert')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
