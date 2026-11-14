import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { ResultNotice } from './result-notice.tsx';

const SUCCESS_MESSAGE = 'パスワードを再設定しました。';
const ERROR_MESSAGE = 'このリンクは無効か、有効期限が切れています。';

afterEach(() => {
  applyColorScheme('light');
});

describe('ResultNotice', () => {
  test('成功の文言を状態の通知として描き、フォーカスを移す', async () => {
    await render(
      <ResultNotice tone="success" message={SUCCESS_MESSAGE}>
        <a href="/auth/login">ログイン画面へ</a>
      </ResultNotice>,
    );

    await expect.element(page.getByRole('status')).toHaveFocus();
    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(`${SUCCESS_MESSAGE}ログイン画面へ`);
    expect(page.getByRole('alert').elements()).toHaveLength(0);
  });

  test('失敗の文言を警告として描き、フォーカスを移す', async () => {
    await render(<ResultNotice tone="error" message={ERROR_MESSAGE} />);

    await expect.element(page.getByRole('alert')).toHaveFocus();
    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(ERROR_MESSAGE);
    expect(page.getByRole('link').elements()).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each(['success', 'error'] as const)(
      '%sの表示で、アクセシビリティの検査の違反が0件',
      async (tone) => {
        await render(
          <main className="bg-background p-4 text-foreground">
            <ResultNotice tone={tone} message={SUCCESS_MESSAGE}>
              <a href="/auth/login">ログイン画面へ</a>
            </ResultNotice>
          </main>,
        );

        expect(await runAxe(document.body)).toStrictEqual([]);
      },
    );
  });
});
