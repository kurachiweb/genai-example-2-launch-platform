import { createRef } from 'react';
import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { elementsOverflowingContainer } from '../../test/overflow.ts';
import { Label } from '../ui/label/label.tsx';
import { PasswordInput } from './password-input.tsx';

// 固定のパスワードらしい文字列をソースに書かないよう、実行時に組み立てる
const SAMPLE_PASSWORD = ['correct', 'horse', 'battery', 'staple'].join(' ');

const passwordField = () => page.getByLabelText('パスワード', { exact: true });
const toggle = () => page.getByRole('button', { name: 'パスワードを表示' });

interface FieldProps {
  readonly disabled?: boolean;
  readonly autoComplete?: 'current-password' | 'new-password';
}

function Field({ disabled, autoComplete = 'current-password' }: FieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="password">パスワード</Label>
      <PasswordInput
        id="password"
        name="password"
        autoComplete={autoComplete}
        disabled={disabled}
      />
    </div>
  );
}

afterEach(() => {
  applyColorScheme('light');
});

describe('PasswordInput', () => {
  test('既定では入力を伏せ、切り替えのボタンは押されていない状態を伝える', async () => {
    await render(<Field />);

    await expect.element(passwordField()).toHaveAttribute('type', 'password');
    await expect.element(toggle()).toHaveAttribute('aria-pressed', 'false');
    await expect.element(toggle()).toHaveAttribute('type', 'button');
  });

  test('切り替えのボタンで入力の表示と非表示を切り替え、押された状態を伝える', async () => {
    await render(<Field />);
    await passwordField().fill(SAMPLE_PASSWORD);

    await toggle().click();

    await expect.element(passwordField()).toHaveAttribute('type', 'text');
    await expect.element(passwordField()).toHaveValue(SAMPLE_PASSWORD);
    await expect.element(toggle()).toHaveAttribute('aria-pressed', 'true');

    await toggle().click();

    await expect.element(passwordField()).toHaveAttribute('type', 'password');
    await expect.element(toggle()).toHaveAttribute('aria-pressed', 'false');
  });

  test('切り替えのボタンは入力欄を操作対象として指す', async () => {
    await render(<Field />);

    await expect.element(toggle()).toHaveAttribute('aria-controls', 'password');
  });

  test('キーボードだけで入力欄から切り替えのボタンへ移り、切り替えられる', async () => {
    await render(<Field />);

    await userEvent.tab();
    await expect.element(passwordField()).toHaveFocus();
    await userEvent.keyboard(SAMPLE_PASSWORD);
    await userEvent.tab();
    await expect.element(toggle()).toHaveFocus();
    await userEvent.keyboard(' ');

    await expect.element(passwordField()).toHaveAttribute('type', 'text');
    await expect.element(toggle()).toHaveFocus();
    await expect.element(passwordField()).toHaveValue(SAMPLE_PASSWORD);
  });

  test('呼び出す側が指定した自動入力の種類を入力欄へ渡す', async () => {
    const { rerender } = await render(<Field />);
    await expect
      .element(passwordField())
      .toHaveAttribute('autocomplete', 'current-password');

    await rerender(<Field autoComplete="new-password" />);

    await expect
      .element(passwordField())
      .toHaveAttribute('autocomplete', 'new-password');
  });

  test('欄の値と属性・参照を入力要素へ渡す', async () => {
    const ref = createRef<HTMLInputElement>();
    await render(
      <div>
        <Label htmlFor="new-password">新しいパスワード</Label>
        <PasswordInput
          ref={ref}
          id="new-password"
          autoComplete="new-password"
          aria-invalid
          aria-describedby="password-message"
          aria-required
        />
        <p id="password-message">8文字以上で入力してください。</p>
      </div>,
    );
    const input = page.getByLabelText('新しいパスワード');

    expect(ref.current).toBe(input.element());
    await expect.element(input).toHaveAttribute('aria-invalid', 'true');
    await expect.element(input).toHaveAttribute('aria-required', 'true');
    await expect
      .element(input)
      .toHaveAccessibleDescription('8文字以上で入力してください。');
  });

  test('無効の間は、入力欄と切り替えのボタンの両方を操作できない', async () => {
    await render(<Field disabled />);

    await expect.element(passwordField()).toBeDisabled();
    await expect.element(toggle()).toBeDisabled();
  });

  test('幅を絞った親の中でも、親から溢れない', async () => {
    const { container } = await render(
      <div className="w-40">
        <Field />
      </div>,
    );

    expect(elementsOverflowingContainer(container)).toStrictEqual([]);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test.each([false, true])(
      '表示が%sの状態でアクセシビリティの検査の違反が0件',
      async (visible) => {
        applyColorScheme(scheme);
        const { container } = await render(
          <div className="bg-background p-4 text-foreground">
            <Field />
          </div>,
        );
        if (visible) {
          await toggle().click();
        }

        expect(await runAxe(container)).toStrictEqual([]);
      },
    );
  });
});
