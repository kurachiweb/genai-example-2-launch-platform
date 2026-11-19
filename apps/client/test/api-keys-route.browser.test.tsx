import { createRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../src/styles.css';
import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import { apiKeyOf } from '../src/components/public-api/api-key-list-fixtures.ts';
import {
  ClientMyApiKeysDocument,
  type ClientMyApiKeysQuery,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as ApiKeysSettingsRoute } from '../src/routes/_authenticated/settings/api-keys.tsx';
import { Route as SettingsRoute } from '../src/routes/_authenticated/settings/route.tsx';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const API_KEYS_PATH = '/settings/api-keys';

const LOAD_ERROR =
  'APIキーを読み込めませんでした。時間をおいて再度お試しください。';

type PageHead = ReturnType<typeof buildSitePageHead>;

const MY_API_KEYS: ClientMyApiKeysQuery = {
  myApiKeys: {
    nodes: [apiKeyOf(2, { name: '紹介サイト' }), apiKeyOf(1)],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
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
          path: 'api-keys',
          loader: ApiKeysSettingsRoute.options.loader,
          component: ApiKeysSettingsRoute.options.component,
        } as Parameters<typeof createRoute>[0]),
      ]),
    ]),
  ];
};

// アプリでは文書の外枠がトーストの置き場を持つため、テストでは隣に置く
const renderApiKeys = async ({
  signedIn = true,
  suspended = false,
}: {
  readonly signedIn?: boolean;
  readonly suspended?: boolean;
} = {}) => {
  const router = await renderPageRouter({
    path: API_KEYS_PATH,
    createRoutes,
    context: createPageRouterContext('local'),
    ...(signedIn
      ? {
          cachedViewer: signedInViewerQuery({
            status: suspended ? 'SUSPENDED' : 'ACTIVE',
          }),
        }
      : {}),
  });
  await render(<Toaster />);
  return router;
};

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const list = () => main().getByRole('list', { name: 'APIキーの一覧' });
const issueButton = () => main().getByRole('button', { name: 'APIキーを発行' });
const settingsNavigation = () => page.getByRole('navigation', { name: '設定' });

beforeEach(() => {
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientMyApiKeysDocument
      ? Promise.resolve({ ok: true, data: MY_API_KEYS })
      : Promise.reject(new Error('想定外の文書の取得')),
  );
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('APIキーの設定の経路', () => {
  test('未ログインでは、APIキーのパスを戻り先にしたログイン画面へ移し、APIキーを取得しない', async () => {
    const router = await renderApiKeys({ signedIn: false });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({ redirect: API_KEYS_PATH });
    expect(callsOf(ClientMyApiKeysDocument)).toHaveLength(0);
  });

  test('設定のナビゲーションの中に題名「APIキー」と、loaderで1回だけ50件を取得した一覧を描き、「APIキー」を現在の項目として示す', async () => {
    await renderApiKeys();

    await expect.element(pageTitle()).toHaveTextContent('APIキー');
    await expect.element(list()).toBeVisible();
    expect(
      list()
        .getByRole('heading', { level: 2 })
        .elements()
        .map((heading) => heading.textContent),
    ).toStrictEqual(['紹介サイト', '連携ツール1']);
    await expect.element(issueButton()).toBeEnabled();
    const link = settingsNavigation().getByRole('link', { name: 'APIキー' });
    await expect.element(link).toHaveAttribute('aria-current', 'page');
    await expect.element(link).toHaveAttribute('href', API_KEYS_PATH);
    const calls = callsOf(ClientMyApiKeysDocument);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toStrictEqual({ first: 50 });
  });

  test('ルートの文脈の利用者が停止中なら、停止中の案内を示して発行を無効にする', async () => {
    await renderApiKeys({ suspended: true });

    await expect
      .element(main().getByRole('note', { name: '停止中のアカウント' }))
      .toBeVisible();
    await expect.element(issueButton()).toBeDisabled();
  });

  test('一覧の取得に失敗しても、設定のナビゲーションと題名を残したまま一覧の位置に失敗を示す', async () => {
    executeGraphQL.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        error: new GraphQLClientError({
          code: 'internal_error',
          message: 'エラーが発生しました。',
          status: 500,
        }),
      }),
    );
    await renderApiKeys();

    await expect.element(pageTitle()).toHaveTextContent('APIキー');
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(LOAD_ERROR);
    await expect.element(settingsNavigation()).toBeVisible();
  });

  test('APIキーのページのタイトルは「APIキー」で、検索エンジンに登録させない', () => {
    const head = ApiKeysSettingsRoute.options.head as
      (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: 'APIキー | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('APIキーのページで、アクセシビリティの検査の違反が0件', async () => {
      await renderApiKeys();
      await expect.element(list()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
