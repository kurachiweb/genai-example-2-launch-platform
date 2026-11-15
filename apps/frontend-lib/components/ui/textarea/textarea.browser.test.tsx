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
import { Textarea } from './textarea.tsx';

afterEach(() => {
  applyColorScheme('light');
});

describe('Textarea', () => {
  test('Tabでフォーカスが移り、キーボードで改行を含めて入力できる', async () => {
    await render(<Textarea aria-label="説明" />);
    const textarea = page.getByRole('textbox', { name: '説明' });

    await userEvent.tab();
    await userEvent.keyboard('1行目{Enter}2行目');

    await expect.element(textarea).toHaveFocus();
    await expect.element(textarea).toHaveValue('1行目\n2行目');
  });

  test('無効の時は、Tabでフォーカスが移らず、入力できないことを示す', async () => {
    await render(
      <>
        <Textarea aria-label="説明" disabled defaultValue="変更不可" />
        <Textarea aria-label="補足" />
      </>,
    );
    const disabled = page.getByRole('textbox', { name: '説明' });

    await userEvent.tab();
    await userEvent.keyboard('追記');

    await expect.element(disabled).toBeDisabled();
    await expect.element(disabled).toHaveValue('変更不可');
    await expect
      .element(page.getByRole('textbox', { name: '補足' }))
      .toHaveFocus();
    expect(getComputedStyle(disabled.element()).opacity).toBe('0.5');
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスをリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<Textarea aria-label="説明" />);
      const textarea = page.getByRole('textbox', { name: '説明' });

      await userEvent.tab();

      await expect.element(textarea).toHaveFocus();
      await expect
        .poll(() => outlineOf(textarea.element()))
        .toStrictEqual(ringOutline());
    },
  );

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('入力済み・未入力の見本・無効の状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex flex-col gap-3 p-4">
          <Textarea aria-label="説明" defaultValue="作ったプロダクトの説明" />
          <Textarea aria-label="補足" placeholder="補足があれば書きます" />
          <Textarea aria-label="作成者" disabled defaultValue="変更不可" />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
