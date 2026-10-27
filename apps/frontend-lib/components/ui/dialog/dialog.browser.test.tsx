import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
} from '../../../test/computed-style.ts';
import {
  emulateReducedMotion,
  REDUCED_MOTION_PREFERENCES,
} from '../../../test/reduced-motion.ts';
import { Button } from '../button/button.tsx';
import { Dialog } from './dialog.tsx';
import { DialogClose } from './dialog-close.tsx';
import { DialogContent } from './dialog-content.tsx';
import { DialogDescription } from './dialog-description.tsx';
import { DialogFooter } from './dialog-footer.tsx';
import { DialogHeader } from './dialog-header.tsx';
import { DialogTitle } from './dialog-title.tsx';
import { DialogTrigger } from './dialog-trigger.tsx';

const TITLE = 'プロダクト『Pitch Notes』を削除しますか?';
const DESCRIPTION = '削除したプロダクトは元に戻せません。';

function DeleteProductDialog({
  onDelete = () => undefined,
  showCloseButton = true,
  showFooterCloseButton = false,
}: {
  readonly onDelete?: () => void;
  readonly showCloseButton?: boolean;
  readonly showFooterCloseButton?: boolean;
}) {
  return (
    <div className="p-4">
      <Button variant="outline">前の操作</Button>
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="destructive">プロダクトを削除する</Button>
        </DialogTrigger>
        <DialogContent showCloseButton={showCloseButton}>
          <DialogHeader>
            <DialogTitle>{TITLE}</DialogTitle>
            <DialogDescription>{DESCRIPTION}</DialogDescription>
          </DialogHeader>
          <DialogFooter showCloseButton={showFooterCloseButton}>
            <DialogClose asChild>
              <Button variant="outline">キャンセル</Button>
            </DialogClose>
            <Button variant="destructive" onClick={onDelete}>
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const trigger = () =>
  page.getByRole('button', { name: 'プロダクトを削除する' });
const dialog = () => page.getByRole('dialog', { name: TITLE });
const buttonInDialog = (name: string) =>
  dialog().getByRole('button', { name, exact: true });

async function openWithKeyboard(): Promise<void> {
  await userEvent.tab();
  await userEvent.tab();
  await expect.element(trigger()).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await expect.element(dialog()).toBeInTheDocument();
}

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('Dialog', () => {
  test('キーボードで開くと、フォーカスが中の最初の操作へ移り、題名と説明を支援技術へ伝える', async () => {
    await render(<DeleteProductDialog />);

    await openWithKeyboard();

    await expect.element(buttonInDialog('キャンセル')).toHaveFocus();
    await expect.element(dialog()).toHaveAccessibleDescription(DESCRIPTION);
  });

  test('開いている間は、TabとShift+Tabのフォーカスがダイアログの中で循環する', async () => {
    await render(<DeleteProductDialog />);
    await openWithKeyboard();

    await userEvent.tab();
    await expect.element(buttonInDialog('削除')).toHaveFocus();
    await userEvent.tab();
    await expect.element(buttonInDialog('閉じる')).toHaveFocus();
    await userEvent.tab();
    await expect.element(buttonInDialog('キャンセル')).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect.element(buttonInDialog('閉じる')).toHaveFocus();
  });

  test.each(REDUCED_MOTION_PREFERENCES)(
    '視差効果の設定が%sのとき、Escapeで閉じるとダイアログが取り除かれ、フォーカスが開いた元の要素へ戻る',
    async (preference) => {
      await emulateReducedMotion(preference);
      await render(<DeleteProductDialog />);
      await openWithKeyboard();

      await userEvent.keyboard('{Escape}');

      await expect.element(dialog()).not.toBeInTheDocument();
      await expect.element(trigger()).toHaveFocus();
    },
  );

  test('右上の「閉じる」ボタンで閉じると、フォーカスが開いた元の要素へ戻る', async () => {
    await render(<DeleteProductDialog />);
    await openWithKeyboard();

    await userEvent.click(buttonInDialog('閉じる'));

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  test('閉じる部品で包んだボタンで閉じ、閉じない操作のボタンは押した時の処理を呼ぶ', async () => {
    const onDelete = vi.fn();
    await render(<DeleteProductDialog onDelete={onDelete} />);
    await openWithKeyboard();

    await userEvent.keyboard('{Tab}{Enter}');
    expect(onDelete).toHaveBeenCalledOnce();
    await expect.element(dialog()).toBeInTheDocument();

    await userEvent.click(buttonInDialog('キャンセル'));
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  test('フッターの「閉じる」ボタンを表示する指定では、そのボタンで閉じる', async () => {
    await render(
      <DeleteProductDialog showCloseButton={false} showFooterCloseButton />,
    );
    await openWithKeyboard();

    await expect.element(buttonInDialog('閉じる')).toHaveClass('border');
    await userEvent.click(buttonInDialog('閉じる'));

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスを「閉じる」ボタンのリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<DeleteProductDialog />);
      await openWithKeyboard();

      await userEvent.tab({ shift: true });

      await expect.element(buttonInDialog('閉じる')).toHaveFocus();
      await expect
        .poll(() => outlineOf(buttonInDialog('閉じる').element()))
        .toStrictEqual(ringOutline());
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('開いたダイアログで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<DeleteProductDialog showFooterCloseButton />);
      await openWithKeyboard();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
