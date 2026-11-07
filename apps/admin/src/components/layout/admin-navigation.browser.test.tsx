import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { hasHorizontalScroll } from '../../../lib/test/overflow.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  adminViewerResult,
  GUEST_ADMIN_QUERY,
  signedInAdminQuery,
} from '../../../test/admin-viewer-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import type { AdminNavItem } from '../../composition/admin-navigation.ts';
import type { AdminViewerQuery } from '../../graphql/generated/graphql.ts';
import { AdminNavigation } from './admin-navigation.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const WIDE_VIEWPORT = { width: 1280, height: 800 } as const;
const MENU_BREAKPOINT_WIDTH = 768;
const NARROWEST_VIEWPORT_WIDTH = 320;
const VIEWPORT_HEIGHT = 800;

const NAVIGATION_NAME = '管理メニュー';
const MENU_BUTTON_NAME = 'メニュー';

const UNAVAILABLE = new GraphQLClientError({
  code: 'upstream_unavailable',
  message: '現在ご利用いただけません。時間をおいて再度お試しください。',
  status: 503,
});

// 後続の機能が登録する項目を含め、登録の順と表示の順が異なる一覧
const REGISTERED_ITEMS: readonly AdminNavItem[] = Object.freeze([
  { to: '/account', label: '自分のアカウント', order: 160 },
  { to: '/users', label: 'ユーザー', order: 20 },
  { to: '/', label: 'ダッシュボード', order: 10 },
  { to: '/accounts', label: '管理者アカウント', order: 140 },
]);

const navigation = () =>
  page.getByRole('navigation', { name: NAVIGATION_NAME });
const menuButton = () =>
  page.getByRole('button', { name: MENU_BUTTON_NAME, exact: true });

const linkLabels = (root: Element) =>
  Array.from(root.querySelectorAll('a'), (link) => link.textContent);

const currentLinkLabels = (root: Element) =>
  Array.from(
    root.querySelectorAll('a[aria-current="page"]'),
    (link) => link.textContent,
  );

const renderNavigation = ({
  path = '/',
  cachedViewer = signedInAdminQuery(),
  items,
}: {
  readonly path?: string;
  readonly cachedViewer?: AdminViewerQuery | null;
  readonly items?: readonly AdminNavItem[];
} = {}) =>
  renderInRouter(
    <div data-testid="navigation-root">
      {items === undefined ? (
        <AdminNavigation />
      ) : (
        <AdminNavigation items={items} />
      )}
    </div>,
    { path, cachedViewer },
  );

const navigationRoot = () => page.getByTestId('navigation-root').element();

beforeEach(async () => {
  executeGraphQL.mockReset();
  await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
});

afterEach(() => {
  applyColorScheme('light');
});

