import { describe, expect, test, vi } from 'vitest';

import type { RouterContext } from '../lib/start/router-context.ts';
import { SITE_LAYOUT_LOADERS } from '../src/composition/layout-loaders.ts';
import { pinnedHelpArticlesQueryOptions } from '../src/graphql/help-center.ts';
import { Route } from '../src/routes/__root.tsx';
import {
  createPageRouterContext,
  NO_PINNED_HELP_ARTICLES_QUERY,
  PAGE_ROUTER_ROOT_BEFORE_LOAD,
  PAGE_ROUTER_ROOT_COMPONENTS,
} from './page-router.tsx';

// ログイン中の利用者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える。利用者は取得のキャッシュに先に入れる
vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

// 文書の外枠はサーバーの描画の文脈を読む部品を含み、Startのビルドを経ないブラウザテストでは読み込めないため、空の部品に差し替える
vi.mock('../lib/components/app-shell/app-document.tsx', () => ({
  AppDocument: () => null,
}));

describe('画面のテスト用のルーター', () => {
  test('存在しないページと想定外のエラーに、アプリのルートと同じ部品を使う', () => {
    expect(Route.options.notFoundComponent).toBe(
      PAGE_ROUTER_ROOT_COMPONENTS.notFoundComponent,
    );
    expect(Route.options.errorComponent).toBe(
      PAGE_ROUTER_ROOT_COMPONENTS.errorComponent,
    );
  });

  test('ログイン中の利用者の取得に、アプリのルートと同じbeforeLoadを使う', () => {
    expect(Route.options.beforeLoad).toBe(PAGE_ROUTER_ROOT_BEFORE_LOAD);
  });
});

describe('ルートのloader', () => {
  test('共通レイアウトの区画の取得を待ってから、実行時の値を返す', async () => {
    const context = createPageRouterContext('local');
    const finishers: (() => void)[] = [];
    const query = vi.spyOn(context.queryClient, 'query').mockImplementation(
      () =>
        new Promise((resolve) => {
          finishers.push(() => {
            resolve(NO_PINNED_HELP_ARTICLES_QUERY);
          });
        }),
    );
    const loader = Route.options.loader as unknown as (match: {
      readonly context: RouterContext;
    }) => Promise<unknown>;
    let settled = false;

    const loading = loader({ context }).then((loaderData) => {
      settled = true;
      return loaderData;
    });
    await Promise.resolve();

    expect(query).toHaveBeenCalledTimes(SITE_LAYOUT_LOADERS.length);
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: pinnedHelpArticlesQueryOptions().queryKey,
      }),
    );
    expect(settled).toBe(false);
    for (const finish of finishers) {
      finish();
    }
    expect(await loading).toBe(context.runtime.get());
  });
});
