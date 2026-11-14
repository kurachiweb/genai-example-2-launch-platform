import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { LaunchAction } from './launch-action.tsx';

// ログイン中の利用者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える。利用者は取得のキャッシュに先に入れる
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const launchLink = () =>
  page.getByRole('link', { name: 'ローンチする', exact: true });

afterEach(() => {
  applyColorScheme('light');
});

describe('LaunchAction', () => {
  test('未ログインでは、プロダクト登録の画面を戻り先にしたログイン画面へのリンクにする', async () => {
    await renderInRouter(<LaunchAction />, { cachedViewer: { viewer: null } });

    await expect
      .element(launchLink())
      .toHaveAttribute('href', '/auth/login?redirect=%2Fmy%2Fproducts%2Fnew');
  });

  test('未ログインで選ぶと、戻り先を検索パラメータに持つログイン画面へ遷移する', async () => {
    const router = await renderInRouter(<LaunchAction />, {
      cachedViewer: { viewer: null },
    });

    await userEvent.click(launchLink());

    await expect.poll(() => router.state.location.pathname).toBe('/auth/login');
    expect(router.state.location.search).toEqual({
      redirect: '/my/products/new',
    });
  });

  test('ログイン中は、プロダクト登録の画面へのリンクにする', async () => {
    await renderInRouter(<LaunchAction />, {
      cachedViewer: signedInViewerQuery(),
    });

    await expect
      .element(launchLink())
      .toHaveAttribute('href', '/my/products/new');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('アクセシビリティの検査の違反が0件', async () => {
      await renderInRouter(<LaunchAction />, {
        cachedViewer: signedInViewerQuery(),
      });
      await expect.element(launchLink()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
