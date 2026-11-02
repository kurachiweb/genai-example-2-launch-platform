import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { resetTurnstileScriptFailure } from '../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import { redirectToFirstSettings } from '../src/components/settings/redirect-to-first-settings.ts';
import {
  ClientMySessionsDocument,
  type ClientViewerQuery,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as AccountSettingsRoute } from '../src/routes/_authenticated/settings/account.tsx';
import { Route as SettingsRoute } from '../src/routes/_authenticated/settings/route.tsx';
import { Route as SecuritySettingsRoute } from '../src/routes/_authenticated/settings/security.tsx';
import {
  CURRENT_SESSION,
  mySessionsQuery,
  mySessionsResult,
} from './security-fixtures.tsx';
import {
  loadMySessions,
  mySessionsQueryOptions,
} from '../src/components/settings/my-sessions-query.ts';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery, VIEWER_NICKNAME } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

const pageTitle = () =>
  page.getByRole('main').getByRole('heading', { level: 1 });
const settingsNavigation = () => page.getByRole('navigation', { name: '設定' });

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
      path: '/',
      component: () => <h1>トップページ</h1>,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/auth/login',
      component: () => <h1>ログイン</h1>,
    }),
    authenticatedRoute.addChildren([
      settingsRoute.addChildren([
        createRoute({
          getParentRoute: () => settingsRoute,
          path: '/',
          beforeLoad: redirectToFirstSettings,
        }),
        createRoute({
          getParentRoute: () => settingsRoute,
          path: 'account',
          component: AccountSettingsRoute.options.component,
        }),
        createRoute({
          getParentRoute: () => settingsRoute,
          path: 'security',
          loader: loadMySessions,
          component: SecuritySettingsRoute.options.component,
        }),
      ]),
    ]),
  ];
};

const PREVIOUS_VIEWER_ID = '01JC0PREVIOUSVIEWER00000000';

const renderAt = (path: string, cachedViewer?: ClientViewerQuery) =>
  renderPageRouter({
    path,
    createRoutes,
    ...(cachedViewer === undefined ? {} : { cachedViewer }),
  });

type PageHead = ReturnType<typeof buildSitePageHead>;

const WIDE_VIEWPORT = { width: 1280, height: 800 } as const;

beforeEach(async () => {
  await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('設定ページの経路', () => {
  test('設定の入口は、最初の項目のアカウントの設定ページへ移す', async () => {
    const router = await renderAt('/settings', signedInViewerQuery());

    await expect.element(pageTitle()).toHaveTextContent('アカウント');
    expect(router.state.location.pathname).toBe('/settings/account');
  });

  test('アカウントの設定ページを、設定のナビゲーションの中に描き、現在の項目を示す', async () => {
    await renderAt('/settings/account', signedInViewerQuery());

    await expect.element(pageTitle()).toHaveTextContent('アカウント');
    await expect
      .element(settingsNavigation().getByRole('link', { name: 'アカウント' }))
      .toHaveAttribute('aria-current', 'page');
    await expect
      .element(settingsNavigation().getByRole('link', { name: 'セキュリティ' }))
      .toHaveAttribute('href', '/settings/security');
  });

  test('ログイン中の利用者の状態で、停止中の案内を描く', async () => {
    await renderAt(
      '/settings/account',
      signedInViewerQuery({ status: 'SUSPENDED' }),
    );

    await expect
      .element(page.getByRole('note', { name: '停止中のアカウント' }))
      .toBeVisible();
  });

  test.each(['/settings', '/settings/account'])(
    '未ログインで%sを開くと、戻り先を付けてログイン画面へ移す',
    async (path) => {
      const router = await renderAt(path);

      await expect.element(pageTitle()).toHaveTextContent('ログイン');
      expect(router.state.location.search).toEqual({ redirect: path });
    },
  );

  test('ユーザーメニューの「設定」から、アカウントの設定ページへ移る', async () => {
    const router = await renderAt('/', signedInViewerQuery());

    await userEvent.click(
      page
        .getByRole('banner')
        .getByRole('button', { name: `${VIEWER_NICKNAME}のユーザーメニュー` }),
    );
    await userEvent.click(page.getByRole('menuitem', { name: '設定' }));

    await expect.element(pageTitle()).toHaveTextContent('アカウント');
    expect(router.state.location.pathname).toBe('/settings/account');
  });

  test('同じタブに前の利用者のログイン中の端末の取得結果が残っていても、ログイン中の利用者の取得結果だけを示す', async () => {
    executeGraphQL.mockImplementation((document: unknown) => {
      if (document === ClientMySessionsDocument) {
        return Promise.resolve(mySessionsResult());
      }
      throw new Error('想定していない操作が実行されました。');
    });
    const context = createPageRouterContext('local');
    context.queryClient.setQueryData(
      mySessionsQueryOptions(PREVIOUS_VIEWER_ID).queryKey,
      mySessionsQuery({
        sessions: [CURRENT_SESSION],
        totpEnabled: true,
        remainingRecoveryCodes: 2,
      }),
    );

    await renderPageRouter({
      path: '/settings/security',
      createRoutes,
      context,
      cachedViewer: signedInViewerQuery(),
    });

    await expect
      .element(page.getByRole('region', { name: 'ログイン中の端末' }))
      .toHaveTextContent('3台の端末でログインしています。');
    await expect
      .element(page.getByText('多要素認証は無効です。'))
      .toBeVisible();
    expect(
      page.getByRole('region', { name: 'リカバリコード' }).elements(),
    ).toHaveLength(0);
  });

  test('セキュリティの設定ページを、ログイン中の端末を取得してから設定のナビゲーションの中に描き、現在の項目を示す', async () => {
    executeGraphQL.mockImplementation((document: unknown) => {
      if (document === ClientMySessionsDocument) {
        return Promise.resolve(mySessionsResult());
      }
      throw new Error('想定していない操作が実行されました。');
    });
    await renderAt('/settings/security', signedInViewerQuery());

    await expect.element(pageTitle()).toHaveTextContent('セキュリティ');
    await expect
      .element(settingsNavigation().getByRole('link', { name: 'セキュリティ' }))
      .toHaveAttribute('aria-current', 'page');
    await expect
      .element(page.getByRole('region', { name: 'ログイン中の端末' }))
      .toHaveTextContent('3台の端末でログインしています。');
  });

  test('セキュリティの設定ページのタイトルは「セキュリティ」で、検索エンジンに登録させない', () => {
    const head = SecuritySettingsRoute.options.head as
      (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: 'セキュリティ | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  test('アカウントの設定ページのタイトルは「アカウント」で、検索エンジンに登録させない', () => {
    const head = AccountSettingsRoute.options.head as
      (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: 'アカウント | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('アカウントの設定ページの本文で、アクセシビリティの検査の違反が0件', async () => {
      await renderAt('/settings/account', signedInViewerQuery());
      await expect.element(pageTitle()).toBeVisible();

      expect(await runAxe(page.getByRole('main').element())).toStrictEqual([]);
    });
  });
});
