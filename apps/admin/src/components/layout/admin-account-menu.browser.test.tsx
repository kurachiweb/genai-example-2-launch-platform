import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { Toaster } from '../../../lib/components/feedback/toaster.tsx';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { hasHorizontalScroll } from '../../../lib/test/overflow.ts';
import {
  GraphQLClientError,
  type GraphQLResult,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  ADMIN_NICKNAME,
  adminViewerResult,
  adminWithRole,
  GUEST_ADMIN_QUERY,
  signedInAdminQuery,
} from '../../../test/admin-viewer-fixtures.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  AdminLogoutDocument,
  AdminViewerDocument,
  type AdminViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { AdminAccountMenu } from './admin-account-menu.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const LOGGED_OUT = 'ログアウトしました。';
const ACCOUNT_LABEL = '自分のアカウント';
const LOGOUT_LABEL = 'ログアウト';
const NARROWEST_VIEWPORT_WIDTH = 320;
const WIDE_VIEWPORT = { width: 1280, height: 800 } as const;

const UNAVAILABLE = new GraphQLClientError({
  code: 'upstream_unavailable',
  message: '現在ご利用いただけません。時間をおいて再度お試しください。',
  status: 503,
});

const menuButton = () => page.getByRole('button', { name: ADMIN_NICKNAME });
const menu = () => page.getByRole('menu');
const menuItem = (name: string) => menu().getByRole('menuitem', { name });
const menuRoot = () => page.getByTestId('account-menu-root');

// ログアウトの前後でログイン中の管理者の取得の結果を切り替えられるよう、操作ごとの応答を差し替える
function respondWith(
  responses: Map<unknown, () => GraphQLResult<unknown>>,
): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    const respond = responses.get(document);
    if (respond === undefined) {
      throw new Error('想定していない操作が実行されました。');
    }
    return Promise.resolve(respond());
  });
}

const renderMenu = (cachedViewer: AdminViewerQuery | null) =>
  renderInRouter(
    <>
      <div data-testid="account-menu-root" className="flex justify-end">
        <AdminAccountMenu />
      </div>
      <Toaster />
    </>,
    { cachedViewer, path: '/accounts' },
  );

async function openMenuWithKeyboard(): Promise<void> {
  menuButton().element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(menu()).toBeVisible();
}

