import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { type AxeViolationSummary, runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { CategoryPicker } from './category-picker.tsx';
import { DIRECTORY_CATEGORY_FIXTURES } from './category-picker-fixtures.ts';

const trigger = () => page.getByRole('button', { name: /^カテゴリ / });
const popover = () => page.getByRole('dialog', { name: 'カテゴリ' });
const filterInput = () =>
  page.getByRole('combobox', { name: 'カテゴリを絞り込む' });
const option = (name: string) =>
  page.getByRole('option', { name, exact: true });

async function openPopover(): Promise<void> {
  await userEvent.click(trigger());
  await expect.element(popover()).toBeInTheDocument();
}

// ポップオーバーを開くと外側はaria-hiddenになるため、開いたポップオーバーを別に検査する
async function runAxeOnOpenPopover(): Promise<readonly AxeViolationSummary[]> {
  return runAxe(popover().element());
}

afterEach(() => {
  applyColorScheme('light');
});

describe('CategoryPicker', () => {
  test.each([
    [undefined, 'カテゴリ 全て'],
    ['design', 'カテゴリ デザイン'],
    ['missing-category', 'カテゴリ 全て'],
  ])(
    '選択欄は項目名「カテゴリ」に続けて選択中のカテゴリの名称を示す(%s)',
    async (value, name) => {
      await render(
        <CategoryPicker
          categories={DIRECTORY_CATEGORY_FIXTURES}
          loading={false}
          value={value}
          onChange={() => undefined}
        />,
      );

      await expect.element(trigger()).toHaveAccessibleName(name);
      await expect.element(trigger()).toBeEnabled();
    },
  );

  test('選択肢の読み込み中は、値を「読み込み中…」にして選択欄を無効にする', async () => {
    await render(
      <CategoryPicker
        categories={[]}
        loading
        value="design"
        onChange={() => undefined}
      />,
    );

    await expect
      .element(trigger())
      .toHaveAccessibleName('カテゴリ 読み込み中…');
    await expect.element(trigger()).toBeDisabled();
    await userEvent.click(trigger(), { force: true });
    await expect.element(popover()).not.toBeInTheDocument();
  });

  test('開くと絞り込みの欄へフォーカスを移し、「全て」を先頭にした選択肢を並べる', async () => {
    await render(
      <CategoryPicker
        categories={DIRECTORY_CATEGORY_FIXTURES}
        loading={false}
        value={undefined}
        onChange={() => undefined}
      />,
    );

    await openPopover();

    await expect.element(filterInput()).toHaveFocus();
    const names = page
      .getByRole('option')
      .elements()
      .map((element) => element.textContent);
    expect(names).toStrictEqual([
      '全て',
      '開発ツール',
      'デザイン',
      'AI',
      'その他',
    ]);
  });

  test('キーボードで開き、文字入力で絞り込んで上下キーとEnterで選ぶと、ハンドルを知らせて閉じ、選択欄へフォーカスを戻す', async () => {
    const onChange = vi.fn();
    await render(
      <CategoryPicker
        categories={DIRECTORY_CATEGORY_FIXTURES}
        loading={false}
        value={undefined}
        onChange={onChange}
      />,
    );

    await userEvent.tab();
    await expect.element(trigger()).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect.element(filterInput()).toHaveFocus();
    await userEvent.keyboard('デ');
    await expect
      .poll(() => page.getByRole('option').elements())
      .toHaveLength(1);
    await userEvent.fill(filterInput(), '');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');

    expect(onChange.mock.calls).toStrictEqual([['design']]);
    await expect.element(popover()).not.toBeInTheDocument();
    await expect.element(trigger()).toHaveFocus();
  });

  test('「全て」を選ぶとハンドル無し(undefined)を知らせる', async () => {
    const onChange = vi.fn();
    await render(
      <CategoryPicker
        categories={DIRECTORY_CATEGORY_FIXTURES}
        loading={false}
        value="ai"
        onChange={onChange}
      />,
    );

    await openPopover();
    await userEvent.click(option('全て'));

    expect(onChange.mock.calls).toStrictEqual([[undefined]]);
    await expect.element(popover()).not.toBeInTheDocument();
  });

  test('選択中のカテゴリを選び直すと、変更を知らせずに閉じる', async () => {
    const onChange = vi.fn();
    await render(
      <CategoryPicker
        categories={DIRECTORY_CATEGORY_FIXTURES}
        loading={false}
        value="ai"
        onChange={onChange}
      />,
    );

    await openPopover();
    await userEvent.keyboard('{Enter}');

    expect(onChange).not.toHaveBeenCalled();
    await expect.element(popover()).not.toBeInTheDocument();
  });

  test('Escapeで閉じると、変更を知らせず、開き直すと絞り込みの文字を消している', async () => {
    const onChange = vi.fn();
    await render(
      <CategoryPicker
        categories={DIRECTORY_CATEGORY_FIXTURES}
        loading={false}
        value={undefined}
        onChange={onChange}
      />,
    );

    await openPopover();
    await userEvent.fill(filterInput(), 'デ');
    await userEvent.keyboard('{Escape}');
    await expect.element(popover()).not.toBeInTheDocument();
    await openPopover();

    expect(onChange).not.toHaveBeenCalled();
    await expect.element(filterInput()).toHaveValue('');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('通常と読み込み中の選択欄、開いたポップオーバーで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex gap-2 bg-background p-4 text-foreground">
          <CategoryPicker
            categories={DIRECTORY_CATEGORY_FIXTURES}
            loading={false}
            value="design"
            onChange={() => undefined}
          />
          <CategoryPicker
            categories={[]}
            loading
            value={undefined}
            onChange={() => undefined}
          />
        </div>,
      );
      expect(await runAxe(container)).toStrictEqual([]);

      await userEvent.click(
        page.getByRole('button', { name: 'カテゴリ デザイン' }),
      );
      await expect.element(popover()).toBeInTheDocument();
      await userEvent.keyboard('{ArrowDown}');

      expect(await runAxeOnOpenPopover()).toStrictEqual([]);
    });
  });
});
