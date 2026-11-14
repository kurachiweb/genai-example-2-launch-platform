import { EllipsisIcon } from 'lucide-react';
import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { type AxeViolationSummary, runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  outlineOf,
  ringOutline,
  tokenColorOf,
} from '../../../test/computed-style.ts';
import { pressKeyUntilFocusMoves } from '../../../test/keyboard.ts';
import {
  emulateReducedMotion,
  REDUCED_MOTION_PREFERENCES,
} from '../../../test/reduced-motion.ts';
import { Button } from '../button/button.tsx';
import { DropdownMenu } from './dropdown-menu.tsx';
import { DropdownMenuCheckboxItem } from './dropdown-menu-checkbox-item.tsx';
import { DropdownMenuContent } from './dropdown-menu-content.tsx';
import { DropdownMenuGroup } from './dropdown-menu-group.tsx';
import { DropdownMenuItem } from './dropdown-menu-item.tsx';
import { DropdownMenuLabel } from './dropdown-menu-label.tsx';
import { DropdownMenuPortal } from './dropdown-menu-portal.tsx';
import { DropdownMenuRadioGroup } from './dropdown-menu-radio-group.tsx';
import { DropdownMenuRadioItem } from './dropdown-menu-radio-item.tsx';
import { DropdownMenuSeparator } from './dropdown-menu-separator.tsx';
import { DropdownMenuShortcut } from './dropdown-menu-shortcut.tsx';
import { DropdownMenuSub } from './dropdown-menu-sub.tsx';
import { DropdownMenuSubContent } from './dropdown-menu-sub-content.tsx';
import { DropdownMenuSubTrigger } from './dropdown-menu-sub-trigger.tsx';
import { DropdownMenuTrigger } from './dropdown-menu-trigger.tsx';

