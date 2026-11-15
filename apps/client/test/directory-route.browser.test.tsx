import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import { executeGraphQL } from '../lib/start/graphql/execute-graphql.ts';
import {
  articleOf,
  categoryTrigger,
  chooseSort,
  deferred,
  DESKTOP,
  directoryOf,
  itemsFrom,
  lastDirectoryInput,
  okDirectory,
  pageHeading,
  progressBar,
  respond,
  searchBox,
  textOf,
} from '../src/components/directory/directory-page-testing.tsx';
import {
  ClientDirectoryDocument,
  type ClientDirectoryQuery,
} from '../src/graphql/generated/graphql.ts';
import { Route as DirectoryRoute } from '../src/routes/p/index.tsx';
import { renderPageRouter } from './page-router.tsx';

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

vi.mock('../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

type Applied = ClientDirectoryQuery['directory']['applied'];

const NO_CONDITIONS: Applied = {
  q: null,
  category: null,
  from: null,
  to: null,
  sort: null,
  page: null,
};

// アプリの経路と同じ検証・取得・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じ識別子(/p/)の経路へ写す
const renderDirectoryRoute = (path: string) =>
  renderPageRouter({
    path,
    createRoutes: (rootRoute) => {
      const parent = createRoute({
        getParentRoute: () => rootRoute,
        path: 'p',
      });
      return [
        parent.addChildren([
          createRoute({
            getParentRoute: () => parent,
            path: '/',
            validateSearch: DirectoryRoute.options.validateSearch,
            loaderDeps: DirectoryRoute.options.loaderDeps,
            loader: DirectoryRoute.options.loader,
            component: DirectoryRoute.options.component,
          } as Parameters<typeof createRoute>[0]),
        ]),
      ];
    },
  });

const directoryCalls = () =>
  vi
    .mocked(executeGraphQL)
    .mock.calls.filter(([document]) => document === ClientDirectoryDocument);

beforeEach(async () => {
  vi.mocked(executeGraphQL).mockReset();
  await page.viewport(DESKTOP.width, DESKTOP.height);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('URLの条件の正規化', () => {
  test('不正なクエリ(並び順・ページ・実在しない日付・空の検索語)は既定の値へ置き換え、既定の条件で一覧を取得する', async () => {
    respond(() => okDirectory(directoryOf()));

    const router = await renderDirectoryRoute(
      '/p?sort=popular&page=abc&from=2026-02-30&q=%20%20',
    );

    await expect.element(articleOf('プロダクト1')).toBeVisible();
    await expect.poll(() => router.state.location.href).toBe('/p');
    expect(lastDirectoryInput()).toStrictEqual({});
    await expect.element(pageHeading()).toBeVisible();
  });

  test('開始日が終了日より後の期間・検索語の無い関連度は外し、50文字を超える検索語は50文字に切り詰める', async () => {
    respond(({ input }) =>
      okDirectory(
        directoryOf({ applied: { ...NO_CONDITIONS, q: input.q ?? null } }),
      ),
    );
    const long = 'あ'.repeat(60);

    const router = await renderDirectoryRoute(
      `/p?q=${encodeURIComponent(long)}&sort=relevance&from=2026-09-30&to=2026-09-01`,
    );

    await expect.element(articleOf('プロダクト1')).toBeVisible();
    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({ q: 'あ'.repeat(50) });
    expect(lastDirectoryInput()).toStrictEqual({ q: 'あ'.repeat(50) });
    await expect.element(searchBox()).toHaveValue('あ'.repeat(50));
  });
});

describe('サーバーが解決した条件とURLの食い違い', () => {
  test('存在しないカテゴリは、サーバーが外した条件のURLへ置き換え、同じ結果を取得し直さない', async () => {
    respond(() => okDirectory(directoryOf({ applied: NO_CONDITIONS })));

    const router = await renderDirectoryRoute('/p?category=unknown-category');

    await expect.element(articleOf('プロダクト1')).toBeVisible();
    await expect.poll(() => router.state.location.href).toBe('/p');
    await expect.element(articleOf('プロダクト1')).toBeVisible();
    expect(progressBar()).toBeNull();
    expect(directoryCalls()).toHaveLength(1);
    expect(lastDirectoryInput()).toStrictEqual({
      category: 'unknown-category',
    });
  });

  test('大文字を含むカテゴリのハンドルは、保存済みの小文字のハンドルのURLへ置き換え、他の条件は残す', async () => {
    respond(() =>
      okDirectory(
        directoryOf({
          applied: { ...NO_CONDITIONS, category: 'developer-tools', page: 2 },
          items: itemsFrom(21, 3),
          totalCount: 23,
          page: 2,
          pageCount: 2,
        }),
      ),
    );

    const router = await renderDirectoryRoute(
      '/p?category=Developer-Tools&page=2',
    );

    await expect
      .poll(() => router.state.location.href)
      .toBe('/p?category=developer-tools&page=2');
    await expect.element(articleOf('プロダクト21')).toBeVisible();
    await expect.element(categoryTrigger()).toHaveTextContent('開発ツール');
    expect(directoryCalls()).toHaveLength(1);
  });

  test('サーバーが解決した条件がURLと同じなら、URLを置き換えない', async () => {
    respond(() =>
      okDirectory(
        directoryOf({ applied: { ...NO_CONDITIONS, sort: 'OLDEST' } }),
      ),
    );

    const router = await renderDirectoryRoute('/p?sort=oldest');

    await expect.element(articleOf('プロダクト1')).toBeVisible();
    const { length } = router.history;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.state.location.href).toBe('/p?sort=oldest');
    expect(router.history.length).toBe(length);
    expect(directoryCalls()).toHaveLength(1);
  });
});

describe('条件の変更', () => {
  test('ルートの取得を待たずに新しい条件を画面へ渡し、直前の一覧を残して進捗のバーと「読み込み中…」を出す', async () => {
    const next = deferred<unknown>();
    respond(({ input }) =>
      input.sort === 'oldest'
        ? next.promise
        : okDirectory(directoryOf({ applied: NO_CONDITIONS })),
    );
    const router = await renderDirectoryRoute('/p');
    await expect.element(textOf('3件')).toBeVisible();

    await chooseSort('ローンチ日が古い順');

    await expect
      .poll((): unknown => router.state.location.search)
      .toEqual({ sort: 'oldest' });
    await expect.element(textOf('読み込み中…')).toBeVisible();
    await expect.element(articleOf('プロダクト1')).toBeVisible();
    expect(progressBar()).not.toBeNull();

    next.resolve(
      okDirectory(
        directoryOf({
          applied: { ...NO_CONDITIONS, sort: 'OLDEST' },
          items: itemsFrom(7, 2),
        }),
      ),
    );

    await expect.element(articleOf('プロダクト7')).toBeVisible();
    await expect.element(textOf('2件')).toBeVisible();
    expect(progressBar()).toBeNull();
    expect(router.state.location.href).toBe('/p?sort=oldest');
  });
});
