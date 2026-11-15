import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import { resetTurnstileScriptFailure } from '../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import { Route as EmailChangeConfirmRoute } from '../src/routes/auth/email-change/confirm.tsx';
import { Route as PasswordChangeConfirmRoute } from '../src/routes/auth/password-change/confirm.tsx';
import { Route as PasswordResetConfirmRoute } from '../src/routes/auth/password-reset/confirm.tsx';
import { Route as PasswordResetRoute } from '../src/routes/auth/password-reset/index.tsx';
import { Route as VerifyEmailRoute } from '../src/routes/auth/verify-email.tsx';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

const TOKEN = ['route', 'link', 'value'].join('_');

const pageTitle = () =>
  page.getByRole('main').getByRole('heading', { level: 1 });

const LINK_ROUTES = [
  ['/auth/verify-email', VerifyEmailRoute],
  ['/auth/password-reset', PasswordResetRoute],
  ['/auth/password-reset/confirm', PasswordResetConfirmRoute],
  ['/auth/email-change/confirm', EmailChangeConfirmRoute],
  ['/auth/password-change/confirm', PasswordChangeConfirmRoute],
] as const;

const LINK_PATHS = LINK_ROUTES.map(([path]) => path);

const TOKEN_LINK_PATHS = LINK_PATHS.filter(
  (path) => path !== '/auth/password-reset',
);

type PageHead = ReturnType<typeof buildSitePageHead>;

// 各経路のheadは経路の文脈を読まずに組み立てるため、文脈を渡さずに呼んで値を確かめる
const headOf = (path: string): PageHead => {
  const route = LINK_ROUTES.find(([routePath]) => routePath === path)?.[1];
  const head = route?.options.head as (() => PageHead) | undefined;
  if (head === undefined) {
    throw new Error(`${path}の経路にheadがありません。`);
  }
  return head();
};

// アプリの経路と同じ画面とheadを通すため、本物の経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => [
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/verify-email',
    component: VerifyEmailRoute.options.component,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/password-reset',
    component: PasswordResetRoute.options.component,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/password-reset/confirm',
    component: PasswordResetConfirmRoute.options.component,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/email-change/confirm',
    component: EmailChangeConfirmRoute.options.component,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/password-change/confirm',
    component: PasswordChangeConfirmRoute.options.component,
  }),
];

const renderAt = (path: string) =>
  renderPageRouter({ path, createRoutes, cachedViewer: signedInViewerQuery() });

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('メールのリンクとパスワードの再設定の経路', () => {
  test.each([
    ['/auth/verify-email', 'メールアドレスの確認'],
    ['/auth/password-reset', 'パスワードの再設定'],
    ['/auth/password-reset/confirm', '新しいパスワードの設定'],
    ['/auth/email-change/confirm', 'メールアドレスの変更'],
    ['/auth/password-change/confirm', 'パスワードの変更'],
  ])(
    'ログイン中でも%sを開くと「%s」の画面を表示し、ページのタイトルに画面の名前を付ける',
    async (path, title) => {
      await renderAt(path);

      await expect.element(pageTitle()).toHaveTextContent(title);
      expect(headOf(path).meta).toContainEqual({
        title: `${title} | Launch Stadium`,
      });
    },
  );

  test.each(TOKEN_LINK_PATHS)(
    '%sは検索エンジンの索引に載せず、開いただけでは変更を送らずにフラグメントを消す',
    async (path) => {
      const router = await renderAt(`${path}#token=${TOKEN}`);

      await expect.element(pageTitle()).toBeVisible();
      await expect.poll(() => router.history.location.hash).toBe('');
      expect(router.state.location.pathname).toBe(path);
      expect(headOf(path).meta).toContainEqual({
        name: 'robots',
        content: 'noindex, nofollow',
      });
      expect(executeGraphQL).not.toHaveBeenCalled();
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each(LINK_PATHS)(
      '%sのページの本文で、アクセシビリティの検査の違反が0件',
      async (path) => {
        await renderAt(`${path}#token=${TOKEN}`);
        await expect.element(pageTitle()).toBeVisible();
        await expect
          .element(page.getByRole('main').getByRole('button').first())
          .toBeVisible();

        expect(await runAxe(page.getByRole('main').element())).toStrictEqual(
          [],
        );
      },
    );
  });
});
