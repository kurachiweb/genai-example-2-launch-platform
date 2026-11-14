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
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  CURRENT_PASSWORD,
  CURRENT_PASSWORD_INCORRECT,
  graphqlFailure,
  NEW_PASSWORD,
  passBotCheck,
  reauthenticationFailed,
} from '../../../test/settings-fixtures.ts';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import { ClientRequestPasswordChangeDocument } from '../../graphql/generated/graphql.ts';
import { PasswordChangeSection } from './password-change-section.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const SENT_MESSAGE =
  '現在のメールアドレスに確認のリンクを送信しました。リンクの有効期限は30分です。リンクの画面で確定するまで、パスワードは変わりません。';
const PASSWORD_REJECTED =
  'このパスワードは過去に漏洩したことがあります。別のパスワードを設定してください。';

const passwordForm = () => page.getByRole('form', { name: 'パスワードの変更' });
const newPasswordInput = () =>
  page.getByLabelText('新しいパスワード(必須)', { exact: true });
const currentPasswordInput = () =>
  page.getByLabelText('現在のパスワード(必須)', { exact: true });
const totpInput = () => page.getByRole('textbox', { name: '認証コード(必須)' });
const submitButton = () =>
  page.getByRole('button', { name: 'パスワードを変更する' });

function respond(result: () => Promise<unknown>): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientRequestPasswordChangeDocument) {
      return result();
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

interface RenderOptions {
  readonly totpEnabled?: boolean;
  readonly disabled?: boolean;
}

async function renderSection({
  totpEnabled = false,
  disabled = false,
}: RenderOptions = {}): Promise<void> {
  await renderInRouter(
    <PasswordChangeSection totpEnabled={totpEnabled} disabled={disabled} />,
    {
      path: '/settings/account',
      context: createPageRouterContext('local'),
      cachedViewer: signedInViewerQuery({ totpEnabled }),
    },
  );
}

async function fillAndSubmit(): Promise<void> {
  await userEvent.type(newPasswordInput(), NEW_PASSWORD);
  await userEvent.type(currentPasswordInput(), CURRENT_PASSWORD);
  passBotCheck();
  await userEvent.click(submitButton());
}

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('PasswordChangeSection', () => {
  test('新しいパスワードの文字数を、フォーカスを外した時に文言規則のエラーで示す', async () => {
    await renderSection();

    await userEvent.type(newPasswordInput(), 'short');
    await userEvent.tab();

    await expect
      .element(newPasswordInput())
      .toHaveAccessibleDescription(
        '8文字以上128文字以内で設定してください。 パスワードは8文字以上128文字以内で入力してください。',
      );
    await expect.element(submitButton()).toBeDisabled();
  });

  test('bot判定はパスワード変更の操作名の非表示のウィジェットで行う', async () => {
    await renderSection();

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'password_change',
      size: 'invisible',
    });
  });

  test('送信すると、bot判定のトークンを付けて新しいパスワードと本人確認を送り、送信後の案内を示して入力を空にする', async () => {
    respond(() =>
      Promise.resolve({ ok: true, data: { requestPasswordChange: true } }),
    );
    await renderSection();

    await fillAndSubmit();

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(SENT_MESSAGE);
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientRequestPasswordChangeDocument,
      {
        input: {
          newPassword: NEW_PASSWORD,
          reAuthentication: { currentPassword: CURRENT_PASSWORD },
        },
      },
      { turnstileToken: 'turnstile-token-1' },
    );
    await expect.element(newPasswordInput()).toHaveValue('');
  });

  test('新しいパスワードの拒否は新しいパスワードの欄に、現在のパスワードの誤りは現在のパスワードの欄に示す', async () => {
    respond(() =>
      graphqlFailure({
        code: 'password_rejected',
        message: PASSWORD_REJECTED,
        status: 422,
        details: [
          {
            field: 'input.newPassword',
            code: 'pwned',
            message: PASSWORD_REJECTED,
          },
        ],
      }),
    );
    await renderSection();

    await fillAndSubmit();

    await expect
      .element(newPasswordInput())
      .toHaveAccessibleDescription(
        `8文字以上128文字以内で設定してください。 ${PASSWORD_REJECTED}`,
      );

    respond(() =>
      reauthenticationFailed(
        'input.reAuthentication.currentPassword',
        'incorrect',
        CURRENT_PASSWORD_INCORRECT,
      ),
    );
    await userEvent.type(newPasswordInput(), '-2');
    passBotCheck();
    await userEvent.click(submitButton());

    await expect
      .element(currentPasswordInput())
      .toHaveAccessibleDescription(CURRENT_PASSWORD_INCORRECT);
  });

  test('第2要素を送らなかった時の詳細は、フォーム全体の失敗として示し、送信ボタンを無効のまま残さない', async () => {
    respond(() =>
      reauthenticationFailed(
        'input.reAuthentication.secondFactor',
        'required',
        '認証コードが正しくありません。',
      ),
    );
    await renderSection();

    await fillAndSubmit();

    await expect
      .element(passwordForm().getByRole('alert'))
      .toHaveTextContent('認証コードが正しくありません。');
    await expect.element(submitButton()).toBeEnabled();
  });

  test('多要素認証が有効なら認証コードの欄を描き、無効にすると各欄と送信ボタンを無効にする', async () => {
    await renderSection({ totpEnabled: true, disabled: true });

    await expect.element(newPasswordInput()).toBeDisabled();
    await expect.element(currentPasswordInput()).toBeDisabled();
    await expect.element(totpInput()).toBeDisabled();
    await expect.element(submitButton()).toBeDisabled();
    expect(page.getByTestId('fake-turnstile').elements()).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('アクセシビリティの検査の違反が0件', async () => {
      await renderSection({ totpEnabled: true });
      await expect.element(passwordForm()).toBeVisible();

      expect(await runAxe(passwordForm().element())).toStrictEqual([]);
    });
  });
});
