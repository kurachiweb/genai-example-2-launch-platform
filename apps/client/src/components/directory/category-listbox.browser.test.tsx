import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { CategoryListbox } from './category-listbox.tsx';
import { DIRECTORY_CATEGORY_FIXTURES } from './category-picker-fixtures.ts';

const filterInput = () =>
  page.getByRole('combobox', { name: 'カテゴリを絞り込む' });
const listbox = () => page.getByRole('listbox', { name: 'カテゴリ' });
const options = () => page.getByRole('option');
const option = (name: string) =>
  page.getByRole('option', { name, exact: true });

function optionNames(): readonly string[] {
  return options()
    .elements()
    .map((element) => element.textContent);
}

function activeOptionName(): string | null | undefined {
  const activeId = filterInput()
    .element()
    .getAttribute('aria-activedescendant');
  if (activeId === null) {
    return null;
  }
  return document.getElementById(activeId)?.textContent;
}

afterEach(() => {
  applyColorScheme('light');
});

describe('CategoryListbox', () => {
  test('選択肢は「全て」を先頭に、受け取ったカテゴリの順に並べる', async () => {
    await render(
      <CategoryListbox
        categories={DIRECTORY_CATEGORY_FIXTURES}
        value={undefined}
        onSelect={() => undefined}
      />,
    );

    await expect.element(listbox()).toBeInTheDocument();
    expect(optionNames()).toStrictEqual([
      '全て',
      '開発ツール',
      'デザイン',
      'AI',
      'その他',
    ]);
    await expect
      .element(option('全て'))
      .toHaveAttribute('aria-selected', 'true');
  });

  test('選択中のカテゴリを選択済みにし、最初の選択の候補にする', async () => {
    await render(
      <CategoryListbox
        categories={DIRECTORY_CATEGORY_FIXTURES}
        value="design"
        onSelect={() => undefined}
      />,
    );

    await expect
      .element(option('デザイン'))
      .toHaveAttribute('aria-selected', 'true');
    await expect
      .element(option('全て'))
      .toHaveAttribute('aria-selected', 'false');
    expect(activeOptionName()).toBe('デザイン');
  });

  test.each([
    ['名称の一部', 'デザ', ['デザイン']],
    ['ハンドルの一部', 'dev', ['開発ツール']],
    ['大文字小文字と全角半角の違い', 'ＡＩ', ['AI']],
    ['前後の空白', '  その他 ', ['その他']],
  ])(
    '文字を入力すると、%sが一致するカテゴリだけに絞り込み、「全て」を除く',
    async (_label, text, expected) => {
      await render(
        <CategoryListbox
          categories={DIRECTORY_CATEGORY_FIXTURES}
          value={undefined}
          onSelect={() => undefined}
        />,
      );

      await userEvent.fill(filterInput(), text);

      await expect.poll(() => optionNames()).toStrictEqual(expected);
      await expect
        .element(
          page.getByText(`${String(expected.length)}件のカテゴリが一致します`),
        )
        .toBeInTheDocument();
      expect(activeOptionName()).toBe(expected[0]);
    },
  );

  test('一致するカテゴリが無ければ、その旨を示して選択肢を出さず、Enterで何も知らせない', async () => {
    const onSelect = vi.fn();
    await render(
      <CategoryListbox
        categories={DIRECTORY_CATEGORY_FIXTURES}
        value={undefined}
        onSelect={onSelect}
      />,
    );

    await userEvent.fill(filterInput(), 'zzz');

    await expect
      .element(page.getByText('一致するカテゴリがありません。'))
      .toBeVisible();
    expect(options().elements()).toHaveLength(0);
    await expect
      .element(filterInput())
      .toHaveAttribute('aria-expanded', 'false');
    await expect
      .element(page.getByText('0件のカテゴリが一致します'))
      .toBeInTheDocument();
    await expect
      .element(filterInput())
      .not.toHaveAttribute('aria-activedescendant');
    await userEvent.keyboard('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('絞り込みの文字が無い間は、一致件数を伝えない', async () => {
    await render(
      <CategoryListbox
        categories={DIRECTORY_CATEGORY_FIXTURES}
        value={undefined}
        onSelect={() => undefined}
      />,
    );

    await userEvent.fill(filterInput(), 'デ');
    await userEvent.fill(filterInput(), '');

    await expect
      .element(page.getByText(/件のカテゴリが一致します/))
      .not.toBeInTheDocument();
    expect(optionNames()).toHaveLength(5);
  });

  test('上下キーで選択の候補を移し、端では止まり、Enterで候補のハンドルを知らせる', async () => {
    const onSelect = vi.fn();
    await render(
      <CategoryListbox
        categories={DIRECTORY_CATEGORY_FIXTURES}
        value={undefined}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(filterInput());

    await userEvent.keyboard('{ArrowUp}');
    expect(activeOptionName()).toBe('全て');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}');
    expect(activeOptionName()).toBe('デザイン');
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(activeOptionName()).toBe('その他');
    await userEvent.keyboard('{ArrowUp}');
    expect(activeOptionName()).toBe('AI');
    await expect.element(option('AI')).toHaveAttribute('data-active', 'true');
    await userEvent.keyboard('{Enter}');

    expect(onSelect.mock.calls).toStrictEqual([['ai']]);
    await expect.element(filterInput()).toHaveFocus();
  });

  test('絞り込んだ後のEnterは、一致した最初のカテゴリを知らせる', async () => {
    const onSelect = vi.fn();
    await render(
      <CategoryListbox
        categories={DIRECTORY_CATEGORY_FIXTURES}
        value="ai"
        onSelect={onSelect}
      />,
    );

    await userEvent.fill(filterInput(), 'ツール');
    await userEvent.keyboard('{Enter}');

    expect(onSelect.mock.calls).toStrictEqual([['developer-tools']]);
  });

  test('「全て」を選ぶとハンドル無し(undefined)を知らせる', async () => {
    const onSelect = vi.fn();
    await render(
      <CategoryListbox
        categories={DIRECTORY_CATEGORY_FIXTURES}
        value="design"
        onSelect={onSelect}
      />,
    );

    await userEvent.click(option('全て'));

    expect(onSelect.mock.calls).toStrictEqual([[undefined]]);
  });

  test('選択肢を押すと、そのハンドルを知らせ、入力欄のフォーカスを保つ', async () => {
    const onSelect = vi.fn();
    await render(
      <CategoryListbox
        categories={DIRECTORY_CATEGORY_FIXTURES}
        value={undefined}
        onSelect={onSelect}
      />,
    );
    await userEvent.click(filterInput());

    await userEvent.click(option('その他'));

    expect(onSelect.mock.calls).toStrictEqual([['other']]);
    await expect.element(filterInput()).toHaveFocus();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([
      ['絞り込みの文字が無い', ''],
      ['一致するカテゴリがある', 'デ'],
      ['一致するカテゴリが無い', 'zzz'],
    ])('%s時、アクセシビリティの検査の違反が0件', async (_label, text) => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="w-80 bg-popover p-2 text-popover-foreground">
          <CategoryListbox
            categories={DIRECTORY_CATEGORY_FIXTURES}
            value="design"
            onSelect={() => undefined}
          />
        </div>,
      );
      if (text !== '') {
        await userEvent.fill(filterInput(), text);
      }
      await userEvent.keyboard('{ArrowDown}');

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
