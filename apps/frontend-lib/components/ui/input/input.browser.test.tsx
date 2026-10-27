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
  tokenColorOf,
} from '../../../test/computed-style.ts';
import { Input } from './input.tsx';

afterEach(() => {
  applyColorScheme('light');
});

describe('Input', () => {
  test('Tabでフォーカスが移り、キーボードで入力できる', async () => {
    await render(<Input aria-label="プロダクト名" />);
    const input = page.getByRole('textbox', { name: 'プロダクト名' });

    await userEvent.tab();
    await userEvent.keyboard('Launch Stadium');

    await expect.element(input).toHaveFocus();
    await expect.element(input).toHaveValue('Launch Stadium');
  });

  test('無効の時は、Tabでフォーカスが移らず、入力できないことを示す', async () => {
    await render(
      <>
        <Input aria-label="プロダクト名" disabled defaultValue="変更不可" />
        <Input aria-label="説明" />
      </>,
    );
    const disabled = page.getByRole('textbox', { name: 'プロダクト名' });

    await userEvent.tab();
    await userEvent.keyboard('追記');

    await expect.element(disabled).toBeDisabled();
    await expect.element(disabled).toHaveValue('変更不可');
    await expect
      .element(page.getByRole('textbox', { name: '説明' }))
      .toHaveFocus();
    expect(getComputedStyle(disabled.element()).opacity).toBe('0.5');
  });

  test.each(COLOR_SCHEMES)(
    '配色が%sのとき、キーボードで移ったフォーカスをリングの色の輪郭で示す',
    async (scheme) => {
      applyColorScheme(scheme);
      await render(<Input aria-label="プロダクト名" />);
      const input = page.getByRole('textbox', { name: 'プロダクト名' });

      await userEvent.tab();

      await expect.element(input).toHaveFocus();
      await expect
        .poll(() => outlineOf(input.element()))
        .toStrictEqual(ringOutline());
    },
  );

  test('入力不正の指定では、枠を破壊的操作のトークンの色で示す', async () => {
    await render(<Input aria-label="プロダクト名" aria-invalid />);

    const { borderTopColor } = getComputedStyle(
      page.getByRole('textbox', { name: 'プロダクト名' }).element(),
    );

    expect(borderTopColor).toBe(tokenColorOf('destructive'));
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('入力済み・未入力の見本・無効の状態で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex flex-col gap-3 p-4">
          <Input aria-label="プロダクト名" defaultValue="Launch Stadium" />
          <Input aria-label="URL" placeholder="https://launch.example" />
          <Input aria-label="作成者" disabled defaultValue="変更不可" />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
