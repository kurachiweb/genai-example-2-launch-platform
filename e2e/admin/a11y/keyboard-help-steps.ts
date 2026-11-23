import { expect, type Locator, type Page } from '@playwright/test';

import {
  HELP_ARTICLE_ORDER_CATEGORY_LABEL,
  HELP_ARTICLE_ORDER_TITLE,
  HELP_CATEGORIES_TITLE,
  HELP_CATEGORY_ORDER_EDIT_LABEL,
  HELP_CATEGORY_ORDER_LIST_LABEL,
  HELP_ORDER_OUTDATED_MESSAGE,
  HELP_ORDER_RELOAD_LABEL,
  HELP_ORDER_SAVE_LABEL,
  HELP_ORDER_SAVED_MESSAGE,
  moveDownName,
  moveUpName,
} from '../../../apps/admin/src/components/help/help-messages.ts';
import type { KeyboardOperator } from '../../support/keyboard-operator.ts';
import { categorySection } from '../category-steps.ts';
import {
  helpArticleOrderList,
  helpCategoryNamesInTable,
  openHelpArticleOrder,
} from '../help-center-steps.ts';

const HELP_ARTICLE_ORDER_PATH = '/help-articles/order';

// 保存は他の画面での並びの変更と食い違うと拒否されるため、読み込み直してやり直す上限
const MAX_SAVE_ATTEMPTS = 3;

// 保存の往復は開発サーバーの負荷で既定の5秒を超えることがある
const SAVE_TIMEOUT_MS = 30_000;

const moveButton = (
  list: Locator,
  title: string,
  direction: 'up' | 'down',
): Locator =>
  list.getByRole('button', {
    name: direction === 'up' ? moveUpName(title) : moveDownName(title),
    exact: true,
  });

const itemTexts = (list: Locator): Promise<string[]> =>
  list.getByRole('listitem').allInnerTexts();

// 並びの保存を押し、他の画面の変更との食い違いで拒否されたら「最新の並びを読み込む」を押して並べ直す
async function saveOrderByKeyboard(
  operator: KeyboardOperator,
  saveButton: Locator,
  scope: Locator,
  arrange: () => Promise<void>,
): Promise<void> {
  const { page } = operator;
  const saved = page.getByText(HELP_ORDER_SAVED_MESSAGE).first();
  const outdated = page.getByText(HELP_ORDER_OUTDATED_MESSAGE);
  for (let attempt = 1; attempt <= MAX_SAVE_ATTEMPTS; attempt += 1) {
    await operator.activate(saveButton, '並び順の保存');
    await expect(saved.or(outdated)).toBeVisible({ timeout: SAVE_TIMEOUT_MS });
    if (await saved.isVisible()) {
      return;
    }
    await operator.activate(
      scope.getByRole('button', { name: HELP_ORDER_RELOAD_LABEL }),
      '最新の並びを読み込む',
    );
    await expect(outdated).toHaveCount(0);
    await arrange();
  }
  throw new Error(
    `並び順の保存が${String(MAX_SAVE_ATTEMPTS)}回とも別の画面の変更との食い違いで拒否されました`,
  );
}

// 他のE2Eが間にカテゴリを作り得るため、隣接ではなく相対順が逆になるまで押す上限
const MAX_MOVES = 10;

const indexOfItem = async (list: Locator, title: string): Promise<number> => {
  const texts = await itemTexts(list);
  return texts.findIndex((text) => text.includes(title));
};

// 後の項目の「上へ移動」を、相対順が逆になるまでキーボードで押す。押すたびに、同じボタンにフォーカスが残ることを確かめる
async function moveSecondAboveFirst(
  operator: KeyboardOperator,
  list: Locator,
  titles: { readonly first: string; readonly second: string },
): Promise<void> {
  const secondUp = moveButton(list, titles.second, 'up');
  for (let moves = 0; moves < MAX_MOVES; moves += 1) {
    if (
      (await indexOfItem(list, titles.second)) <
      (await indexOfItem(list, titles.first))
    ) {
      return;
    }
    await operator.activate(secondUp, `${titles.second}の上へ移動`);
    await expect(
      secondUp,
      '移した項目の同じボタンにフォーカスが残る',
    ).toBeFocused();
  }
  throw new Error(
    `${String(MAX_MOVES)}回押しても「${titles.second}」が「${titles.first}」より上になりません`,
  );
}

// 項目の「下へ移動」を1回押し、1つ下へ移ることと、同じボタンにフォーカスが残ることを確かめる
async function moveDownOnce(
  operator: KeyboardOperator,
  list: Locator,
  title: string,
): Promise<Locator> {
  const down = moveButton(list, title, 'down');
  const before = await indexOfItem(list, title);
  await operator.activate(down, `${title}の下へ移動`);
  await expect(down, '移した項目の同じボタンにフォーカスが残る').toBeFocused();
  expect(await indexOfItem(list, title), `${title}が1つ下へ移る`).toBe(
    before + 1,
  );
  return down;
}

