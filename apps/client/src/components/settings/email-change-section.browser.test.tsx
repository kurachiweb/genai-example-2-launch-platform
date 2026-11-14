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
  passBotCheck,
  reauthenticationFailed,
  SECOND_FACTOR_INCORRECT,
} from '../../../test/settings-fixtures.ts';
import {
  signedInViewerQuery,
  viewerResult,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientRequestEmailChangeDocument,
  ClientViewerDocument,
} from '../../graphql/generated/graphql.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';
import { EmailChangeSection } from './email-change-section.tsx';

const TOTP_CODE_DESCRIPTION =
  '認証アプリに表示されている6桁の認証コードを入力してください。';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const NEW_EMAIL = 'new-maker@launch.example';
const SENT_MESSAGE =
  '入力したメールアドレスが他のアカウントで使われていない場合は、確認のリンクを送信しました。リンクの有効期限は24時間です。';

const emailForm = () =>
  page.getByRole('form', { name: 'メールアドレスの変更' });
const newEmailInput = () =>
  page.getByRole('textbox', { name: '新しいメールアドレス(必須)' });
const currentPasswordInput = () =>
  page.getByLabelText('現在のパスワード(必須)', { exact: true });
const totpInput = () => page.getByRole('textbox', { name: '認証コード(必須)' });
const recoveryInput = () =>
  page.getByRole('textbox', { name: 'リカバリコード(必須)' });
const submitButton = () =>
  page.getByRole('button', { name: 'メールアドレスを変更する' });

function respond(result: () => Promise<unknown>): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientRequestEmailChangeDocument) {
      return result();
    }
    if (document === ClientViewerDocument) {
      return Promise.resolve(
        viewerResult(signedInViewerQuery({ totpEnabled: true })),
      );
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

const succeeded = () =>
  Promise.resolve({ ok: true, data: { requestEmailChange: true } });

interface RenderOptions {
  readonly totpEnabled?: boolean;
  readonly disabled?: boolean;
}

async function renderSection({
  totpEnabled = false,
  disabled = false,
}: RenderOptions = {}) {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <EmailChangeSection totpEnabled={totpEnabled} disabled={disabled} />,
    {
      path: '/settings/account',
      context,
      cachedViewer: signedInViewerQuery({ totpEnabled }),
    },
  );
  return { context };
}

