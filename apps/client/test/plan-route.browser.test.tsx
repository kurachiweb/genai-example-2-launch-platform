import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import {
  ClientUltrasOfferDocument,
  type ClientUltrasOfferQuery,
  ClientViewerUltrasDocument,
  type ClientViewerUltrasQuery,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as PlanSettingsRoute } from '../src/routes/_authenticated/settings/plan.tsx';
import { Route as SettingsRoute } from '../src/routes/_authenticated/settings/route.tsx';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const PLAN_PATH = '/settings/plan';

const RETURNED_PATH = `${PLAN_PATH}?portal=returned`;

const OPENED_PATH = `${PLAN_PATH}?portal=opened`;

const PAGE_TITLE = 'プラン';

const SECTION_TITLE = 'Ultrasの加入状態';

const PORTAL_BUTTON_LABEL = '解約・支払い方法の管理';

const PENDING_MESSAGE = '変更を反映しています。';

const OFFER: ClientUltrasOfferQuery = {
  ultrasOffer: {
    price: { amount: 999, currency: 'usd' },
    priceStale: false,
    promotionEnabled: true,
  },
};

const ACTIVE_ULTRAS: ClientViewerUltrasQuery = {
  viewerUltras: {
    entitled: true,
    canOpenPortal: true,
    plan: {
      status: 'ACTIVE',
      startedAt: '2026-11-01T00:00:00.000Z',
      currentPeriodEndsAt: '2026-12-01T00:00:00.000Z',
      canceledAt: null,
      benefitEndsAt: null,
    },
  },
};

type PageHead = ReturnType<typeof buildSitePageHead>;

// 文書ごとに結果を返し分け、ページの文脈に無い文書の取得は失敗にして取りこぼしを見逃さない
const respond = () => {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientUltrasOfferDocument) {
      return Promise.resolve({ ok: true, data: OFFER });
    }
    if (document === ClientViewerUltrasDocument) {
      return Promise.resolve({ ok: true, data: ACTIVE_ULTRAS });
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
};

const callsOf = (target: unknown) =>
  executeGraphQL.mock.calls.filter(([document]) => document === target);

// アプリの経路と同じ判定・レイアウト・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じIDの経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => authenticatedRoute,
    path: 'settings',
    component: SettingsRoute.options.component,
  });
  return [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/login',
      component: () => <h1>ログイン</h1>,
    }),
    authenticatedRoute.addChildren([
      settingsRoute.addChildren([
        createRoute({
          getParentRoute: () => settingsRoute,
          path: 'plan',
          validateSearch: PlanSettingsRoute.options.validateSearch,
          loader: PlanSettingsRoute.options.loader,
          component: PlanSettingsRoute.options.component,
        } as Parameters<typeof createRoute>[0]),
      ]),
    ]),
  ];
};

const renderPlan = ({
  path = PLAN_PATH,
  signedIn = true,
}: {
  readonly path?: string;
  readonly signedIn?: boolean;
} = {}) =>
  renderPageRouter({
    path,
    createRoutes,
    context: createPageRouterContext('local'),
    ...(signedIn ? { cachedViewer: signedInViewerQuery() } : {}),
  });

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const statusSection = () => main().getByRole('region', { name: SECTION_TITLE });
const portalButton = () =>
  main().getByRole('button', { name: PORTAL_BUTTON_LABEL });
const pendingNotice = () => main().getByText(PENDING_MESSAGE, { exact: true });
const settingsNavigation = () => page.getByRole('navigation', { name: '設定' });

beforeEach(() => {
  executeGraphQL.mockReset();
  respond();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('プラン管理画面の経路', () => {
  test('未ログインでは、プラン管理画面のパスを戻り先にしたログイン画面へ移し、価格と加入状態を取得しない', async () => {
    const router = await renderPlan({ signedIn: false });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({ redirect: PLAN_PATH });
    expect(callsOf(ClientViewerUltrasDocument)).toHaveLength(0);
    expect(callsOf(ClientUltrasOfferDocument)).toHaveLength(0);
  });

  test('設定のナビゲーションの中に題名「プラン」と加入状態の区画とPortalのボタンを描き、「プラン」を現在の項目として示す', async () => {
    await renderPlan();

    await expect.element(pageTitle()).toHaveTextContent(PAGE_TITLE);
    await expect.element(statusSection()).toBeVisible();
    await expect.element(portalButton()).toBeEnabled();
    await expect
      .element(settingsNavigation().getByRole('link', { name: PAGE_TITLE }))
      .toHaveAttribute('aria-current', 'page');
    expect(callsOf(ClientViewerUltrasDocument)).toHaveLength(1);
    expect(callsOf(ClientUltrasOfferDocument)).toHaveLength(1);
  });

  test('Customer Portalから戻った印の付いたパスで開くと、反映待ちの状態の文を示す', async () => {
    await renderPlan({ path: RETURNED_PATH });

    await expect.element(statusSection()).toBeVisible();
    await expect.element(pendingNotice()).toHaveAttribute('role', 'status');
  });

  test.each([
    ['印が無い', PLAN_PATH],
    ['戻った印でない値の', OPENED_PATH],
  ])('%sパスで開くと、反映待ちの状態の文を示さない', async (_label, path) => {
    await renderPlan({ path });

    await expect.element(statusSection()).toBeVisible();
    expect(pendingNotice().query()).toBeNull();
  });

  test('プラン管理画面のページのタイトルは「プラン」で、検索エンジンに登録させない', () => {
    const head = PlanSettingsRoute.options.head as (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: 'プラン | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('反映待ちと加入状態とPortalのボタンの表示で、アクセシビリティの検査の違反が0件', async () => {
      await renderPlan({ path: RETURNED_PATH });
      await expect.element(pendingNotice()).toBeVisible();
      await expect.element(portalButton()).toBeEnabled();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
