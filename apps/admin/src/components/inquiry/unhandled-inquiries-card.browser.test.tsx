import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  inquiriesVariablesOf,
  respondAdminInquiriesGraphQL,
  type UnhandledCountHandler,
} from '../../../test/admin-inquiries-fixtures.ts';
import { adminWithRole } from '../../../test/admin-viewer-fixtures.ts';
import {
  type PageRootRoute,
  renderPageRouter,
} from '../../../test/page-router.tsx';
import { DASHBOARD_CARDS } from '../../composition/dashboard-cards.ts';
import {
  adminUnhandledInquiryCountQueryOptions,
  loadAdminInquiriesPage,
} from '../../graphql/admin-inquiries.ts';
import { AdminUnhandledInquiryCountDocument } from '../../graphql/generated/graphql.ts';
import { Route as AuthenticatedRoute } from '../../routes/_authenticated/route.tsx';
import { Route as DashboardRoute } from '../../routes/_authenticated/index.tsx';
import { Route as InquiriesRoute } from '../../routes/_authenticated/inquiries/index.tsx';
import { toAdminInquirySearch } from './admin-inquiry-search.ts';
import { UnhandledInquiriesCard } from './unhandled-inquiries-card.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const CARD_TITLE = '未対応の問い合わせ';

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

const countCallsOf = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === AdminUnhandledInquiryCountDocument,
  );

// アプリの経路と同じログイン必須のレイアウトとダッシュボードと問い合わせの一覧の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  const inquiriesRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'inquiries',
  });
  return [
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: '/',
        component: DashboardRoute.options.component,
      }),
      inquiriesRoute.addChildren([
        createRoute({
          getParentRoute: () => inquiriesRoute,
          path: '/',
          validateSearch: toAdminInquirySearch,
          loaderDeps: ({ search }) => search,
          loader: loadAdminInquiriesPage,
          component: InquiriesRoute.options.component,
        }),
      ]),
    ]),
  ];
};

const renderDashboard = (unhandledCount: UnhandledCountHandler) => {
  respondAdminInquiriesGraphQL(executeGraphQL, {
    role: 'VIEWER',
    unhandledCount,
  });
  return renderPageRouter({
    path: '/',
    createRoutes,
    cachedViewer: adminWithRole('VIEWER'),
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
  test('未対応の問い合わせのカードを順序20・半分の幅で登録する', () => {
    expect(DASHBOARD_CARDS).toStrictEqual([
      {
        id: 'inquiry-chat.unhandled-inquiries',
        order: 20,
        width: 'half',
        component: UnhandledInquiriesCard,
      },
    ]);
    expect(Object.isFrozen(DASHBOARD_CARDS)).toBe(true);
  });
});

describe('UnhandledInquiriesCard', () => {
  test('ダッシュボードに、未対応の問い合わせの件数を閲覧者の地域の数の書式で表示する', async () => {
    await renderDashboard(() => success({ adminUnhandledInquiryCount: 1234 }));

    await expect.element(card()).toHaveTextContent('1,234件');
    expect(countCallsOf()).toHaveLength(1);
  });

  test('未対応が0件でも、件数を0件と表示する', async () => {
    await renderDashboard(() => success({ adminUnhandledInquiryCount: 0 }));

    await expect.element(card()).toHaveTextContent('0件');
  });

  test('題名のリンクは「未対応」で絞り込んだ問い合わせの一覧へ移る', async () => {
    const router = await renderDashboard(() =>
      success({ adminUnhandledInquiryCount: 3 }),
    );
    await expect
      .element(cardLink())
      .toHaveAttribute('href', '/inquiries?status=OPEN');

    await userEvent.click(cardLink());

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('問い合わせ');
    expect(router.state.location.pathname).toBe('/inquiries');
    expect(router.state.location.search).toEqual({ status: 'OPEN' });
    await expect
      .element(main().getByRole('combobox', { name: '対応ステータス' }))
      .toHaveTextContent('未対応');
    expect(inquiriesVariablesOf(executeGraphQL).at(-1)).toStrictEqual({
      filter: { status: 'OPEN' },
    });
  });

  test('取り直しに失敗したときは、表示中の件数を残し、失敗と再試行を示さない', async () => {
    let failing = false;
    const router = await renderDashboard(() =>
      failing
        ? failure(INTERNAL_ERROR)
        : success({ adminUnhandledInquiryCount: 4 }),
    );
    await expect.element(card()).toHaveTextContent('4件');
    const { queryClient } = router.options.context;
    const { queryKey } = adminUnhandledInquiryCountQueryOptions();

    failing = true;
    await queryClient.refetchQueries({ queryKey });

    expect(queryClient.getQueryState(queryKey)?.status).toBe('error');
    await expect.element(card()).toHaveTextContent('4件');
    expect(card().getByRole('alert').elements()).toHaveLength(0);
    expect(
      card().getByRole('button', { name: '再試行' }).elements(),
    ).toHaveLength(0);
    expect(countCallsOf()).toHaveLength(2);
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
        ? success({ adminUnhandledInquiryCount: 5 })
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
      .element(page.getByRole('navigation', { name: '管理メニュー' }))
      .toBeVisible();
    expect(
      main().getByRole('link', { name: 'お問い合わせ' }).elements(),
    ).toHaveLength(0);
    expect(main().element().textContent).not.toContain('お問い合わせください');

    available = true;
    await userEvent.click(card().getByRole('button', { name: '再試行' }));

    await expect.element(card()).toHaveTextContent('5件');
    await expect.element(cardHeading()).toHaveFocus();
    expect(card().getByRole('alert').elements()).toHaveLength(0);
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、件数の表示がWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDashboard(() => success({ adminUnhandledInquiryCount: 7 }));
      await expect.element(card()).toHaveTextContent('7件');

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