describe('AdminNavigation', () => {
  describe('ログイン中', () => {
    test('名前付きのナビゲーションのランドマークに、登録された項目だけをorderの順に並べる', async () => {
      await renderNavigation({ items: REGISTERED_ITEMS });

      await expect.element(navigation()).toBeVisible();
      expect(linkLabels(navigation().element())).toStrictEqual([
        'ダッシュボード',
        'ユーザー',
        '管理者アカウント',
        '自分のアカウント',
      ]);
      await expect
        .element(navigation().getByRole('link', { name: 'ユーザー' }))
        .toHaveAttribute('href', '/users');
    });

    test('既定では、登録箇所の項目をorderの順に並べる', async () => {
      await renderNavigation();

      await expect.element(navigation()).toBeVisible();
      expect(linkLabels(navigation().element())).toStrictEqual([
        'ダッシュボード',
        '問い合わせ',
        'カテゴリ',
        '法務文書',
        '設定',
        '管理者アカウント',
        '監査ログ',
        '自分のアカウント',
      ]);
    });

    test.each([
      ['/', 'ダッシュボード'],
      ['/accounts', '管理者アカウント'],
      ['/accounts?status=invited', '管理者アカウント'],
      ['/account', '自分のアカウント'],
      ['/audit-logs/detail', '監査ログ'],
      ['/legal-documents/terms/revisions/1', '法務文書'],
    ])(
      '%sを開いている間は、%sの項目だけを現在のページとして示す',
      async (path, current) => {
        await renderNavigation({ path });

        await expect.element(navigation()).toBeVisible();
        expect(currentLinkLabels(navigation().element())).toStrictEqual([
          current,
        ]);
      },
    );

    test('登録の無いページでは、どの項目も現在のページとして示さない', async () => {
      await renderNavigation({ path: '/unknown' });

      await expect.element(navigation()).toBeVisible();
      expect(currentLinkLabels(navigation().element())).toStrictEqual([]);
    });

    test('項目を選ぶと、ページを読み込み直さずにその画面へ遷移し、現在のページの表示を移す', async () => {
      const router = await renderNavigation();

      await userEvent.click(
        navigation().getByRole('link', { name: '監査ログ' }),
      );

      await expect
        .poll(() => router.state.location.pathname)
        .toBe('/audit-logs');
      await expect
        .poll(() => currentLinkLabels(navigation().element()))
        .toStrictEqual(['監査ログ']);
    });

    test('幅768px以上では、開閉のボタンを出さずに一覧を表示する', async () => {
      await page.viewport(MENU_BREAKPOINT_WIDTH, VIEWPORT_HEIGHT);
      await renderNavigation();

      await expect.element(navigation()).toBeVisible();
      expect(menuButton().query()).toBeNull();
    });
  });

  describe('幅768px未満', () => {
    beforeEach(async () => {
      await page.viewport(MENU_BREAKPOINT_WIDTH - 1, VIEWPORT_HEIGHT);
    });

    test('一覧を隠し、開閉のボタンを表示する', async () => {
      await renderNavigation();

      await expect.element(menuButton()).toBeVisible();
      expect(page.getByRole('navigation').elements()).toHaveLength(0);
    });

    test('ボタンで開いたシートに同じ名前のナビゲーションと項目を並べ、項目を選ぶと遷移してシートを閉じる', async () => {
      const router = await renderNavigation({ path: '/accounts' });

      await userEvent.click(menuButton());

      const dialog = page.getByRole('dialog', { name: MENU_BUTTON_NAME });
      const sheetNavigation = dialog.getByRole('navigation', {
        name: NAVIGATION_NAME,
      });
      await expect.element(sheetNavigation).toBeVisible();
      expect(linkLabels(sheetNavigation.element())).toStrictEqual([
        'ダッシュボード',
        '問い合わせ',
        'カテゴリ',
        '法務文書',
        '設定',
        '管理者アカウント',
        '監査ログ',
        '自分のアカウント',
      ]);
      expect(currentLinkLabels(sheetNavigation.element())).toStrictEqual([
        '管理者アカウント',
      ]);

      await userEvent.click(
        sheetNavigation.getByRole('link', { name: '自分のアカウント' }),
      );

      await expect.poll(() => router.state.location.pathname).toBe('/account');
      await expect.element(dialog).not.toBeInTheDocument();
    });

    test('幅320pxで、横スクロールが出ない', async () => {
      await page.viewport(NARROWEST_VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
      await renderNavigation();

      await expect.element(menuButton()).toBeVisible();
      expect(hasHorizontalScroll()).toBe(false);
    });
  });

  describe('未ログイン', () => {
    test('未ログインの取得の結果では、ナビゲーションのランドマークも開閉のボタンも何も描かない', async () => {
      await renderNavigation({ cachedViewer: GUEST_ADMIN_QUERY });

      await expect
        .element(page.getByTestId('navigation-root'))
        .toBeEmptyDOMElement();
      expect(page.getByRole('navigation').elements()).toHaveLength(0);
    });

    test('取得の前は、何も描かない', async () => {
      executeGraphQL.mockReturnValue(new Promise(() => undefined));
      await renderNavigation({ cachedViewer: null });

      await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
      expect(navigationRoot().innerHTML).toBe('');
    });

    test('取得に失敗したら、未ログインとして何も描かない', async () => {
      executeGraphQL.mockResolvedValue({ ok: false, error: UNAVAILABLE });
      await renderNavigation({ cachedViewer: null });

      await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
      expect(navigationRoot().innerHTML).toBe('');
    });

    test('取得で管理者が得られたら、その時点でナビゲーションを描く', async () => {
      executeGraphQL.mockResolvedValue(adminViewerResult(signedInAdminQuery()));
      await renderNavigation({ cachedViewer: null });

      await expect.element(navigation()).toBeVisible();
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('広い画面で、アクセシビリティの検査の違反が0件', async () => {
      await renderNavigation({ path: '/accounts' });
      await expect.element(navigation()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('狭い画面の開閉のボタンと開いたシートで、アクセシビリティの検査の違反が0件', async () => {
      await page.viewport(NARROWEST_VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
      await renderNavigation({ path: '/accounts' });
      await expect.element(menuButton()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);

      await userEvent.click(menuButton());
      const dialog = page.getByRole('dialog', { name: MENU_BUTTON_NAME });
      await expect.element(dialog).toBeVisible();

      expect(await runAxe(dialog.element())).toStrictEqual([]);
    });
  });
});
