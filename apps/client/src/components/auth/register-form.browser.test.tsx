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
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { ClientRegisterUserDocument } from '../../graphql/generated/graphql.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';
import { RegisterForm } from './register-form.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const PASSWORD = ['pitch', 'notes', 'launch'].join('-');
const EMAIL = 'maker@launch.example';
const AGREEMENT_NAME =
  '利用規約とプライバシーポリシーに同意し、18歳以上であることを表明する(必須)';

const form = () => page.getByRole('form', { name: 'ユーザー登録' });
const nicknameInput = () =>
  page.getByRole('textbox', { name: 'ニックネーム(必須)' });
const emailInput = () =>
  page.getByRole('textbox', { name: 'メールアドレス(必須)' });
const passwordInput = () => page.getByLabelText('パスワード(必須)');
const agreement = () => page.getByRole('checkbox', { name: AGREEMENT_NAME });
const submitButton = () => page.getByRole('button', { name: '登録する' });
const alert = () => form().getByRole('alert');

async function renderForm() {
  const context = createPageRouterContext('local');
  const router = await renderInRouter(<RegisterForm />, {
    path: '/auth/register',
    context,
  });
  return { router, context };
}

async function fillValidInput(): Promise<void> {
  await userEvent.type(nicknameInput(), ' ピッチの作り手　');
  await userEvent.type(emailInput(), EMAIL);
  await userEvent.type(passwordInput(), PASSWORD);
  await userEvent.click(agreement());
}

// 前の欄から離れた時に出るエラーで同意の欄の位置が押している間に動き、ポインターの押下が失われるため、キーボードで操作する
async function toggleAgreementTwiceByKeyboard(): Promise<void> {
  agreement().element().focus();
  await userEvent.keyboard('  ');
}

async function passBotCheck(): Promise<void> {
  await userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));
}

const registered = () =>
  Promise.resolve({ ok: true, data: { registerUser: { id: 'user-1' } } });

const rejectWith = (error: GraphQLClientError) =>
  Promise.resolve({ ok: false, error });

const BOT_FAILURE_MESSAGE =
  '認証に失敗しました。ページを再読み込みして再度お試しください。';

