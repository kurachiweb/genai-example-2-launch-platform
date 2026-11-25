import { createRoute } from '@tanstack/react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as ApiDocsRoute } from '../src/routes/api-docs.tsx';
import {
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderPageRouter,
} from './page-router.tsx';

// TanStack StartのViteのプラグインが無いテストでは、パッケージの入口がサーバーの部品まで読み込んで失敗する。ブラウザのビルドの変換と同じく関数をそのまま返す
vi.mock('@tanstack/react-start', () => ({
  createClientOnlyFn: <T,>(fn: T): T => fn,
}));

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const API_DOCS_PATH = '/api-docs';
const DOCUMENT_URL = 'http://localhost:48042/v1/openapi.json';

type PageHead = ReturnType<typeof buildSitePageHead>;

const originalFetch = window.fetch.bind(window);

// アプリの経路と同じ画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const renderApiDocs = () =>
  renderPageRouter({
    path: API_DOCS_PATH,
    context: createPageRouterContext('local', {
      publicApiOrigin: 'http://localhost:48042',
    }),
    cachedViewer: GUEST_VIEWER_QUERY,
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: API_DOCS_PATH,
        component: ApiDocsRoute.options.component,
      }),
    ],
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('APIドキュメントの経路', () => {
  test('ログインしていなくても、共通レイアウトの中に見出しとAPIリファレンスの区画を表示し、仕様書を公開APIのオリジンから取得する', async () => {
    const documentFetch = vi.fn(
      () => Promise.withResolvers<Response>().promise,
    );
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input)).href;
      return url === DOCUMENT_URL
        ? documentFetch()
        : originalFetch(input, init);
    });

    await renderApiDocs();

    await expect
      .element(page.getByRole('main').getByRole('heading', { level: 1 }))
      .toHaveTextContent('APIドキュメント');
    await expect.element(page.getByRole('banner')).toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 2, name: 'APIリファレンス' }))
      .toBeVisible();
    await vi.waitFor(() => {
      expect(documentFetch).toHaveBeenCalledTimes(1);
    });
  });

  test('仕様書の取得に失敗した後に再試行すると、APIリファレンスの区画の見出しへフォーカスを移して取り直す', async () => {
    const documentFetch = vi.fn(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    );
    vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
      const url =
        input instanceof Request ? input.url : new URL(String(input)).href;
      return url === DOCUMENT_URL
        ? documentFetch()
        : originalFetch(input, init);
    });
    await renderApiDocs();
    const reference = page.getByRole('region', { name: 'APIリファレンス' });
    await expect.element(reference.getByRole('alert')).toBeVisible();
    documentFetch.mockImplementation(
      () => Promise.withResolvers<Response>().promise,
    );

    await reference.getByRole('button', { name: '再試行' }).click();

    await expect
      .element(
        reference.getByRole('heading', { level: 2, name: 'APIリファレンス' }),
      )
      .toHaveFocus();
    await vi.waitFor(() => {
      expect(documentFetch).toHaveBeenCalledTimes(2);
    });
  });

  test('ページのタイトルは「APIドキュメント」で、正規のURLは/api-docsにする', () => {
    const head = ApiDocsRoute.options.head as (() => PageHead) | undefined;

    expect(head?.()).toStrictEqual({
      meta: [{ title: 'APIドキュメント | Launch Stadium' }],
      links: [{ rel: 'canonical', href: '/api-docs' }],
    });
  });
});
