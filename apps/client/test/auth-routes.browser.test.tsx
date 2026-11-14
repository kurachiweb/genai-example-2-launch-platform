import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../src/styles.css';
import { resetTurnstileScriptFailure } from '../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { resetFakeTurnstile } from '../lib/test/fake-turnstile.tsx';
import {
  ClientLoginDocument,
  type ClientViewerQuery,
} from '../src/graphql/generated/graphql.ts';
import { Route as LoginRoute } from '../src/routes/auth/login.tsx';
import { Route as RegisterRoute } from '../src/routes/auth/register.tsx';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';
import { signedInViewerQuery, viewerResult } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../lib/test/fake-turnstile.tsx'),
);

const PASSWORD = ['pitch', 'notes', 'launch'].join('-');

const pageTitle = () =>
  page.getByRole('main').getByRole('heading', { level: 1 });

// アプリの経路と同じ判定・検索パラメータの検証・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => [
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <h1>トップページ</h1>,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings/account',
    component: () => <h1>アカウント</h1>,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/login',
    validateSearch: LoginRoute.options.validateSearch,
    beforeLoad: LoginRoute.options.beforeLoad,
    component: LoginRoute.options.component,
  }),
  createRoute({
    getParentRoute: () => rootRoute,
    path: '/auth/register',
    beforeLoad: RegisterRoute.options.beforeLoad,
    component: RegisterRoute.options.component,
  }),
];

const renderAt = (path: string, cachedViewer?: ClientViewerQuery) =>
  renderPageRouter({
    path,
    createRoutes,
    ...(cachedViewer === undefined ? {} : { cachedViewer }),
  });

async function logInAs(viewerAfterLogin: ClientViewerQuery): Promise<void> {
  executeGraphQL.mockImplementation((document: unknown) =>
    Promise.resolve(
      document === ClientLoginDocument
        ? {
            ok: true,
            data: {
              login: { __typename: 'LoginSucceeded', viewer: { id: 'user-1' } },
            },
          }
        : viewerResult(viewerAfterLogin),
    ),
  );
  await userEvent.type(
    page.getByRole('textbox', { name: 'メールアドレス(必須)', exact: true }),
    'maker@launch.example',
  );
  await userEvent.type(
    page.getByLabelText('パスワード(必須)', { exact: true }),
    PASSWORD,
  );
  await userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));
  await userEvent.click(page.getByRole('button', { name: 'ログインする' }));
}

// 768px未満ではユーザーメニューがメニューのシートの中に描かれるため、ヘッダーに描かれる幅で確かめる
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

describe('登録とログインの経路', () => {
  test.each(['/auth/login?redirect=%2Fsettings%2Faccount', '/auth/register'])(
    'ログイン中に%sを開くと、トップページへ移す',
    async (path) => {
      const router = await renderAt(path, signedInViewerQuery());

      await expect.element(pageTitle()).toHaveTextContent('トップページ');
      expect(router.state.location.pathname).toBe('/');
    },
  );

  test.each([
    ['ログイン', '/auth/login'],
    ['ユーザー登録', '/auth/register'],
  ])('未ログインでは「%s」の画面を表示する', async (title, path) => {
    await renderAt(path);

    await expect.element(pageTitle()).toHaveTextContent(title);
  });

  test('URLとして解釈できない戻り先でもログイン画面を表示し、ログインの後はトップページへ移る', async () => {
    const router = await renderAt('/auth/login?redirect=%2F%09%2F');

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    await logInAs(signedInViewerQuery());

    await expect.element(pageTitle()).toHaveTextContent('トップページ');
    expect(router.state.location.pathname).toBe('/');
  });

  test.each([
    ['数値', '/auth/login?redirect=123'],
    ['配列', '/auth/login?redirect=%5B%22%2Fsettings%2Faccount%22%5D'],
  ])(
    '検索パラメータが文字列でない%sの戻り先でもログイン画面を表示し、ログインの後はトップページへ移る',
    async (_label, path) => {
      const router = await renderAt(path);

      await expect.element(pageTitle()).toHaveTextContent('ログイン');
      await logInAs(signedInViewerQuery());

      await expect.element(pageTitle()).toHaveTextContent('トップページ');
      expect(router.state.location.pathname).toBe('/');
    },
  );

  test('ログインに成功すると、検索パラメータの同じサイト内の戻り先へ移り、ヘッダーをログイン中に切り替える', async () => {
    const router = await renderAt('/auth/login?redirect=%2Fsettings%2Faccount');

    await logInAs(signedInViewerQuery());

    await expect.element(pageTitle()).toHaveTextContent('アカウント');
    expect(router.state.location.pathname).toBe('/settings/account');
    await expect
      .element(
        page
          .getByRole('banner')
          .getByRole('button', { name: /のユーザーメニュー$/u }),
      )
      .toBeVisible();
  });

  test('戻り先が別のサイトのURLなら、ログインの後はトップページへ移る', async () => {
    const router = await renderAt(
      '/auth/login?redirect=%2F%2Fevil.example%2Fsettings',
    );

    await logInAs(signedInViewerQuery());

    await expect.element(pageTitle()).toHaveTextContent('トップページ');
    expect(router.state.location.pathname).toBe('/');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each(['/auth/login', '/auth/register'])(
      '%sのページの本文で、アクセシビリティの検査の違反が0件',
      async (path) => {
        await renderAt(path);
        await expect.element(pageTitle()).toBeVisible();

        expect(await runAxe(page.getByRole('main').element())).toStrictEqual(
          [],
        );
      },
    );
  });
});
