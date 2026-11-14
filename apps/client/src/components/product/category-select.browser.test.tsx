import { afterEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import type { ProductCategoryView } from '../../graphql/my-products.ts';
import { CategorySelect } from './category-select.tsx';
import {
  CATEGORY_REQUIRED_MESSAGE,
  fieldValuesOf,
  renderProductFields,
  submitButton,
  submittedFieldsOf,
  testForm,
} from './product-basic-fields-testing.tsx';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const LOCK_REASON =
  'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。';

// 照会が返す順(追加の順で、標準カテゴリ「その他」が末尾)
const CATEGORIES: readonly ProductCategoryView[] = Object.freeze([
  {
    id: '01JD0000000000000000000002',
    name: '開発ツール',
    handle: 'dev-tools',
    systemDefault: false,
  },
  {
    id: '01JD0000000000000000000001',
    name: 'AI',
    handle: 'ai',
    systemDefault: false,
  },
  {
    id: '01JD0000000000000000000000',
    name: 'その他',
    handle: 'other',
    systemDefault: true,
  },
]);

const UNSELECTED = fieldValuesOf({ categoryId: '' });

const trigger = () => page.getByRole('combobox', { name: 'カテゴリ(必須)' });
const option = (name: string) =>
  page.getByRole('option', { name, exact: true });

afterEach(() => {
  applyColorScheme('light');
});

describe('選択肢', () => {
  test('未選択の間は「選択してください」を示し、開くと照会の順に並べる', async () => {
    await renderProductFields(
      <CategorySelect categories={CATEGORIES} disabled={false} />,
      UNSELECTED,
    );

    await expect.element(trigger()).toHaveTextContent('選択してください');
    await userEvent.click(trigger());

    await expect.element(page.getByRole('listbox')).toBeVisible();
    expect(
      page
        .getByRole('option')
        .elements()
        .map((element) => element.textContent),
    ).toEqual(['開発ツール', 'AI', 'その他']);
  });

  test('選んだカテゴリのIDを送る値にし、開いて選ぶ間に未選択の文言を出さない', async () => {
    const { onSubmit } = await renderProductFields(
      <CategorySelect categories={CATEGORIES} disabled={false} />,
      UNSELECTED,
    );

    await userEvent.click(trigger());
    await userEvent.click(option('AI'));

    await expect.element(trigger()).toHaveTextContent('AI');
    await expect.element(trigger()).toHaveFocus();
    expect(testForm().getByText(CATEGORY_REQUIRED_MESSAGE).query()).toBeNull();
    await userEvent.click(submitButton());
    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.categoryId).toBe(
      '01JD0000000000000000000001',
    );
  });

  test('読み込んだカテゴリを選択済みで示す', async () => {
    await renderProductFields(
      <CategorySelect categories={CATEGORIES} disabled={false} />,
      fieldValuesOf({ categoryId: '01JD0000000000000000000000' }),
    );

    await expect.element(trigger()).toHaveTextContent('その他');
  });

  test('選ばずにフォーカスを外すと、未選択の文言を欄に結び付けて示す', async () => {
    await renderProductFields(
      <CategorySelect categories={CATEGORIES} disabled={false} />,
      UNSELECTED,
    );

    await userEvent.click(trigger());
    await userEvent.keyboard('{Escape}');
    await expect.element(trigger()).toHaveFocus();
    await userEvent.tab();

    await expect
      .element(trigger())
      .toHaveAccessibleDescription(CATEGORY_REQUIRED_MESSAGE);
  });
});

describe('固定の期間の無効', () => {
  test('FormFieldのdisabledで入力要素を無効にし、理由を欄に結び付けて示す', async () => {
    await renderProductFields(
      <CategorySelect
        categories={CATEGORIES}
        disabled
        disabledReason={LOCK_REASON}
      />,
      fieldValuesOf({ categoryId: '01JD0000000000000000000002' }),
    );

    await expect.element(trigger()).toBeDisabled();
    await expect.element(trigger()).toHaveTextContent('開発ツール');
    await expect.element(trigger()).toHaveAccessibleDescription(LOCK_REASON);
  });

  test('無効の間の値は送る値から外れる', async () => {
    const { onSubmit } = await renderProductFields(
      <CategorySelect
        categories={CATEGORIES}
        disabled
        disabledReason={LOCK_REASON}
      />,
      fieldValuesOf({ categoryId: '01JD0000000000000000000002' }),
    );

    await userEvent.click(submitButton());

    await expect.poll(() => onSubmit.mock.calls.length).toBe(1);
    expect(submittedFieldsOf(onSubmit)?.categoryId).toBeUndefined();
  });

  test('無効でなければ理由を示さない', async () => {
    await renderProductFields(
      <CategorySelect
        categories={CATEGORIES}
        disabled={false}
        disabledReason={LOCK_REASON}
      />,
    );

    await expect.element(trigger()).toBeEnabled();
    expect(testForm().getByText(LOCK_REASON).query()).toBeNull();
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sで、選べる状態の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderProductFields(
        <CategorySelect categories={CATEGORIES} disabled={false} />,
        UNSELECTED,
      );
      await expect.element(trigger()).toBeVisible();

      expect(await runAxe(testForm().element())).toEqual([]);
    },
  );

  test.each(COLOR_SCHEMES)(
    '%sで、固定の期間で無効にした状態の違反が0件である',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderProductFields(
        <CategorySelect
          categories={CATEGORIES}
          disabled
          disabledReason={LOCK_REASON}
        />,
        fieldValuesOf({ categoryId: '01JD0000000000000000000002' }),
      );
      await expect.element(trigger()).toBeDisabled();

      expect(await runAxe(testForm().element())).toEqual([]);
    },
  );
});