const botVerificationFailed = () =>
  new GraphQLClientError({
    code: 'bot_verification_failed',
    message: BOT_FAILURE_MESSAGE,
    status: 200,
  });

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('RegisterForm', () => {
  test('フォーカスを外した時に、欄ごとに文言規則のエラーを入力欄に関連付けて示す', async () => {
    await renderForm();

    await userEvent.click(nicknameInput());
    await userEvent.type(emailInput(), 'maker@');
    await userEvent.type(passwordInput(), 'short');
    await toggleAgreementTwiceByKeyboard();
    await userEvent.tab();

    await expect
      .element(nicknameInput())
      .toHaveAccessibleDescription('ニックネームを入力してください。');
    await expect
      .element(nicknameInput())
      .toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(emailInput())
      .toHaveAccessibleDescription('メールアドレスの形式が正しくありません。');
    await expect
      .element(passwordInput())
      .toHaveAccessibleDescription(
        expect.stringContaining(
          'パスワードは8文字以上128文字以内で入力してください。',
        ) as string,
      );
    await expect
      .element(agreement())
      .toHaveAccessibleDescription(
        '利用規約とプライバシーポリシーに同意してください。',
      );
    await expect.element(submitButton()).toBeDisabled();
  });

  test('同意は既定で未選択で、18歳以上の表明と、利用規約・プライバシーポリシーへのリンクを持つ', async () => {
    await renderForm();

    await expect.element(agreement()).not.toBeChecked();
    await expect
      .element(form().getByRole('link', { name: '利用規約' }))
      .toHaveAttribute('href', '/terms');
    await expect
      .element(form().getByRole('link', { name: 'プライバシーポリシー' }))
      .toHaveAttribute('href', '/privacy');
  });

  test('同意はキーボードで選択できる', async () => {
    await renderForm();

    agreement().element().focus();
    await userEvent.keyboard(' ');

    await expect.element(agreement()).toBeChecked();
  });

  test('bot判定は登録の操作名の非表示のウィジェットで行い、判定の枠を画面に出さない', async () => {
    await renderForm();

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    const { width, height } = page
      .getByTestId('fake-turnstile')
      .element()
      .getBoundingClientRect();
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'register',
      size: 'invisible',
    });
    expect({ width, height }).toEqual({ width: 0, height: 0 });
  });

  test('送信すると、前後の空白を除いた入力とbot判定のトークンで登録し、利用者の取得を無効にしてトップページへ移る', async () => {
    executeGraphQL.mockImplementation(registered);
    const { router, context } = await renderForm();
    context.queryClient.setQueryData(viewerQueryOptions().queryKey, {
      viewer: null,
    });

    await fillValidInput();
    await passBotCheck();
    await userEvent.click(submitButton());

    await expect.poll(() => router.state.location.pathname).toBe('/');
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientRegisterUserDocument,
      {
        input: {
          nickname: 'ピッチの作り手',
          email: EMAIL,
          password: PASSWORD,
          agreedToTerms: true,
        },
      },
      { turnstileToken: 'turnstile-token-1' },
    );
    expect(
      context.queryClient.getQueryState(viewerQueryOptions().queryKey)
        ?.isInvalidated,
    ).toBe(true);
  });

  test('サーバーが返した欄ごとの詳細を、入力の名前を外した欄のエラーにしてその欄へフォーカスを移す', async () => {
    const pwned =
      'このパスワードは過去に漏洩したことがあります。別のパスワードを設定してください。';
    executeGraphQL.mockImplementation(() =>
      rejectWith(
        new GraphQLClientError({
          code: 'password_rejected',
          message: pwned,
          status: 422,
          details: [{ field: 'input.password', message: pwned, code: 'pwned' }],
        }),
      ),
    );
    await renderForm();

    await fillValidInput();
    await passBotCheck();
    await userEvent.click(submitButton());

    await expect
      .element(passwordInput())
      .toHaveAccessibleDescription(expect.stringContaining(pwned) as string);
    await expect.element(passwordInput()).toHaveFocus();
    expect(alert().elements()).toHaveLength(0);
  });

  test('欄に対応しない失敗は、フォームの文言で示す', async () => {
    executeGraphQL.mockImplementation(() =>
      rejectWith(
        new GraphQLClientError({
          code: 'registration_email_unavailable',
          message: 'このメールアドレスは登録できません。',
          status: 409,
        }),
      ),
    );
    const { router } = await renderForm();

    await fillValidInput();
    await passBotCheck();
    await userEvent.click(submitButton());

    await expect
      .element(alert())
      .toHaveTextContent('このメールアドレスは登録できません。');
    expect(router.state.location.pathname).toBe('/auth/register');
    expect(executeGraphQL).toHaveBeenCalledOnce();
  });

  test('bot判定のトークンが届く前の送信がbot判定に失敗すると、届いたトークンで1回だけ送り直して登録する', async () => {
    executeGraphQL
      .mockImplementationOnce(() => rejectWith(botVerificationFailed()))
      .mockImplementationOnce(registered);
    const { router } = await renderForm();

    await fillValidInput();
    await userEvent.click(submitButton());
    await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
    await passBotCheck();

    await expect.poll(() => router.state.location.pathname).toBe('/');
    expect(executeGraphQL).toHaveBeenCalledTimes(2);
    expect(executeGraphQL).toHaveBeenNthCalledWith(
      1,
      ClientRegisterUserDocument,
      expect.anything(),
      { turnstileToken: undefined },
    );
    expect(executeGraphQL).toHaveBeenNthCalledWith(
      2,
      ClientRegisterUserDocument,
      expect.anything(),
      { turnstileToken: 'turnstile-token-1' },
    );
  });

  test('送り直しもbot判定に失敗すると、それ以上送らずにフォームの文言で示す', async () => {
    executeGraphQL.mockImplementation(() =>
      rejectWith(botVerificationFailed()),
    );
    const { router } = await renderForm();

    await fillValidInput();
    await passBotCheck();
    await userEvent.click(submitButton());
    await expect.poll(() => executeGraphQL.mock.calls.length).toBe(1);
    await passBotCheck();

    await expect.element(alert()).toHaveTextContent(BOT_FAILURE_MESSAGE);
    expect(executeGraphQL).toHaveBeenCalledTimes(2);
    expect(router.state.location.pathname).toBe('/auth/register');
  });

  test('想定外の失敗は、例外の文言を出さず問い合わせを促す文言で示す', async () => {
    executeGraphQL.mockRejectedValue(new TypeError('Failed to fetch'));
    await renderForm();

    await fillValidInput();
    await passBotCheck();
    await userEvent.click(submitButton());

    await expect
      .element(alert())
      .toHaveTextContent(
        'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。',
      );
  });

  test('ログイン画面への導線を持つ', async () => {
    await renderForm();

    await expect
      .element(page.getByRole('link', { name: 'ログイン' }))
      .toHaveAttribute('href', '/auth/login');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('入力前とエラーの表示中に、アクセシビリティの検査の違反が0件', async () => {
      await renderForm();
      const container = form().element();
      const initial = await runAxe(container);

      await userEvent.click(nicknameInput());
      await toggleAgreementTwiceByKeyboard();
      await userEvent.tab();
      await expect.element(agreement()).toHaveAttribute('aria-invalid', 'true');

      expect(initial).toStrictEqual([]);
      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
