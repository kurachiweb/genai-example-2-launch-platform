import { createRoute } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  failure,
  type GraphQLHandler,
  respondAdminGraphQL,
  success,
} from '../../../test/admin-accounts-fixtures.ts';
import { adminWithRole } from '../../../test/admin-viewer-fixtures.ts';
import {
  type PageRootRoute,
  renderPageRouter,
} from '../../../test/page-router.tsx';
import { ADMIN_SETTINGS_SECTIONS } from '../../composition/admin-settings-sections.ts';
import {
  type AdminRole,
  AdminUltrasPromotionSettingDocument,
  type AdminUltrasPromotionSettingQuery,
} from '../../graphql/generated/graphql.ts';
import { buildAdminPageHead } from '../../head/page-heads.ts';
import { Route as AuthenticatedRoute } from '../../routes/_authenticated/route.tsx';
import { Route as SettingsRoute } from '../../routes/_authenticated/settings/index.tsx';
import { PromotionSettingSection } from '../ultras/promotion-setting-section.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const SETTINGS_PATH = '/settings';

const PAGE_TITLE = '設定';

const PAGE_DESCRIPTION = '機能ごとの設定を確認・変更します。';

const SECTION_TITLE = 'Ultras導線の機能フラグ';

const SWITCH_LABEL = '未加入者への導線と新規加入';

const CONTACT_PHRASE = 'お問い合わせ';

const ENABLED_SETTING: AdminUltrasPromotionSettingQuery = {
  ultrasPromotionSetting: {
    enabled: true,
    updatedAt: '2026-11-05T01:02:03.000Z',
    updatedByNickname: '統括の担当',
    version: 3,
  },
};

const INTERNAL_ERROR = Object.freeze({
  code: 'internal_error',
  message: 'サーバーで問題が発生しました。時間をおいて再度お試しください。',
  status: 500,
});

const respondSettings = (
  role: AdminRole,
  setting: GraphQLHandler = () => success(ENABLED_SETTING),
): void => {
  respondAdminGraphQL(executeGraphQL, {
    role,
    handlers: new Map<unknown, GraphQLHandler>([
      [AdminUltrasPromotionSettingDocument, setting],
    ]),
  });
};

// アプリの経路の設定を、画面のテスト用のルーターの同じ位置の経路へ写す
const createRoutes = (rootRoute: PageRootRoute) => {
  const authenticatedRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: '_authenticated',
    beforeLoad: AuthenticatedRoute.options.beforeLoad,
    component: AuthenticatedRoute.options.component,
  });
  return [
    authenticatedRoute.addChildren([
      createRoute({
        getParentRoute: () => authenticatedRoute,
        path: SETTINGS_PATH,
        component: SettingsRoute.options.component,
      }),
    ]),
  ];
};

const renderSettingsPage = async (
  role: AdminRole,
  setting?: GraphQLHandler,
) => {
  respondSettings(role, setting);
  await renderPageRouter({
    path: SETTINGS_PATH,
    createRoutes,
    cachedViewer: adminWithRole(role),
  });
};

const main = () => page.getByRole('main');
const section = () => main().getByRole('region', { name: SECTION_TITLE });
const toggle = () => section().getByRole('switch', { name: SWITCH_LABEL });

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('設定の区画の登録口', () => {
  test('Ultras導線の機能フラグの区画をorder 20で登録し、凍結されている', () => {
    expect(ADMIN_SETTINGS_SECTIONS).toStrictEqual([
      {
        id: 'ultras-subscription.promotion-flag',
        order: 20,
        title: SECTION_TITLE,
        component: PromotionSettingSection,
      },
    ]);
    expect(Object.isFrozen(ADMIN_SETTINGS_SECTIONS)).toBe(true);
  });
});

describe('設定のページ', () => {
  test('ページの見出しと説明の下に、登録済みの区画を見出し付きで置き、現在の値を表示する', async () => {
    await renderSettingsPage('VIEWER');

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent(PAGE_TITLE);
    await expect.element(main().getByText(PAGE_DESCRIPTION)).toBeVisible();
    await expect
      .element(main().getByRole('heading', { level: 2, name: SECTION_TITLE }))
      .toBeVisible();
    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(main().getByRole('link').elements()).toHaveLength(0);
  });

  test('ページの題名を設定にする', () => {
    expect(SettingsRoute.options.head?.({} as never)).toStrictEqual(
      buildAdminPageHead({ title: PAGE_TITLE }),
    );
  });

  test('区画の取得の失敗は区画の位置に見出しと問い合わせを促さない文言と再試行で示し、再試行で区画を表示する', async () => {
    let failing = true;
    await renderSettingsPage('SUPER_ADMIN', () =>
      failing ? failure(INTERNAL_ERROR) : success(ENABLED_SETTING),
    );

    await expect
      .element(section().getByRole('alert'))
      .toHaveTextContent(INTERNAL_ERROR.message);
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent(PAGE_TITLE);
    expect(main().getByRole('link').elements()).toHaveLength(0);
    expect(document.body.textContent).not.toContain(CONTACT_PHRASE);

    failing = false;
    await userEvent.click(section().getByRole('button', { name: '再試行' }));

    await expect.element(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、設定のページがWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderSettingsPage('SUPER_ADMIN');
      await expect.element(toggle()).toBeEnabled();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
