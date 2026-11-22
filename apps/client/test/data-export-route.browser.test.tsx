import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import {
  pendingExportOf,
  readyExportOf,
} from '../src/components/data-export/data-export-fixtures.ts';
import {
  ClientMyDataExportsDocument,
  type ClientMyDataExportsQuery,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as DataExportSettingsRoute } from '../src/routes/_authenticated/settings/export.tsx';
import { Route as SettingsRoute } from '../src/routes/_authenticated/settings/route.tsx';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const EXPORT_PATH = '/settings/export';

const LOAD_ERROR =
  'エクスポートの一覧を読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

type PageHead = ReturnType<typeof buildSitePageHead>;

const MY_DATA_EXPORTS: ClientMyDataExportsQuery = {
  myDataExports: {
    nodes: [pendingExportOf(2), readyExportOf(1)],
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
          path: 'export',
          loader: DataExportSettingsRoute.options.loader,
          component: DataExportSettingsRoute.options.component,
        } as Parameters<typeof createRoute>[0]),
      ]),
    ]),
  ];
};

const renderExport = ({
  signedIn = true,
}: { readonly signedIn?: boolean } = {}) =>
  renderPageRouter({
    path: EXPORT_PATH,
    createRoutes,
    context: createPageRouterContext('local'),
    ...(signedIn ? { cachedViewer: signedInViewerQuery() } : {}),
  });

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const list = () => main().getByRole('list', { name: 'データエクスポート' });
const settingsNavigation = () => page.getByRole('navigation', { name: '設定' });

beforeEach(() => {
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientMyDataExportsDocument
      ? Promise.resolve({ ok: true, data: MY_DATA_EXPORTS })
      : Promise.reject(new Error('想定外の文書の取得')),
  );
});

afterEach(() => {
  applyColorScheme('light');
});

describe('データエクスポートの設定の経路', () => {
  test('未ログインでは、データエクスポートのパスを戻り先にしたログイン画面へ移し、一覧を取得しない', async () => {
    const router = await renderExport({ signedIn: false });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({ redirect: EXPORT_PATH });
    expect(callsOf(ClientMyDataExportsDocument)).toHaveLength(0);
  });

  test('設定のナビゲーションの中に題名「データエクスポート」と、loaderで1回だけ20件を取得した一覧を描き、「データエクスポート」を現在の項目として示す', async () => {
    await renderExport();

    await expect.element(pageTitle()).toHaveTextContent('データエクスポート');
    await expect.element(list()).toBeVisible();
    expect(list().getByRole('listitem').elements()).toHaveLength(2);
    const link = settingsNavigation().getByRole('link', {
      name: 'データエクスポート',
    });
    await expect.element(link).toHaveAttribute('aria-current', 'page');
    await expect.element(link).toHaveAttribute('href', EXPORT_PATH);
    const calls = callsOf(ClientMyDataExportsDocument);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[1]).toStrictEqual({ first: 20 });
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
    await renderExport();

    await expect.element(pageTitle()).toHaveTextContent('データエクスポート');
    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(LOAD_ERROR);
    expect(
      main().getByRole('alert').element().closest('[data-slot]'),
    ).toHaveAttribute('data-slot', 'partial-error-state');
    await expect.element(settingsNavigation()).toBeVisible();
  });

  test('データエクスポートのページのタイトルは「データエクスポート」で、検索エンジンに登録させない', () => {
    const head = DataExportSettingsRoute.options.head as
      (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({
      title: 'データエクスポート | Launch Stadium',
    });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('データエクスポートのページで、アクセシビリティの検査の違反が0件', async () => {
      await renderExport();
      await expect.element(list()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
