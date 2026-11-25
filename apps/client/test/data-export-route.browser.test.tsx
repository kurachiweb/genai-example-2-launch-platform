import { createRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../src/styles.css';
import { Toaster } from '../lib/components/feedback/toaster.tsx';
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
  ClientRequestDataExportDocument,
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

// アプリでは文書の外枠がトーストの置き場を持つため、テストでは隣に置く
const renderExport = async ({
  signedIn = true,
  emailVerified = true,
}: {
  readonly signedIn?: boolean;
  readonly emailVerified?: boolean;
} = {}) => {
  const router = await renderPageRouter({
    path: EXPORT_PATH,
    createRoutes,
    context: createPageRouterContext('local'),
    ...(signedIn
      ? { cachedViewer: signedInViewerQuery({ emailVerified }) }
      : {}),
  });
  await render(<Toaster />);
  return router;
};

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const list = () => main().getByRole('list', { name: 'データエクスポート' });
const requestButton = () =>
  main().getByRole('button', { name: 'エクスポートを要求' });
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
  toast.dismiss();
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

  test('題名の下に説明と有効な要求のボタンを置き、確認の案内は出さない', async () => {
    await renderExport();

    await expect.element(pageTitle()).toHaveTextContent('データエクスポート');
    await expect
      .element(main().getByText(/^要求は24時間に3回までです。/u))
      .toBeVisible();
    await expect.element(requestButton()).toBeEnabled();
    expect(main().getByRole('note').elements()).toHaveLength(0);
  });

  test('ルートの文脈の利用者がメールアドレス未確認なら、要求のボタンを無効にして確認の案内を示す', async () => {
    await renderExport({ emailVerified: false });

    await expect.element(requestButton()).toBeDisabled();
    await expect
      .element(main().getByRole('note', { name: 'メールアドレスの確認' }))
      .toHaveTextContent(
        'データエクスポートはメールアドレスの確認後に利用できます。',
      );
  });

  test('要求すると受け付けの通知を示し、一覧を取り直して作成中の要求を一覧の先頭に加える', async () => {
    let requested = false;
    executeGraphQL.mockImplementation((document: unknown) => {
      if (document === ClientRequestDataExportDocument) {
        requested = true;
        return Promise.resolve({
          ok: true,
          data: { requestDataExport: pendingExportOf(3) },
        });
      }
      return Promise.resolve({
        ok: true,
        data: {
          myDataExports: {
            nodes: requested
              ? [pendingExportOf(3), ...MY_DATA_EXPORTS.myDataExports.nodes]
              : MY_DATA_EXPORTS.myDataExports.nodes,
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    });
    await renderExport();
    await expect
      .poll(() => list().getByRole('listitem').elements())
      .toHaveLength(2);

    await userEvent.click(requestButton());

    await expect
      .element(
        page.getByText(
          'エクスポートを受け付けました。準備ができたらメールでお知らせします。',
        ),
      )
      .toBeVisible();
    await expect
      .poll(() => list().getByRole('listitem').elements())
      .toHaveLength(3);
    await expect
      .element(list().getByRole('listitem').first())
      .toHaveTextContent('作成中');
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
