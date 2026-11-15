import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { LaunchCta } from './launch-cta.tsx';

// テストのルーターがログイン中の利用者の取得を読み込むため、サーバーの実行の入口を読み込まないよう差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TITLE = 'あなたのプロダクトもここに並べましょう。';

const renderCta = (signedIn: boolean) =>
  renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <h1>ディレクトリ</h1>
      <LaunchCta signedIn={signedIn} />
    </main>,
    { path: '/p' },
  );

const region = () => page.getByRole('region', { name: TITLE });

afterEach(() => {
  applyColorScheme('light');
});

describe('LaunchCta', () => {
  test('見出し「あなたのプロダクトもここに並べましょう。」の区画に、予選マッチの勝利で掲載される旨を示す', async () => {
    await renderCta(false);

    await expect.element(region()).toBeVisible();
    await expect
      .element(page.getByRole('heading', { level: 2, name: TITLE }))
      .toBeVisible();
    await expect
      .element(
        region().getByText(
          'ローンチ日の予選マッチに勝利すると、ディレクトリに掲載されます。',
          { exact: true },
        ),
      )
      .toBeVisible();
  });

  test('未ログインの導線「ログインしてローンチを予約🚀」は、プロダクト登録を戻り先にしたログインへ遷移する', async () => {
    await renderCta(false);

    await expect
      .element(
        region().getByRole('link', {
          name: 'ログインしてローンチを予約🚀',
          exact: true,
        }),
      )
      .toHaveAttribute('href', '/auth/login?redirect=%2Fmy%2Fproducts%2Fnew');
  });

  test('ログイン中の導線「ローンチを予約🚀」は、プロダクト登録へ遷移する', async () => {
    await renderCta(true);

    await expect
      .element(
        region().getByRole('link', { name: 'ローンチを予約🚀', exact: true }),
      )
      .toHaveAttribute('href', '/my/products/new');
    expect(page.getByText(/ログインして/u).elements()).toHaveLength(0);
  });

  test('導線を押すと、ページを読み込み直さずにプロダクト登録へ遷移する', async () => {
    const router = await renderCta(true);

    await userEvent.click(
      region().getByRole('link', { name: 'ローンチを予約🚀', exact: true }),
    );

    await vi.waitFor(() => {
      expect(router.state.location.pathname).toBe('/my/products/new');
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['未ログイン', false],
      ['ログイン中', true],
    ] as const)(
      '%sの導線の区画のアクセシビリティの検査の違反が0件',
      async (_name, signedIn) => {
        applyColorScheme(scheme);
        await renderCta(signedIn);

        await expect.element(region()).toBeVisible();
        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
