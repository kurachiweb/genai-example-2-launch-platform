import { useRef, useState } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { DeleteCommentDialog } from './delete-comment-dialog.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const TITLE = 'コメントを削除しますか?';

const DESCRIPTION =
  '削除したコメントは「このコメントは削除されました。」と表示され、付いている返信はそのまま残ります。';

const OPENER = '削除の確認を開く';

type ConfirmMock = ReturnType<
  typeof vi.fn<(turnstileToken: string) => Promise<void>>
>;

function Harness({ onConfirm }: { readonly onConfirm: ConfirmMock }) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  return (
    <main className="bg-background p-4 text-foreground">
      <button
        ref={openerRef}
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {OPENER}
      </button>
      <DeleteCommentDialog
        open={open}
        onOpenChange={setOpen}
        returnFocusRef={openerRef}
        onConfirm={onConfirm}
      />
    </main>
  );
}

const renderDialog = async (
  onConfirm: ConfirmMock = vi.fn(() => Promise.resolve()),
): Promise<ConfirmMock> => {
  await renderInRouter(<Harness onConfirm={onConfirm} />);
  await userEvent.click(page.getByRole('button', { name: OPENER }));
  await expect.element(dialog()).toBeVisible();
  return onConfirm;
};

const dialog = () => page.getByRole('dialog', { name: TITLE });

const confirmButton = () =>
  dialog().getByRole('button', { name: '削除', exact: true });

const cancelButton = () => dialog().getByRole('button', { name: 'キャンセル' });

const opener = () => page.getByRole('button', { name: OPENER });

// モーダルのダイアログの間は外側の要素が支援技術とポインターから隠れるため、ダイアログの外に描く判定の偽物のボタンは要素を直接押す
const passBotCheck = async () => {
  const button = page.getByText('判定を成功させる').element();
  if (!(button instanceof HTMLButtonElement)) {
    throw new Error('判定の偽物のボタンがありません。');
  }
  button.click();
  await expect.element(confirmButton()).toBeEnabled();
};

beforeEach(() => {
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('DeleteCommentDialog', () => {
  test('見出し「コメントを削除しますか?」と、置き換え表示になり返信が残る旨の説明と、「キャンセル」「削除」を示す', async () => {
    await renderDialog();

    await expect.element(dialog()).toHaveAccessibleDescription(DESCRIPTION);
    await expect.element(cancelButton()).toBeVisible();
    await expect.element(confirmButton()).toBeVisible();
  });

  test('削除は操作名comment_deleteのbot対策を使い、トークンが用意できるまで「削除」を押せない', async () => {
    const onConfirm = await renderDialog();

    expect(lastTurnstileProps().options?.action).toBe('comment_delete');
    await expect.element(confirmButton()).toBeDisabled();

    await passBotCheck();

    await expect.element(confirmButton()).toBeEnabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test('「キャンセル」で削除せずに閉じ、開いた操作へフォーカスを戻す', async () => {
    const onConfirm = await renderDialog();
    await passBotCheck();

    await userEvent.click(cancelButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await expect.poll(() => document.activeElement).toBe(opener().element());
  });

  test('Escapeで削除せずに閉じ、開いた操作へフォーカスを戻す', async () => {
    const onConfirm = await renderDialog();

    await userEvent.keyboard('{Escape}');

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
    await expect.poll(() => document.activeElement).toBe(opener().element());
  });

  test('「削除」で確定するとトークンを渡して削除の操作を呼び、成功で閉じる', async () => {
    const onConfirm = await renderDialog();
    await passBotCheck();

    await userEvent.click(confirmButton());

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('turnstile-token-1');
    await expect.poll(() => document.activeElement).toBe(opener().element());
  });

  test('削除の失敗はダイアログを開いたまま理由の文言を示す', async () => {
    const onConfirm = await renderDialog(
      vi.fn(() =>
        Promise.reject(
          new GraphQLClientError({
            code: 'comment_not_found',
            message: 'コメントが見つかりません。削除された可能性があります。',
            status: 404,
          }),
        ),
      ),
    );
    await passBotCheck();

    await userEvent.click(confirmButton());

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(
        'コメントが見つかりません。削除された可能性があります。',
      );
    await expect.element(dialog()).toBeVisible();
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  test.each(COLOR_SCHEMES)(
    '開いたダイアログで%sの配色のaxeの違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderDialog();
      await passBotCheck();

      expect(await runAxe(dialog().element())).toStrictEqual([]);
    },
  );
});