function CommentActionsMenu({
  onEdit = () => undefined,
}: {
  readonly onEdit?: () => void;
}) {
  return (
    <div className="p-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="コメントの操作">
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>コメント</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={onEdit}>
              編集
              <DropdownMenuShortcut>E</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem disabled>返信を固定</DropdownMenuItem>
            <DropdownMenuItem variant="destructive">削除</DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>共有</DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                <DropdownMenuItem>リンクをコピー</DropdownMenuItem>
                <DropdownMenuItem>メールで送る</DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function DisplaySettingsMenu() {
  const [showsReplies, setShowsReplies] = useState(true);
  const [order, setOrder] = useState('newest');
  return (
    <div className="p-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">表示の設定</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem
            checked={showsReplies}
            onCheckedChange={setShowsReplies}
          >
            返信を表示
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel inset>並び順</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={order} onValueChange={setOrder}>
            <DropdownMenuRadioItem value="newest">
              新しい順
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="oldest">古い順</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

const trigger = (name: string) => page.getByRole('button', { name });
const menu = () => page.getByRole('menu').first();
const item = (name: string) => page.getByRole('menuitem', { name });

async function openWithKeyboard(triggerName: string): Promise<void> {
  await userEvent.tab();
  await expect.element(trigger(triggerName)).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await expect.element(menu()).toBeInTheDocument();
}

// メニューを開くと外側はaria-hiddenになり、フォーカスはメニューの中に閉じ込められる。検査の補助はダイアログ以外の重ねた表示を判定できず、外側の開いた元の要素を違反に数えるため、開いたメニューごとに検査する
async function runAxeOnOpenMenus(): Promise<readonly AxeViolationSummary[]> {
  const openMenus = page.getByRole('menu').elements();
  expect(openMenus.length).toBeGreaterThan(0);
  const violations: AxeViolationSummary[] = [];
  for (const openMenu of openMenus) {
    violations.push(...(await runAxe(openMenu)));
  }
  return violations;
}

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('DropdownMenu', () => {
  test('キーボードで開くと、フォーカスが最初の項目へ移り、メニューが開いた元の要素の名前を持つ', async () => {
    await render(<CommentActionsMenu />);

    await openWithKeyboard('コメントの操作');

    await expect.element(item('編集')).toHaveFocus();
    await expect
      .element(page.getByRole('menu', { name: 'コメントの操作' }))
      .toBeInTheDocument();
  });

  test('矢印キーで無効の項目を飛ばして移り、末尾から先頭へは移らない', async () => {
    await render(<CommentActionsMenu />);
    await openWithKeyboard('コメントの操作');

    await pressKeyUntilFocusMoves('ArrowDown');
    await expect.element(item('削除')).toHaveFocus();
    await pressKeyUntilFocusMoves('ArrowDown');
    await expect.element(item('共有')).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    await expect.element(item('共有')).toHaveFocus();
    await pressKeyUntilFocusMoves('ArrowUp');

    await expect.element(item('削除')).toHaveFocus();
    await expect.element(item('返信を固定')).toHaveAttribute('aria-disabled');
  });

  test('開いている間は、Tabを押してもフォーカスがメニューの外へ出ない', async () => {
    await render(
      <>
        <CommentActionsMenu />
        <Button>次の操作</Button>
      </>,
    );
    await openWithKeyboard('コメントの操作');

    await userEvent.tab();
    await userEvent.tab({ shift: true });

    await expect.element(item('編集')).toHaveFocus();
    await expect.element(menu()).toBeInTheDocument();
  });

  test.each(REDUCED_MOTION_PREFERENCES)(
    '視差効果の設定が%sのとき、Escapeで閉じるとメニューが取り除かれ、フォーカスが開いた元の要素へ戻る',
    async (preference) => {
      await emulateReducedMotion(preference);
      await render(<CommentActionsMenu />);
      await openWithKeyboard('コメントの操作');

      await userEvent.keyboard('{Escape}');

      await expect.element(menu()).not.toBeInTheDocument();
      await expect.element(trigger('コメントの操作')).toHaveFocus();
    },
  );

  test('Enterで項目を選ぶと、選んだ時の処理を呼んで閉じ、フォーカスが開いた元の要素へ戻る', async () => {
    const onEdit = vi.fn();
    await render(<CommentActionsMenu onEdit={onEdit} />);
    await openWithKeyboard('コメントの操作');

    await userEvent.keyboard('{Enter}');

    expect(onEdit).toHaveBeenCalledOnce();
    await expect.element(menu()).not.toBeInTheDocument();
    await expect.element(trigger('コメントの操作')).toHaveFocus();
  });

  test('右矢印でサブメニューを開いてその最初の項目へ移り、左矢印で閉じて元の項目へ戻る', async () => {
    await render(<CommentActionsMenu />);
    await openWithKeyboard('コメントの操作');
    await pressKeyUntilFocusMoves('End');
    await expect.element(item('共有')).toHaveFocus();

    await pressKeyUntilFocusMoves('ArrowRight');
    await expect.element(item('リンクをコピー')).toHaveFocus();
    await expect.element(item('共有')).toHaveAttribute('aria-expanded', 'true');
    await pressKeyUntilFocusMoves('ArrowLeft');

    await expect.element(item('共有')).toHaveFocus();
    await expect.element(item('リンクをコピー')).not.toBeInTheDocument();
  });

  test('チェックの項目とラジオの項目を、キーボードで切り替えて選んだ状態を示す', async () => {
    await render(<DisplaySettingsMenu />);
    const checkbox = () =>
      page.getByRole('menuitemcheckbox', { name: '返信を表示' });
    const radio = (name: string) => page.getByRole('menuitemradio', { name });

    await openWithKeyboard('表示の設定');
    await expect.element(checkbox()).toHaveFocus();
    await expect.element(checkbox()).toBeChecked();
    await userEvent.keyboard('{Enter}');
    await expect.element(menu()).not.toBeInTheDocument();

    await userEvent.keyboard('{Enter}');
    await expect.element(checkbox()).not.toBeChecked();
    await expect.element(radio('新しい順')).toBeChecked();
    await pressKeyUntilFocusMoves('End');
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('{Enter}');

    await expect.element(radio('古い順')).toBeChecked();
    await expect.element(radio('新しい順')).not.toBeChecked();
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、削除の項目は通常は破壊的な操作の色の文字で示し、キーボードで移ったフォーカスを着色した背景と通常の文字色とリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<CommentActionsMenu />);
      await openWithKeyboard('コメントの操作');
      const focused = item('削除').element();
      await expect
        .poll(() => getComputedStyle(focused).color)
        .toBe(tokenColorOf('destructive'));

      await pressKeyUntilFocusMoves('ArrowDown');

      await expect.poll(() => outlineOf(focused)).toStrictEqual(ringOutline());
      await expect
        .poll(() => getComputedStyle(focused).color)
        .toBe(tokenColorOf('popover-foreground'));
      expect(getComputedStyle(focused).backgroundColor).not.toBe(
        getComputedStyle(item('編集').element()).backgroundColor,
      );
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('サブメニューまで開いたメニューで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(<CommentActionsMenu />);
      expect(await runAxe(container)).toStrictEqual([]);
      await openWithKeyboard('コメントの操作');
      await pressKeyUntilFocusMoves('End');
      await pressKeyUntilFocusMoves('ArrowRight');
      await expect.element(item('リンクをコピー')).toHaveFocus();

      expect(await runAxeOnOpenMenus()).toStrictEqual([]);
    });

    test('チェックとラジオの項目を持つメニューで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(<DisplaySettingsMenu />);
      expect(await runAxe(container)).toStrictEqual([]);
      await openWithKeyboard('表示の設定');

      expect(await runAxeOnOpenMenus()).toStrictEqual([]);
    });

    test('削除の項目へキーボードでフォーカスした状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<CommentActionsMenu />);
      await openWithKeyboard('コメントの操作');

      await pressKeyUntilFocusMoves('ArrowDown');
      await expect.element(item('削除')).toHaveFocus();

      expect(await runAxeOnOpenMenus()).toStrictEqual([]);
    });

    test('削除の項目にポインターを重ねてフォーカスした状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<CommentActionsMenu />);
      await openWithKeyboard('コメントの操作');

      await userEvent.hover(item('削除'));
      await expect.element(item('削除')).toHaveFocus();

      expect(await runAxeOnOpenMenus()).toStrictEqual([]);
    });
  });
});