beforeEach(async () => {
  executeGraphQL.mockReset();
  await page.viewport(WIDE_VIEWPORT.width, WIDE_VIEWPORT.height);
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('AdminAccountMenu', () => {
  describe('ログイン中', () => {
    test.each([
      ['VIEWER', '閲覧のみ'],
      ['MODERATOR', 'モデレーター'],
      ['SUPER_ADMIN', '最上位管理者'],
    ] as const)(
      'ロールが%sのとき、ニックネームとロールの表示名「%s」をヘッダーのボタンに表示する',
      async (role, label) => {
        await renderMenu(adminWithRole(role));

        await expect.element(menuButton()).toBeVisible();
        await expect.element(menuButton()).toHaveTextContent(ADMIN_NICKNAME);
        await expect.element(menuButton()).toHaveTextContent(label);
      },
    );

    test('プロフィール画像が無いときは、既定のアイコンを飾りとして表示する', async () => {
      await renderMenu(signedInAdminQuery({ avatar: null }));

      await expect.element(menuButton()).toBeVisible();
      expect(menuButton().element().querySelectorAll('img')).toHaveLength(0);
      expect(menuButton().element().textContent).not.toContain('画像');
    });

    test('キーボードで開いたメニューに、ニックネームとロール、自分のアカウント・ログアウトを並べる', async () => {
      await renderMenu(adminWithRole('MODERATOR'));

      await openMenuWithKeyboard();

      await expect.element(menu().getByText(ADMIN_NICKNAME)).toBeVisible();
      await expect.element(menu().getByText('モデレーター')).toBeVisible();
      expect(
        menu()
          .getByRole('menuitem')
          .elements()
          .map((item) => item.textContent),
      ).toStrictEqual([ACCOUNT_LABEL, LOGOUT_LABEL]);
      await expect
        .element(menuItem(ACCOUNT_LABEL))
        .toHaveAttribute('href', '/account');
      expect(menuItem(LOGOUT_LABEL).element().hasAttribute('href')).toBe(false);
    });

    test('「自分のアカウント」を選ぶと、ページを読み込み直さずに遷移してメニューを閉じる', async () => {
      const router = await renderMenu(signedInAdminQuery());
      await openMenuWithKeyboard();

      await userEvent.click(menuItem(ACCOUNT_LABEL));

      await expect.poll(() => router.state.location.pathname).toBe('/account');
      await expect.element(menu()).not.toBeInTheDocument();
    });

    test('「ログアウト」で、ログアウトを実行し、取得し直した未ログインの状態でアカウントの表示を消してトーストを表示する', async () => {
      let signedIn = true;
      respondWith(
        new Map<unknown, () => GraphQLResult<unknown>>([
          [
            AdminViewerDocument,
            () =>
              adminViewerResult(
                signedIn ? signedInAdminQuery() : GUEST_ADMIN_QUERY,
              ),
          ],
          [
            AdminLogoutDocument,
            () => {
              signedIn = false;
              return { ok: true, data: { adminLogout: true } };
            },
          ],
        ]),
      );
      await renderMenu(signedInAdminQuery());
      await openMenuWithKeyboard();

      await userEvent.click(menuItem(LOGOUT_LABEL));

      await expect.element(page.getByText(LOGGED_OUT)).toBeVisible();
      await expect.element(menuButton()).not.toBeInTheDocument();
      expect(executeGraphQL).toHaveBeenCalledWith(AdminLogoutDocument, {}, {});
      expect(executeGraphQL).toHaveBeenCalledWith(
        AdminViewerDocument,
        {},
        expect.anything(),
      );
      expect(menuRoot().element().innerHTML).toBe('');
    });

    test('ログアウトに失敗したら、問い合わせを促さない失敗の文言をトーストで示し、ログイン中の表示を保つ', async () => {
      respondWith(
        new Map<unknown, () => GraphQLResult<unknown>>([
          [AdminViewerDocument, () => adminViewerResult(signedInAdminQuery())],
          [AdminLogoutDocument, () => ({ ok: false, error: UNAVAILABLE })],
        ]),
      );
      await renderMenu(signedInAdminQuery());
      await openMenuWithKeyboard();

      await userEvent.click(menuItem(LOGOUT_LABEL));

      await expect.element(page.getByText(UNAVAILABLE.message)).toBeVisible();
      await expect.element(menuButton()).toBeVisible();
      expect(page.getByText(LOGGED_OUT).elements()).toHaveLength(0);
    });

    test('ログアウトの想定外の失敗では、問い合わせを促す文を含めない文言を示す', async () => {
      respondWith(
        new Map<unknown, () => GraphQLResult<unknown>>([
          [AdminViewerDocument, () => adminViewerResult(signedInAdminQuery())],
          [
            AdminLogoutDocument,
            () => {
              throw new Error('想定外の失敗');
            },
          ],
        ]),
      );
      await renderMenu(signedInAdminQuery());
      await openMenuWithKeyboard();

      await userEvent.click(menuItem(LOGOUT_LABEL));

      await expect
        .element(
          page.getByText(
            'ページを表示できませんでした。時間をおいて再度お試しください。',
          ),
        )
        .toBeVisible();
      expect(page.getByText('お問い合わせください').elements()).toHaveLength(0);
    });

    test('幅320pxで、ニックネームが長くても横スクロールが出ない', async () => {
      await page.viewport(NARROWEST_VIEWPORT_WIDTH, WIDE_VIEWPORT.height);
      await renderMenu(
        signedInAdminQuery({
          nickname: 'とても長いニックネームの管理者'.repeat(3),
        }),
      );

      await expect.element(page.getByRole('button')).toBeInTheDocument();
      expect(hasHorizontalScroll()).toBe(false);
    });
  });

  describe('未ログイン', () => {
    test('未ログインの取得の結果では、何も描かない', async () => {
      await renderMenu(GUEST_ADMIN_QUERY);

      await expect.element(menuRoot()).toBeInTheDocument();
      expect(menuRoot().element().innerHTML).toBe('');
      expect(page.getByRole('link').elements()).toHaveLength(0);
    });

    test('取得の前は、何も描かない', async () => {
      executeGraphQL.mockReturnValue(new Promise(() => undefined));
      await renderMenu(null);

      await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
      expect(menuRoot().element().innerHTML).toBe('');
    });

    test('取得に失敗したら、未ログインとして何も描かない', async () => {
      executeGraphQL.mockResolvedValue({ ok: false, error: UNAVAILABLE });
      await renderMenu(null);

      await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
      expect(menuRoot().element().innerHTML).toBe('');
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('ログイン中のボタンと開いたメニューで、アクセシビリティの検査の違反が0件', async () => {
      await renderMenu(signedInAdminQuery());
      await expect.element(menuButton()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);

      await openMenuWithKeyboard();

      expect(await runAxe(menu().element())).toStrictEqual([]);
    });

    test('幅320pxのログイン中のボタンで、アクセシビリティの検査の違反が0件', async () => {
      await page.viewport(NARROWEST_VIEWPORT_WIDTH, WIDE_VIEWPORT.height);
      await renderMenu(signedInAdminQuery());
      await expect.element(menuButton()).toBeInTheDocument();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