async function fillAndSubmit(): Promise<void> {
  await userEvent.type(newEmailInput(), NEW_EMAIL);
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

describe('EmailChangeSection', () => {
  test('多要素認証が無効なら、本人確認は現在のパスワードだけを描く', async () => {
    await renderSection();

    await expect.element(newEmailInput()).toBeVisible();
    await expect.element(currentPasswordInput()).toBeVisible();
    expect(totpInput().elements()).toHaveLength(0);
    expect(recoveryInput().elements()).toHaveLength(0);
  });

  test('フォーカスを外した時に、文言規則のエラーを入力欄に関連付けて示す', async () => {
    await renderSection();

    await userEvent.click(newEmailInput());
    await userEvent.click(currentPasswordInput());
    await userEvent.tab();

    await expect
      .element(newEmailInput())
      .toHaveAccessibleDescription('メールアドレスを入力してください。');
    await expect
      .element(currentPasswordInput())
      .toHaveAccessibleDescription('パスワードを入力してください。');
    await expect.element(submitButton()).toBeDisabled();
  });

  test('bot判定はメールアドレス変更の操作名の非表示のウィジェットで行う', async () => {
    await renderSection();

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'email_change',
      size: 'invisible',
    });
  });

  test('送信すると、bot判定のトークンを付けて新しいメールアドレスと本人確認を送り、送信後の案内を示して入力を空にする', async () => {
    respond(succeeded);
    await renderSection();

    await fillAndSubmit();

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(SENT_MESSAGE);
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientRequestEmailChangeDocument,
      {
        input: {
          newEmail: NEW_EMAIL,
          reAuthentication: { currentPassword: CURRENT_PASSWORD },
        },
      },
      { turnstileToken: 'turnstile-token-1' },
    );
    await expect.element(newEmailInput()).toHaveValue('');
    await expect.element(currentPasswordInput()).toHaveValue('');
  });

  test('現在のパスワードの誤りは、現在のパスワードの欄に示し、入力し直すと送信できる', async () => {
    respond(() =>
      reauthenticationFailed(
        'input.reAuthentication.currentPassword',
        'incorrect',
        CURRENT_PASSWORD_INCORRECT,
      ),
    );
    await renderSection();

    await fillAndSubmit();

    await expect
      .element(currentPasswordInput())
      .toHaveAccessibleDescription(CURRENT_PASSWORD_INCORRECT);
    await expect.element(currentPasswordInput()).toHaveFocus();
    expect(emailForm().getByRole('alert').elements()).toHaveLength(0);

    await userEvent.type(currentPasswordInput(), '-again');

    await expect.element(submitButton()).toBeEnabled();
  });

  describe('多要素認証が有効なとき', () => {
    test('認証コードの欄を描き、認証コードだけを送る', async () => {
      respond(succeeded);
      await renderSection({ totpEnabled: true });

      await userEvent.type(newEmailInput(), NEW_EMAIL);
      await userEvent.type(currentPasswordInput(), CURRENT_PASSWORD);
      await userEvent.type(totpInput(), '123456');
      passBotCheck();
      await userEvent.click(submitButton());

      await expect.element(page.getByRole('status')).toBeVisible();
      expect(recoveryInput().elements()).toHaveLength(0);
      expect(executeGraphQL).toHaveBeenCalledWith(
        ClientRequestEmailChangeDocument,
        {
          input: {
            newEmail: NEW_EMAIL,
            reAuthentication: {
              currentPassword: CURRENT_PASSWORD,
              secondFactor: { totpCode: '123456' },
            },
          },
        },
        { turnstileToken: 'turnstile-token-1' },
      );
    });

    test('リカバリコードの入力へ切り替えると、リカバリコードだけを送り、切り替えた欄へフォーカスを移す', async () => {
      respond(succeeded);
      await renderSection({ totpEnabled: true });

      await userEvent.type(newEmailInput(), NEW_EMAIL);
      await userEvent.type(currentPasswordInput(), CURRENT_PASSWORD);
      await userEvent.type(totpInput(), '12');
      await userEvent.click(
        page.getByRole('button', { name: 'リカバリコードを使う' }),
      );

      await expect.element(recoveryInput()).toHaveFocus();
      expect(totpInput().elements()).toHaveLength(0);

      await userEvent.type(recoveryInput(), 'abcd-efgh');
      passBotCheck();
      await userEvent.click(submitButton());

      await expect.element(page.getByRole('status')).toBeVisible();
      expect(executeGraphQL).toHaveBeenCalledWith(
        ClientRequestEmailChangeDocument,
        {
          input: {
            newEmail: NEW_EMAIL,
            reAuthentication: {
              currentPassword: CURRENT_PASSWORD,
              secondFactor: { recoveryCode: 'abcd-efgh' },
            },
          },
        },
        { turnstileToken: 'turnstile-token-1' },
      );
    });

    test('第2要素の誤りは、描いている第2要素の欄に示す', async () => {
      respond(() =>
        reauthenticationFailed(
          'input.reAuthentication.secondFactor.totpCode',
          'incorrect',
          SECOND_FACTOR_INCORRECT,
        ),
      );
      await renderSection({ totpEnabled: true });

      await userEvent.type(newEmailInput(), NEW_EMAIL);
      await userEvent.type(currentPasswordInput(), CURRENT_PASSWORD);
      await userEvent.type(totpInput(), '000000');
      passBotCheck();
      await userEvent.click(submitButton());

      await expect
        .element(totpInput())
        .toHaveAccessibleDescription(
          `${TOTP_CODE_DESCRIPTION} ${SECOND_FACTOR_INCORRECT}`,
        );
      expect(emailForm().getByRole('alert').elements()).toHaveLength(0);
    });
  });

  test('第2要素を送らなかった時の詳細は、フォーム全体の失敗として示し、送信ボタンを無効のまま残さず、利用者を取得し直す', async () => {
    respond(() =>
      reauthenticationFailed(
        'input.reAuthentication.secondFactor',
        'required',
        SECOND_FACTOR_INCORRECT,
      ),
    );
    const { context } = await renderSection();

    await fillAndSubmit();

    await expect
      .element(emailForm().getByRole('alert'))
      .toHaveTextContent(SECOND_FACTOR_INCORRECT);
    await expect.element(submitButton()).toBeEnabled();
    expect(
      context.queryClient.getQueryState(viewerQueryOptions().queryKey)
        ?.isInvalidated,
    ).toBe(true);
  });

  test('無効にすると、各欄と送信ボタンを無効にし、bot判定のウィジェットを描かない', async () => {
    await renderSection({ totpEnabled: true, disabled: true });

    await expect.element(newEmailInput()).toBeDisabled();
    await expect.element(currentPasswordInput()).toBeDisabled();
    await expect.element(totpInput()).toBeDisabled();
    await expect
      .element(page.getByRole('button', { name: 'リカバリコードを使う' }))
      .toBeDisabled();
    await expect.element(submitButton()).toBeDisabled();
    expect(page.getByTestId('fake-turnstile').elements()).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test.each([false, true])(
      '多要素認証が有効で、無効にするかが%sの時に、アクセシビリティの検査の違反が0件',
      async (disabled) => {
        await renderSection({ totpEnabled: true, disabled });
        await expect.element(emailForm()).toBeVisible();

        expect(await runAxe(emailForm().element())).toStrictEqual([]);
      },
    );
  });
});
