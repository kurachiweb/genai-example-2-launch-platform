import { afterEach, describe, expect, test } from 'vitest';
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
import { Sheet } from './sheet.tsx';
import { SheetClose } from './sheet-close.tsx';
import { SheetContent } from './sheet-content.tsx';
import type { SheetSide } from './sheet-content-variants.ts';
import { SheetDescription } from './sheet-description.tsx';
import { SheetFooter } from './sheet-footer.tsx';
import { SheetHeader } from './sheet-header.tsx';
import { SheetTitle } from './sheet-title.tsx';
import { SheetTrigger } from './sheet-trigger.tsx';

const SIDES: readonly SheetSide[] = ['top', 'right', 'bottom', 'left'];

function NavigationSheet({
  side,
  showCloseButton = true,
}: {
  readonly side?: SheetSide;
  readonly showCloseButton?: boolean;
}) {
  return (
    <div className="p-4">
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="outline">メニューを開く</Button>
        </SheetTrigger>
        <SheetContent side={side} showCloseButton={showCloseButton}>
          <SheetHeader>
            <SheetTitle>メニュー</SheetTitle>
            <SheetDescription>
              移動先のページを選んでください。
            </SheetDescription>
          </SheetHeader>
          <nav aria-label="サイト内" className="flex flex-col gap-2 px-4">
            <a href="#directory">ディレクトリ</a>
            <a href="#help">ヘルプ</a>
          </nav>
          <SheetFooter>
            <SheetClose asChild>
              <Button variant="outline">メニューを閉じる</Button>
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

const trigger = () => page.getByRole('button', { name: 'メニューを開く' });
const sheet = () => page.getByRole('dialog', { name: 'メニュー' });
const linkInSheet = (name: string) => sheet().getByRole('link', { name });
const buttonInSheet = (name: string) =>
  sheet().getByRole('button', { name, exact: true });

async function openWithKeyboard(): Promise<void> {
  await userEvent.tab();
  await expect.element(trigger()).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await expect.element(sheet()).toBeInTheDocument();
}

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('Sheet', () => {
  test('キーボードで開くと、リンクを除く中の最初の操作へフォーカスが移り、説明を支援技術へ伝える', async () => {
    await render(<NavigationSheet />);

    await openWithKeyboard();

    await expect.element(buttonInSheet('メニューを閉じる')).toHaveFocus();
    await expect
      .element(sheet())
      .toHaveAccessibleDescription('移動先のページを選んでください。');
  });

  test('開いている間は、TabとShift+Tabのフォーカスがシートの中で循環する', async () => {
    await render(<NavigationSheet />);
    await openWithKeyboard();

    await userEvent.tab();
    await expect.element(buttonInSheet('閉じる')).toHaveFocus();
    await userEvent.tab();
    await expect.element(linkInSheet('ディレクトリ')).toHaveFocus();
    await userEvent.tab();
    await expect.element(linkInSheet('ヘルプ')).toHaveFocus();
    await userEvent.tab();
    await expect.element(buttonInSheet('メニューを閉じる')).toHaveFocus();
    await userEvent.tab({ shift: true });
    await expect.element(linkInSheet('ヘルプ')).toHaveFocus();
  });

  test.each(REDUCED_MOTION_PREFERENCES)(
    '視差効果の設定が%sのとき、Escapeで閉じるとシートが取り除かれ、フォーカスが開いた元の要素へ戻る',
    async (preference) => {
      await emulateReducedMotion(preference);
      await render(<NavigationSheet />);
      await openWithKeyboard();

      await userEvent.keyboard('{Escape}');

      await expect.element(sheet()).not.toBeInTheDocument();
      await expect.element(trigger()).toHaveFocus();
    },
  );

  test.each(['閉じる', 'メニューを閉じる'])(
    '「%s」ボタンで閉じると、フォーカスが開いた元の要素へ戻る',
    async (name) => {
      await render(<NavigationSheet />);
      await openWithKeyboard();

      await userEvent.click(buttonInSheet(name));

      await expect.element(sheet()).not.toBeInTheDocument();
      await expect.element(trigger()).toHaveFocus();
    },
  );

  test('右上の「閉じる」ボタンを表示しない指定では、そのボタンを持たない', async () => {
    await render(<NavigationSheet showCloseButton={false} />);
    await openWithKeyboard();

    await expect.element(buttonInSheet('閉じる')).not.toBeInTheDocument();
  });

  test.each(SIDES)(
    '表示する辺が%sのとき、画面のその辺に接して表示する',
    async (side) => {
      await emulateReducedMotion('reduce');
      await render(<NavigationSheet side={side} />);
      await openWithKeyboard();

      const edgeOf = () => {
        const rect = sheet().element().getBoundingClientRect();
        return {
          top: rect.top,
          right: window.innerWidth - rect.right,
          bottom: window.innerHeight - rect.bottom,
          left: rect.left,
        }[side];
      };
      await expect.poll(edgeOf).toBe(0);
    },
  );

  test('表示する辺の指定が無いとき、右の辺に接して表示する', async () => {
    await emulateReducedMotion('reduce');
    await render(<NavigationSheet />);
    await openWithKeyboard();

    await expect
      .poll(
        () =>
          window.innerWidth - sheet().element().getBoundingClientRect().right,
      )
      .toBe(0);
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスを「閉じる」ボタンのリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<NavigationSheet />);
      await openWithKeyboard();

      await userEvent.tab();

      await expect.element(buttonInSheet('閉じる')).toHaveFocus();
      await expect
        .poll(() => outlineOf(buttonInSheet('閉じる').element()))
        .toStrictEqual(ringOutline());
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('開いたシートで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<NavigationSheet />);
      await openWithKeyboard();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
