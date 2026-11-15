import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { resetTurnstileScriptFailure } from '../../../lib/components/bot-protection/turnstile-script-failure.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
} from '../../../lib/test/fake-turnstile.tsx';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { AdminRequestPasswordResetDocument } from '../../graphql/generated/graphql.ts';
import { PasswordResetRequestForm } from './password-reset-request-form.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const EMAIL = 'operator@admin.example';
const SENT_NOTICE =
  '入力したメールアドレスが管理者として登録されている場合は、パスワードの再設定のリンクを送信しました。リンクの有効期限は30分です。';

const requestForm = () =>
  page.getByRole('form', { name: 'パスワードの再設定' });
const emailInput = () => page.getByRole('textbox', { name: 'メールアドレス' });
const sendButton = () =>
  page.getByRole('button', { name: '再設定のリンクを送信する' });

function respond(result: () => Promise<unknown>): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === AdminRequestPasswordResetDocument) {
      return result();
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

const accepted = () =>
  Promise.resolve({ ok: true, data: { requestAdminPasswordReset: true } });

async function submitEmail(email: string): Promise<void> {
  await userEvent.type(emailInput(), email);
  await userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));
  await userEvent.click(sendButton());
}

const renderForm = () =>
  renderInRouter(<PasswordResetRequestForm />, {
    path: '/auth/password-reset',
  });

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('PasswordResetRequestForm', () => {
  test('フォーカスを外した時に、APIと同じ文言のエラーを入力欄に関連付けて示す', async () => {
    await renderForm();

    await userEvent.type(emailInput(), 'operator@');
    await userEvent.tab();

    await expect
      .element(emailInput())
      .toHaveAccessibleDescription('メールアドレスの形式が正しくありません。');
    await expect.element(sendButton()).toBeDisabled();
  });

  test('bot判定は管理者のパスワードの再設定の操作名の非表示のウィジェットで行う', async () => {
    await renderForm();

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'admin_password_reset',
      size: 'invisible',
    });
  });

  test('送信すると、前後の空白を除いたメールアドレスにbot判定のトークンを付けて送り、案内に切り替えてログイン画面へ導く', async () => {
    respond(accepted);
    await renderForm();

    await submitEmail(` ${EMAIL} `);

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(SENT_NOTICE);
    await expect.element(page.getByRole('status')).toHaveFocus();
    expect(requestForm().elements()).toHaveLength(0);
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      AdminRequestPasswordResetDocument,
      { email: EMAIL },
      { turnstileToken: 'turnstile-token-1' },
    );
    await expect
      .element(page.getByRole('link', { name: 'ログイン画面へ' }))
      .toHaveAttribute('href', '/auth/login');
  });

  test.each([
    ['有効な管理者', EMAIL],
    ['登録されていない', 'unknown@admin.example'],
    ['招待中の管理者', 'invited@admin.example'],
  ])(
    '%sのメールアドレスでも、管理者の有無を示さない同じ案内を出す',
    async (_label, email) => {
      respond(accepted);
      await renderForm();

      await submitEmail(email);

      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent(SENT_NOTICE);
    },
  );

  test('送信回数の上限などの失敗は、フォームの文言で示して入力を続けられる', async () => {
    const limited =
      '操作が集中しています。しばらく待ってから再度お試しください。';
    respond(() =>
      Promise.resolve({
        ok: false,
        error: new GraphQLClientError({
          code: 'rate_limit_exceeded',
          message: limited,
          status: 429,
        }),
      }),
    );
    await renderForm();

    await submitEmail(EMAIL);

    await expect
      .element(requestForm().getByRole('alert'))
      .toHaveTextContent(limited);
    await expect.element(emailInput()).toHaveValue(EMAIL);
    expect(page.getByRole('status').elements()).toHaveLength(0);
  });

  test('サーバーのメールアドレスの欄のエラーを入力欄に示す', async () => {
    respond(() =>
      Promise.resolve({
        ok: false,
        error: new GraphQLClientError({
          code: 'validation_error',
          message: '入力内容を確認してください。',
          status: 400,
          details: [
            {
              field: 'email',
              code: 'custom',
              message: 'メールアドレスの形式が正しくありません。',
            },
          ],
        }),
      }),
    );
    await renderForm();

    await submitEmail(EMAIL);

    await expect
      .element(emailInput())
      .toHaveAccessibleDescription('メールアドレスの形式が正しくありません。');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('入力と送信後の案内で、アクセシビリティの検査の違反が0件', async () => {
      respond(accepted);
      await renderForm();
      const before = await runAxe(document.body);

      await submitEmail(EMAIL);
      await expect.element(page.getByRole('status')).toBeVisible();

      expect(before).toStrictEqual([]);
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
