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
import {
  GraphQLClientError,
  type GraphQLResult,
} from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import {
  signedInViewerQuery,
  VIEWER_HANDLE,
  VIEWER_NICKNAME,
  viewerResult,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientLogoutDocument,
  type ClientViewerQuery,
  ClientViewerDocument,
} from '../../graphql/generated/graphql.ts';
import { AccountMenu } from './account-menu.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const LOGGED_OUT = 'ログアウトしました。';

const UNAVAILABLE = new GraphQLClientError({
  code: 'upstream_unavailable',
  message: '現在ご利用いただけません。時間をおいて再度お試しください。',
  status: 503,
});

const menuButton = () =>
  page.getByRole('button', { name: `${VIEWER_NICKNAME}のユーザーメニュー` });
const menu = () => page.getByRole('menu');
const menuItem = (name: string) => menu().getByRole('menuitem', { name });

// ログアウトの前後でログイン中の利用者の取得の結果を切り替えられるよう、操作ごとの応答を差し替える
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

const renderMenu = (cachedViewer: ClientViewerQuery | null) =>
  renderInRouter(
    <>
      <AccountMenu />
      <Toaster />
    </>,
    { cachedViewer },
  );

async function openMenuWithKeyboard(): Promise<void> {
  menuButton().element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(menu()).toBeVisible();
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  toast.dismiss();
  applyColorScheme('light');
});

describe('AccountMenu', () => {
  describe('未ログイン', () => {
    test('ログインと登録の導線を、それぞれの画面へのリンクとして表示する', async () => {
      await renderMenu({ viewer: null });

      await expect
        .element(page.getByRole('link', { name: 'ログイン', exact: true }))
        .toHaveAttribute('href', '/auth/login');
      await expect
        .element(page.getByRole('link', { name: '登録', exact: true }))
        .toHaveAttribute('href', '/auth/register');
      expect(page.getByRole('button').elements()).toHaveLength(0);
    });

    test('「ログイン」を選ぶと、ページを読み込み直さずにログイン画面へ遷移する', async () => {
      const router = await renderMenu({ viewer: null });

      await userEvent.click(
        page.getByRole('link', { name: 'ログイン', exact: true }),
      );

      await expect
        .poll(() => router.state.location.pathname)
        .toBe('/auth/login');
    });

    test('ログイン中の利用者の取得に失敗したら、未ログインとして描く', async () => {
      executeGraphQL.mockResolvedValue({ ok: false, error: UNAVAILABLE });
      await renderMenu(null);

      await expect
        .element(page.getByRole('link', { name: 'ログイン', exact: true }))
        .toBeVisible();
      expect(executeGraphQL).toHaveBeenCalledWith(
        ClientViewerDocument,
        {},
        expect.anything(),
      );
    });
  });

  describe('ログイン中', () => {
    test('ニックネームと頭文字のボタンを表示し、ログインと登録の導線を表示しない', async () => {
      await renderMenu(signedInViewerQuery());

      await expect.element(menuButton()).toBeVisible();
      await expect.element(menuButton()).toHaveTextContent(VIEWER_NICKNAME);
      await expect
        .element(page.getByRole('link', { name: 'ログイン', exact: true }))
        .not.toBeInTheDocument();
      await expect
        .element(page.getByRole('link', { name: '登録', exact: true }))
        .not.toBeInTheDocument();
    });

    test('キーボードで開いたメニューに、ニックネームとハンドル、プロフィール・自身のプロダクト・設定・ログアウトを並べる', async () => {
      await renderMenu(signedInViewerQuery());

      await openMenuWithKeyboard();

      await expect.element(menu().getByText(VIEWER_NICKNAME)).toBeVisible();
      await expect.element(menu().getByText(`@${VIEWER_HANDLE}`)).toBeVisible();
      expect(
        menu()
          .getByRole('menuitem')
          .elements()
          .map((item) => item.textContent),
      ).toStrictEqual([
        'プロフィール',
        '自身のプロダクト',
        '設定',
        'ログアウト',
      ]);
      await expect
        .element(menuItem('プロフィール'))
        .toHaveAttribute('href', `/@${VIEWER_HANDLE}`);
      await expect
        .element(menuItem('自身のプロダクト'))
        .toHaveAttribute('href', '/my/products');
      await expect
        .element(menuItem('設定'))
        .toHaveAttribute('href', '/settings');
      expect(menuItem('ログアウト').element().hasAttribute('href')).toBe(false);
    });

    test('メニューの「設定」を選ぶと、設定の画面へ遷移してメニューを閉じる', async () => {
      const router = await renderMenu(signedInViewerQuery());
      await openMenuWithKeyboard();

      await userEvent.click(menuItem('設定'));

      await expect.poll(() => router.state.location.pathname).toBe('/settings');
    });

    test('「ログアウト」で、その端末のログアウトを実行し、取得し直した未ログインの導線とトーストを表示する', async () => {
      let signedIn = true;
      respondWith(
        new Map<unknown, () => GraphQLResult<unknown>>([
          [
            ClientViewerDocument,
            () =>
              viewerResult(signedIn ? signedInViewerQuery() : { viewer: null }),
          ],
          [
            ClientLogoutDocument,
            () => {
              signedIn = false;
              return { ok: true, data: { logout: true } };
            },
          ],
        ]),
      );
      await renderMenu(signedInViewerQuery());
      await openMenuWithKeyboard();

      await userEvent.click(menuItem('ログアウト'));

      await expect.element(page.getByText(LOGGED_OUT)).toBeVisible();
      await expect
        .element(page.getByRole('link', { name: 'ログイン', exact: true }))
        .toBeVisible();
      expect(executeGraphQL).toHaveBeenCalledWith(ClientLogoutDocument, {}, {});
      await expect.element(menuButton()).not.toBeInTheDocument();
    });

    test('ログアウトに失敗したら、失敗の文言をトーストで示し、ログイン中の表示を保つ', async () => {
      respondWith(
        new Map<unknown, () => GraphQLResult<unknown>>([
          [ClientViewerDocument, () => viewerResult(signedInViewerQuery())],
          [ClientLogoutDocument, () => ({ ok: false, error: UNAVAILABLE })],
        ]),
      );
      await renderMenu(signedInViewerQuery());
      await openMenuWithKeyboard();

      await userEvent.click(menuItem('ログアウト'));

      await expect.element(page.getByText(UNAVAILABLE.message)).toBeVisible();
      await expect.element(menuButton()).toBeVisible();
      expect(page.getByText(LOGGED_OUT).elements()).toHaveLength(0);
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('未ログインの導線で、アクセシビリティの検査の違反が0件', async () => {
      await renderMenu({ viewer: null });
      await expect
        .element(page.getByRole('link', { name: 'ログイン', exact: true }))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('ログイン中のボタンと開いたメニューで、アクセシビリティの検査の違反が0件', async () => {
      await renderMenu(signedInViewerQuery());
      await expect.element(menuButton()).toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);

      await openMenuWithKeyboard();

      expect(await runAxe(menu().element())).toStrictEqual([]);
    });
  });
});
