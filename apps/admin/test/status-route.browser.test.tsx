import { createRoute } from '@tanstack/react-router';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../src/styles.css';
import type { GraphQLResult } from '../lib/utilities/graphql/graphql-result.ts';
import {
  DATABASE_REACHABLE_LABEL,
  PAGE_LOAD_RESULT_HEADING,
  SYSTEM_STATUS_TITLE,
} from '../lib/utilities/messages/system-status-messages.ts';
import type { AppEnvironment } from '../lib/utilities/system/system-status-availability.ts';
import {
  AdminSystemStatusDocument,
  type AdminSystemStatusQuery,
} from '../src/graphql/generated/graphql.ts';
import { Route } from '../src/routes/system/status.tsx';
import { createPageRouterContext, renderPageRouter } from './page-router.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../lib/start/graphql/execute-graphql.ts', () => ({ executeGraphQL }));

const STATUS_PATH = '/system/status';
const NOT_FOUND_TITLE = 'ページが見つかりません。';

const SYSTEM_STATUS: GraphQLResult<AdminSystemStatusQuery> = {
  ok: true,
  data: {
    systemStatus: {
      serverTime: '2026-01-15T07:40:00.000Z',
      databaseReachable: true,
    },
  },
};

// アプリの経路と同じ公開の判定・取得・画面を通すため、本物の経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const renderStatusRoute = (environment: AppEnvironment) =>
  renderPageRouter({
    path: STATUS_PATH,
    context: createPageRouterContext(environment),
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: STATUS_PATH,
        beforeLoad: Route.options.beforeLoad,
        loader: Route.options.loader,
        component: Route.options.component,
      }),
    ],
  });

const pageTitle = () =>
  page.getByRole('main').getByRole('heading', { level: 1 });

beforeEach(() => {
  executeGraphQL.mockReset();
  executeGraphQL.mockResolvedValue(SYSTEM_STATUS);
});

describe('疎通確認の画面の経路', () => {
  test('prodでは、取得を始めずに存在しないページの画面を基本レイアウトの中に表示する', async () => {
    await renderStatusRoute('prod');

    await expect.element(pageTitle()).toHaveTextContent(NOT_FOUND_TITLE);
    await expect.element(page.getByRole('banner')).toBeVisible();
    expect(
      page.getByRole('heading', { name: SYSTEM_STATUS_TITLE }).elements(),
    ).toHaveLength(0);
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test.each<AppEnvironment>(['staging', 'local'])(
    '%sでは、管理者側の操作で取得した結果を疎通確認の画面に表示する',
    async (environment) => {
      await renderStatusRoute(environment);

      await expect.element(pageTitle()).toHaveTextContent(SYSTEM_STATUS_TITLE);
      await expect
        .element(
          page
            .getByRole('region', { name: PAGE_LOAD_RESULT_HEADING })
            .getByText(DATABASE_REACHABLE_LABEL, { exact: true }),
        )
        .toBeVisible();
      expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
        AdminSystemStatusDocument,
        {},
      );
    },
  );
});
