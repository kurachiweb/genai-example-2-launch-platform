import { createRoute } from '@tanstack/react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../src/styles.css';
import { Toaster } from '../lib/components/feedback/toaster.tsx';
import { runAxe } from '../lib/test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../lib/test/computed-style.ts';
import { UNEXPECTED_ERROR_TITLE } from '../lib/utilities/messages/state-messages.ts';
import { GraphQLClientError } from '../lib/utilities/graphql/graphql-result.ts';
import {
  ClientUpdateNotificationPreferenceDocument,
  ClientViewerNotificationSettingsDocument,
} from '../src/graphql/generated/graphql.ts';
import type { buildSitePageHead } from '../src/head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../src/routes/_authenticated/route.tsx';
import { Route as NotificationSettingsRoute } from '../src/routes/_authenticated/settings/notifications.tsx';
import { Route as SettingsRoute } from '../src/routes/_authenticated/settings/route.tsx';
import {
  DELIVERY_STATUS_UNAVAILABLE,
  NOTIFICATION_TOPIC_LABELS,
  notificationSettings,
  SAVED_MESSAGE,
  updatedNotificationSettingsResult,
  viewerNotificationSettingsResult,
} from './notification-settings-fixtures.ts';
import {
  createPageRouterContext,
  type PageRootRoute,
  renderPageRouter,
} from './page-router.tsx';
import { signedInViewerQuery } from './viewer-fixtures.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const NOTIFICATIONS_PATH = '/settings/notifications';

type PageHead = ReturnType<typeof buildSitePageHead>;

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
          path: 'notifications',
          loader: NotificationSettingsRoute.options.loader,
          component: NotificationSettingsRoute.options.component,
        } as Parameters<typeof createRoute>[0]),
      ]),
    ]),
  ];
};

// アプリでは文書の外枠がトーストの置き場を持つため、テストでは隣に置く
const renderNotifications = async ({
  signedIn = true,
}: { readonly signedIn?: boolean } = {}) => {
  const router = await renderPageRouter({
    path: NOTIFICATIONS_PATH,
    createRoutes,
    context: createPageRouterContext('local'),
    ...(signedIn ? { cachedViewer: signedInViewerQuery() } : {}),
  });
  await render(<Toaster />);
  return router;
};

const main = () => page.getByRole('main');
const pageTitle = () => main().getByRole('heading', { level: 1 });
const section = () => main().getByRole('region', { name: '通知メール' });
const settingsNavigation = () => page.getByRole('navigation', { name: '設定' });

beforeEach(() => {
  executeGraphQL.mockReset();
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientViewerNotificationSettingsDocument) {
      return Promise.resolve(
        viewerNotificationSettingsResult(
          notificationSettings({ deliveryStatusAvailable: false }),
        ),
      );
    }
    if (document === ClientUpdateNotificationPreferenceDocument) {
      return Promise.resolve(
        updatedNotificationSettingsResult(
          notificationSettings({
            deliveryStatusAvailable: false,
            enabledTopics: ['MATCH_PREVIEW'],
          }),
        ),
      );
    }
    return Promise.reject(new Error('想定外の文書の取得'));
  });
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('通知設定の経路', () => {
  test('未ログインでは、通知設定のパスを戻り先にしたログイン画面へ移し、通知設定を取得しない', async () => {
    const router = await renderNotifications({ signedIn: false });

    await expect.element(pageTitle()).toHaveTextContent('ログイン');
    expect(router.state.location.search).toEqual({
      redirect: NOTIFICATIONS_PATH,
    });
    expect(callsOf(ClientViewerNotificationSettingsDocument)).toHaveLength(0);
  });

  test('設定のナビゲーションの中に題名「通知」と通知メールの区画を描き、「通知」をセキュリティとフォローの間で現在の項目として示す', async () => {
    await renderNotifications();

    await expect.element(pageTitle()).toHaveTextContent('通知');
    await expect.element(section()).toBeVisible();
    await expect
      .element(settingsNavigation().getByRole('link', { name: '通知' }))
      .toHaveAttribute('aria-current', 'page');
    await expect
      .element(settingsNavigation().getByRole('link', { name: '通知' }))
      .toHaveAttribute('href', NOTIFICATIONS_PATH);
    const labels = settingsNavigation()
      .getByRole('link')
      .elements()
      .map((link) => link.textContent);
    expect(labels.slice(0, 5)).toStrictEqual([
      'プロフィール',
      'アカウント',
      'セキュリティ',
      '通知',
      'フォロー',
    ]);
    expect(callsOf(ClientViewerNotificationSettingsDocument)).toHaveLength(1);
  });

  test('配信の状態を確認できなかった時も、スイッチを表示して変更でき、保存した旨を通知する', async () => {
    await renderNotifications();

    await expect
      .element(main().getByText(DELIVERY_STATUS_UNAVAILABLE, { exact: true }))
      .toBeVisible();
    const preview = section().getByRole('switch', {
      name: NOTIFICATION_TOPIC_LABELS[0],
    });
    await userEvent.click(preview);

    await expect.element(page.getByText(SAVED_MESSAGE)).toBeVisible();
    await expect.element(preview).toHaveAttribute('aria-checked', 'true');
    expect(callsOf(ClientUpdateNotificationPreferenceDocument)).toHaveLength(1);
    expect(callsOf(ClientViewerNotificationSettingsDocument)).toHaveLength(1);
  });

  test('通知設定の取得に失敗したら、想定外のエラーの画面を描く', async () => {
    executeGraphQL.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        error: new GraphQLClientError({
          code: 'upstream_unavailable',
          message: '現在ご利用いただけません。時間をおいて再度お試しください。',
          status: 503,
        }),
      }),
    );
    await renderNotifications();

    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent(UNEXPECTED_ERROR_TITLE);
    expect(page.getByRole('switch').elements()).toHaveLength(0);
  });

  test('通知設定のページのタイトルは「通知」で、検索エンジンに登録させない', () => {
    const head = NotificationSettingsRoute.options.head as
      (() => PageHead) | undefined;
    const meta = head?.().meta ?? [];

    expect(meta).toContainEqual({ title: '通知 | Launch Stadium' });
    expect(meta).toContainEqual({
      name: 'robots',
      content: 'noindex, nofollow',
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('通知設定のページで、アクセシビリティの検査の違反が0件', async () => {
      await renderNotifications();
      await expect.element(section()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
