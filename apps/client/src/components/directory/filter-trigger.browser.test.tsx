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

  test('activeのときは、既定の値の選択欄と違う枠の色と背景の色で強調し、名前は変えない', async () => {
    await render(
      <div className="flex gap-2 bg-background p-4 text-foreground">
        <FilterTrigger label="カテゴリ" value="全て" />
        <FilterTrigger label="期間" value="今月" active />
      </div>,
    );
    const inactive = page.getByRole('button', { name: 'カテゴリ 全て' });
    const active = page.getByRole('button', { name: '期間 今月' });

    await expect.element(active).toHaveAttribute('data-active', 'true');
    await expect.element(inactive).not.toHaveAttribute('data-active');
    const styleOf = (element: Element) => getComputedStyle(element);
    expect(styleOf(active.element()).borderTopColor).not.toBe(
      styleOf(inactive.element()).borderTopColor,
    );
    expect(styleOf(active.element()).backgroundColor).not.toBe(
      styleOf(inactive.element()).backgroundColor,
    );
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('通常・強調・無効の選択欄で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex gap-2 bg-background p-4 text-foreground">
          <FilterTrigger label="並び順" value="ローンチ日が新しい順" />
          <FilterTrigger label="期間" value="今月" active />
          <FilterTrigger label="カテゴリ" value="読み込み中…" disabled />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
