import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../test/computed-style.ts';
import {
  emulateReducedMotion,
  REDUCED_MOTION_PREFERENCES,
} from '../../../test/reduced-motion.ts';
import { Button } from '../button/button.tsx';
import { Input } from '../input/input.tsx';
import { Label } from '../label/label.tsx';
import { Popover } from './popover.tsx';
import { PopoverAnchor } from './popover-anchor.tsx';
import { PopoverContent } from './popover-content.tsx';
import { PopoverDescription } from './popover-description.tsx';
import { PopoverHeader } from './popover-header.tsx';
import { PopoverTitle } from './popover-title.tsx';
import { PopoverTrigger } from './popover-trigger.tsx';

function FilterPopover() {
  return (
    <div className="p-4">
      <Popover>
        <PopoverAnchor asChild>
          <div className="flex items-center gap-2">
            <span>絞り込み</span>
            <PopoverTrigger asChild>
              <Button variant="outline">条件を指定</Button>
            </PopoverTrigger>
          </div>
        </PopoverAnchor>
        <PopoverContent aria-labelledby="filter-title">
          <PopoverHeader>
            <PopoverTitle id="filter-title">絞り込みの条件</PopoverTitle>
            <PopoverDescription>
              キーワードで一覧を絞り込みます。
            </PopoverDescription>
          </PopoverHeader>
          <div className="mt-3 grid gap-2">
            <Label htmlFor="filter-keyword">キーワード</Label>
            <Input id="filter-keyword" />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const trigger = () => page.getByRole('button', { name: '条件を指定' });
const popover = () => page.getByRole('dialog', { name: '絞り込みの条件' });

async function openWithKeyboard(): Promise<void> {
  await userEvent.tab();
  await expect.element(trigger()).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  await expect.element(popover()).toBeInTheDocument();
}

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
});

describe('Popover', () => {
  test('キーボードで開くと、フォーカスが中の最初の操作へ移り、開いたことを開いた元の要素で示す', async () => {
    await render(<FilterPopover />);

    await openWithKeyboard();

    await expect
      .element(page.getByRole('textbox', { name: 'キーワード' }))
      .toHaveFocus();
    await expect.element(trigger()).toHaveAttribute('aria-expanded', 'true');
  });

  test.each(REDUCED_MOTION_PREFERENCES)(
    '視差効果の設定が%sのとき、Escapeで閉じるとポップオーバーが取り除かれ、フォーカスが開いた元の要素へ戻る',
    async (preference) => {
      await emulateReducedMotion(preference);
      await render(<FilterPopover />);
      await openWithKeyboard();

      await userEvent.keyboard('{Escape}');

      await expect.element(popover()).not.toBeInTheDocument();
      await expect.element(trigger()).toHaveFocus();
      await expect.element(trigger()).toHaveAttribute('aria-expanded', 'false');
    },
  );

  test('基準の要素の下に並べて表示する', async () => {
    await emulateReducedMotion('reduce');
    await render(<FilterPopover />);
    await openWithKeyboard();

    const anchor = page
      .getByText('絞り込み', { exact: true })
      .element().parentElement;
    await expect
      .poll(() =>
        Math.round(
          popover().element().getBoundingClientRect().top -
            (anchor?.getBoundingClientRect().bottom ?? Number.NaN),
        ),
      )
      .toBe(4);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('開いたポップオーバーで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      await render(<FilterPopover />);
      await openWithKeyboard();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
