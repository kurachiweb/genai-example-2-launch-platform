import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { FilterTrigger } from './filter-trigger.tsx';

const LONG_VALUE =
  'とても長いカテゴリの名前が選択欄の幅に収まらずに省略して表示される場合';

afterEach(() => {
  applyColorScheme('light');
});

describe('FilterTrigger', () => {
  test('アクセシブルな名前を「<項目名> <値>」にする', async () => {
    await render(<FilterTrigger label="カテゴリ" value="全て" />);

    await expect
      .element(page.getByRole('button'))
      .toHaveAccessibleName('カテゴリ 全て');
  });

  test('長い値を省略して表示しても、アクセシブルな名前は値の全文のままにする', async () => {
    await render(
      <FilterTrigger label="カテゴリ" value={LONG_VALUE} className="w-48" />,
    );

    await expect
      .element(page.getByRole('button'))
      .toHaveAccessibleName(`カテゴリ ${LONG_VALUE}`);
    const valueElement = page.getByText(LONG_VALUE).element();
    expect(valueElement.scrollWidth).toBeGreaterThan(valueElement.clientWidth);
  });

  test('disabledをボタンへ渡す', async () => {
    await render(
      <FilterTrigger label="カテゴリ" value="読み込み中…" disabled />,
    );

    await expect.element(page.getByRole('button')).toBeDisabled();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('通常と無効の選択欄で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex gap-2 bg-background p-4 text-foreground">
          <FilterTrigger label="並び順" value="ローンチ日が新しい順" />
          <FilterTrigger label="カテゴリ" value="読み込み中…" disabled />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
