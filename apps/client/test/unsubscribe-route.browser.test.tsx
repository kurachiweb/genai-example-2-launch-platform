import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import {
  ClientConfirmNotificationUnsubscribeDocument,
  ClientNotificationUnsubscribeLinkDocument,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as UnsubscribeRoute } from '../src/routes/unsubscribe.tsx';
import { type PageRootRoute, renderPageRouter } from './page-router.tsx';
import {
  INVALID_LINK_MESSAGE,
  UNSUBSCRIBE_TOKEN,
  unsubscribeLinkResult,
} from './unsubscribe-fixtures.ts';
import { signedInViewerQuery, VIEWER_NICKNAME } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const PATH = '/unsubscribe';
const QUESTION = '「マッチ開始予告」の通知メールの配信を停止しますか?';

type PageHead = ReturnType<typeof buildSitePageHead>;

const callsOf = (target: unknown) =>
  executeGraphQL.mock.calls.filter(([document]) => document === target);

// アプリの経路と同じ画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => [
  createRoute({
    getParentRoute: () => rootRoute,
    path: PATH,
    component: UnsubscribeRoute.options.component,
  }),
];

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const confirmButton = () =>
  main().getByRole('button', { name: '配信を停止する' });

beforeEach(() => {
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientNotificationUnsubscribeLinkDocument) {
      return Promise.resolve(
        unsubscribeLinkResult({ topic: 'MATCH_PREVIEW', enabled: true }),
      );
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
});

afterEach(() => {
  applyColorScheme('light');
});

describe('配信停止の経路', () => {
  test('未ログインでもログインを求めずに題名「配信停止」と確認を示し、フラグメントを消して確定の操作を送らない', async () => {
    const router = await renderPageRouter({
      path: `${PATH}#token=${UNSUBSCRIBE_TOKEN}`,
      createRoutes,
    });

    await expect.element(pageTitle()).toHaveTextContent('配信停止');
    await expect
      .element(main().getByText(QUESTION, { exact: true }))
      .toBeVisible();
    await expect.element(confirmButton()).toBeVisible();
    await expect.poll(() => router.history.location.hash).toBe('');
    expect(router.state.location.pathname).toBe(PATH);
    expect(callsOf(ClientConfirmNotificationUnsubscribeDocument)).toHaveLength(
      0,
    );
  });

  test('トークンの無い/unsubscribeを開くと、照会せずに無効の表示にする', async () => {
    await renderPageRouter({ path: PATH, createRoutes });

    await expect
      .element(main().getByRole('alert'))
      .toHaveTextContent(INVALID_LINK_MESSAGE);
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('ログイン中の利用者が開いても、本文にニックネームを表示しない', async () => {
    await renderPageRouter({
      path: `${PATH}#token=${UNSUBSCRIBE_TOKEN}`,
      createRoutes,
      cachedViewer: signedInViewerQuery(),
    });

    await expect.element(confirmButton()).toBeVisible();
    expect(main().element().textContent).not.toContain(VIEWER_NICKNAME);
  });

  test('配信停止のページのタイトルは「配信停止」で、検索エンジンに登録させない', () => {
    const head = UnsubscribeRoute.options.head as (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: '配信停止 | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('配信停止のページで、アクセシビリティの検査の違反が0件', async () => {
      await renderPageRouter({
        path: `${PATH}#token=${UNSUBSCRIBE_TOKEN}`,
        createRoutes,
      });
      await expect.element(confirmButton()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