// 並び順を変更するボタンで一覧を開き、後のカテゴリを上へ移し、下へ1つ移し、また上へ移して保存する
export async function reorderHelpCategoriesByKeyboard(
  operator: KeyboardOperator,
  page: Page,
  names: { readonly first: string; readonly second: string },
): Promise<void> {
  const section = categorySection(page, HELP_CATEGORIES_TITLE);
  const list = section.getByRole('list', {
    name: HELP_CATEGORY_ORDER_LIST_LABEL,
    exact: true,
  });
  await operator.activate(
    section.getByRole('button', {
      name: HELP_CATEGORY_ORDER_EDIT_LABEL,
      exact: true,
    }),
    'カテゴリの並び順の変更',
  );
  await expect(list).toBeVisible();

  const items = list.getByRole('listitem');
  const firstItemText = (await itemTexts(list))[0] ?? '';
  await expect(
    items.first().getByRole('button', { name: /を上へ移動$/u }),
    `先頭の項目(${firstItemText})の上へ移動は押せない`,
  ).toBeDisabled();
  await expect(
    items.last().getByRole('button', { name: /を下へ移動$/u }),
    '末尾の項目の下へ移動は押せない',
  ).toBeDisabled();

  await moveSecondAboveFirst(operator, list, names);
  await moveDownOnce(operator, list, names.second);
  await moveSecondAboveFirst(operator, list, names);

  await saveOrderByKeyboard(
    operator,
    section.getByRole('button', { name: HELP_ORDER_SAVE_LABEL, exact: true }),
    section,
    () => moveSecondAboveFirst(operator, list, names),
  );
  await expect(list).toHaveCount(0);
  await page.reload();
  await expect
    .poll(() => helpCategoryNamesInTable(page, [names.first, names.second]), {
      message: '再読み込みの後のカテゴリの並び',
    })
    .toEqual([names.second, names.first]);
}

// 並び順の画面でカテゴリを選択の部品から選び、ピン留めの群の2件を、上へ・下へ・上へと移して保存する。移動後のフォーカスの維持と両端のボタンの無効化(フォーカス中は`aria-disabled`、離れたら`disabled`)を確かめる
export async function reorderHelpArticlesByKeyboard(
  operator: KeyboardOperator,
  page: Page,
  categoryName: string,
  titles: { readonly first: string; readonly second: string },
): Promise<void> {
  await page.goto(HELP_ARTICLE_ORDER_PATH);
  await expect(
    page.getByRole('heading', { level: 1, name: HELP_ARTICLE_ORDER_TITLE }),
  ).toBeVisible();
  const categorySelect = page.getByRole('combobox', {
    name: HELP_ARTICLE_ORDER_CATEGORY_LABEL,
  });
  const listbox = page.getByRole('listbox');
  await operator.activate(categorySelect, 'カテゴリの選択');
  await expect(listbox).toBeVisible();
  await operator.expectPopupEscapeCloses(
    listbox,
    'カテゴリの選択肢',
    categorySelect,
  );
  await operator.chooseOption(categorySelect, categoryName, 'カテゴリの選択');

  const pinned = helpArticleOrderList(page, 'pinned');
  await expect(pinned.getByRole('listitem')).toHaveCount(2);
  await expect(moveButton(pinned, titles.first, 'up')).toBeDisabled();
  await expect(moveButton(pinned, titles.first, 'down')).toBeEnabled();
  await expect(moveButton(pinned, titles.second, 'up')).toBeEnabled();
  await expect(moveButton(pinned, titles.second, 'down')).toBeDisabled();

  const secondUp = moveButton(pinned, titles.second, 'up');
  await operator.activate(secondUp, `${titles.second}の上へ移動`);
  await expectPinnedOrder(pinned, [titles.second, titles.first]);
  await expect(
    secondUp,
    '移した記事の同じボタンにフォーカスが残る',
  ).toBeFocused();
  await expect(
    secondUp,
    '先頭へ移した記事のフォーカス中の上へ移動は押せないことを伝える',
  ).toHaveAttribute('aria-disabled', 'true');
  await operator.press('Tab');
  await expect(
    secondUp,
    'フォーカスが離れた先頭の上へ移動は押せない',
  ).toBeDisabled();
  await expect(
    moveButton(pinned, titles.first, 'down'),
    '末尾へ移った記事の下へ移動は押せない',
  ).toBeDisabled();
  await expect(moveButton(pinned, titles.second, 'down')).toBeEnabled();
  await expect(moveButton(pinned, titles.first, 'up')).toBeEnabled();

  const secondDown = await moveDownOnce(operator, pinned, titles.second);
  await expectPinnedOrder(pinned, [titles.first, titles.second]);
  await expect(
    secondDown,
    '末尾へ移した記事のフォーカス中の下へ移動は押せないことを伝える',
  ).toHaveAttribute('aria-disabled', 'true');
  await operator.press('Tab');
  await expect(
    secondDown,
    'フォーカスが離れた末尾の下へ移動は押せない',
  ).toBeDisabled();
  await expect(
    moveButton(pinned, titles.first, 'up'),
    '先頭へ戻った記事の上へ移動は押せない',
  ).toBeDisabled();

  await moveSecondAboveFirst(operator, pinned, titles);
  await expectPinnedOrder(pinned, [titles.second, titles.first]);

  await saveOrderByKeyboard(
    operator,
    page
      .getByRole('main')
      .getByRole('button', { name: HELP_ORDER_SAVE_LABEL, exact: true }),
    page.getByRole('main'),
    () => moveSecondAboveFirst(operator, pinned, titles),
  );

  await openHelpArticleOrder(page, categoryName);
  await expectPinnedOrder(pinned, [titles.second, titles.first]);
}

async function expectPinnedOrder(
  pinned: Locator,
  titles: readonly string[],
): Promise<void> {
  const items = pinned.getByRole('listitem');
  await expect(items).toHaveCount(titles.length);
  for (const [index, title] of titles.entries()) {
    await expect(items.nth(index)).toContainText(title);
  }
}
