import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles/base.css';
import { runAxe } from '../../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../test/computed-style.ts';
import { Label } from './label.tsx';

afterEach(() => {
  applyColorScheme('light');
});

describe('Label', () => {
  test('関連付けた入力欄の名前になり、ラベルを押すと入力欄へフォーカスが移る', async () => {
    await render(
      <>
        <Label htmlFor="product-name">プロダクト名</Label>
        <input id="product-name" />
      </>,
    );
    const input = page.getByRole('textbox', { name: 'プロダクト名' });

    await userEvent.click(page.getByText('プロダクト名'));

    await expect.element(input).toHaveFocus();
  });

  test('Tabの移動先にならない', async () => {
    await render(
      <>
        <Label htmlFor="product-name">プロダクト名</Label>
        <input id="product-name" />
      </>,
    );

    await userEvent.tab();

    await expect
      .element(page.getByRole('textbox', { name: 'プロダクト名' }))
      .toHaveFocus();
  });

  test('直前の入力欄が無効の時は、ラベルも無効であることを示す', async () => {
    await render(
      <>
        <input id="product-name" className="peer" disabled />
        <Label htmlFor="product-name">プロダクト名</Label>
      </>,
    );

    const { opacity, cursor } = getComputedStyle(
      page.getByText('プロダクト名').element(),
    );

    expect(opacity).toBe('0.5');
    expect(cursor).toBe('not-allowed');
  });

  test('無効を示すグループの中では、ラベルを押せないことを示す', async () => {
    await render(
      <div className="group" data-disabled="true">
        <Label htmlFor="product-name">プロダクト名</Label>
        <input id="product-name" disabled />
      </div>,
    );

    const { opacity, pointerEvents } = getComputedStyle(
      page.getByText('プロダクト名').element(),
    );

    expect(opacity).toBe('0.5');
    expect(pointerEvents).toBe('none');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('入力欄と組み合わせて、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex flex-col gap-2 p-4">
          <Label htmlFor="product-name">プロダクト名</Label>
          <input id="product-name" />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
