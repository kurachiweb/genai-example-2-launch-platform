import { createRoute } from '@tanstack/react-router';
import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  focusMainContent,
  renderPageRouter,
} from '../../../test/page-router.tsx';

const ERROR_TITLE = 'ページを表示できませんでした。';
const ERROR_GUIDANCE =
  '時間をおいて再度お試しください。解決しない場合はお問い合わせください。';
const RECOVERED_HEADING = '読み込めた内容';

const main = () => page.getByRole('main');
const retryButton = () => main().getByRole('button', { name: '再試行' });
const contactLink = () =>
  main().getByRole('link', { name: 'お問い合わせ', exact: true });

// 最初の呼び出しだけ失敗し、再試行で成功する処理を作る
function failOnce(): () => void {
  let calls = 0;
  return () => {
    calls += 1;
    if (calls === 1) {
      throw new Error('一時的な失敗');
    }
  };
}

const renderLoaderFailure = () => {
  const load = failOnce();
  return renderPageRouter({
    path: '/broken',
    createRoutes: (rootRoute) => [
      createRoute({
        getParentRoute: () => rootRoute,
        path: '/broken',
        loader: () => {
          load();
          return RECOVERED_HEADING;
        },
        component: () => <h1>{RECOVERED_HEADING}</h1>,
      }),
    ],
  });
};

afterEach(() => {
  applyColorScheme('light');
});

describe('想定外のエラーの画面', () => {
  test('loaderの失敗では、共通レイアウトの本文の中にエラーの見出しと案内を通知として表示する', async () => {
    await renderLoaderFailure();

    const alert = main().getByRole('alert');
    await expect
      .element(alert.getByRole('heading', { level: 1 }))
      .toHaveTextContent(ERROR_TITLE);
    await expect.element(alert.getByText(ERROR_GUIDANCE)).toBeVisible();
    await expect.element(page.getByRole('banner')).toBeVisible();
    await expect.element(page.getByRole('contentinfo')).toBeVisible();
  });

  test('再試行のボタンと、お問い合わせのページへの導線を表示する', async () => {
    await renderLoaderFailure();

    await expect.element(retryButton()).toBeVisible();
    await expect.element(contactLink()).toHaveAttribute('href', '/contact');
  });

  test('「再試行」でloaderを再び実行し、成功すれば経路の内容を表示する', async () => {
    await renderLoaderFailure();

    await userEvent.click(retryButton());

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent(RECOVERED_HEADING);
    await expect.element(main().getByRole('alert')).not.toBeInTheDocument();
  });

  test('描画中の失敗でも同じ画面を表示し、「再試行」で描画をやり直す', async () => {
    // Reactは描画の失敗を同期の描画でもう1回試すため、失敗の状態は再試行の操作まで保つ
    let broken = true;
    await renderPageRouter({
      path: '/broken',
      createRoutes: (rootRoute) => [
        createRoute({
          getParentRoute: () => rootRoute,
          path: '/broken',
          component: () => {
            if (broken) {
              throw new Error('描画の失敗');
            }
            return <h1>{RECOVERED_HEADING}</h1>;
          },
        }),
      ],
    });
    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent(ERROR_TITLE);

    broken = false;
    await userEvent.click(retryButton());

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent(RECOVERED_HEADING);
  });

  test('キーボードで「再試行」とお問い合わせの導線へ順に移れる', async () => {
    await renderLoaderFailure();
    await expect.element(retryButton()).toBeVisible();
    focusMainContent();

    await userEvent.tab();
    await expect.element(retryButton()).toHaveFocus();
    await userEvent.tab();
    await expect.element(contactLink()).toHaveFocus();
  });

  test.each(COLOR_SCHEMES)(
    '%sの配色で、レイアウトを含む画面全体に検査の補助の違反が無い',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderLoaderFailure();
      await expect.element(retryButton()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
