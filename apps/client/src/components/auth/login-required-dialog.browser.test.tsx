import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { LoginRequiredDialog } from './login-required-dialog.tsx';

// ログイン中の利用者の取得の補助が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える。利用者は取得のキャッシュに先に入れる
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const TITLE = 'Upvoteにはログインが必要です';
const DESCRIPTION =
  'ログインすると、1マッチにつき1回Upvoteできます。Upvoteはマッチ中いつでも取り消せます。';
const RETURN_TO = '/p/pitch-notes?tab=comments';

function UpvoteButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Upvote
      </button>
      <LoginRequiredDialog
        open={open}
        onOpenChange={setOpen}
        title={TITLE}
        description={DESCRIPTION}
        returnTo={RETURN_TO}
      />
    </>
  );
}

const dialog = () => page.getByRole('dialog', { name: TITLE });
const openerButton = () => page.getByRole('button', { name: 'Upvote' });

async function openDialog() {
  const router = await renderInRouter(<UpvoteButton />);
  openerButton().element().focus();
  await userEvent.keyboard('{Enter}');
  await expect.element(dialog()).toBeVisible();
  return router;
}

afterEach(() => {
  applyColorScheme('light');
});

describe('LoginRequiredDialog', () => {
  test('呼び出す側が渡した題名と説明を、ダイアログの名前と説明として示す', async () => {
    await openDialog();

    await expect.element(dialog()).toHaveAccessibleName(TITLE);
    await expect.element(dialog()).toHaveAccessibleDescription(DESCRIPTION);
  });

  test('渡された戻り先を付けたログインと、登録への導線を示す', async () => {
    await openDialog();

    await expect
      .element(dialog().getByRole('link', { name: 'ログイン', exact: true }))
      .toHaveAttribute(
        'href',
        '/auth/login?redirect=%2Fp%2Fpitch-notes%3Ftab%3Dcomments',
      );
    await expect
      .element(dialog().getByRole('link', { name: '登録', exact: true }))
      .toHaveAttribute('href', '/auth/register');
  });

  test('「ログイン」を選ぶと、戻り先を検索パラメータに持つログイン画面へ遷移する', async () => {
    const router = await openDialog();

    await userEvent.click(
      dialog().getByRole('link', { name: 'ログイン', exact: true }),
    );

    await expect.poll(() => router.state.location.pathname).toBe('/auth/login');
    expect(router.state.location.search).toEqual({ redirect: RETURN_TO });
  });

  test('Escapeで閉じると、開いた元の操作へフォーカスを戻す', async () => {
    await openDialog();

    await userEvent.keyboard('{Escape}');

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(openerButton()).toHaveFocus();
  });

  test('閉じている間は何も描かない', async () => {
    await renderInRouter(<UpvoteButton />);

    await expect.element(openerButton()).toBeVisible();
    await expect.element(dialog()).not.toBeInTheDocument();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('開いたダイアログで、アクセシビリティの検査の違反が0件', async () => {
      await openDialog();

      expect(await runAxe(dialog().element())).toStrictEqual([]);
    });
  });
});
