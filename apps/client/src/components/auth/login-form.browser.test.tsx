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
import {
  ClientCompleteSecondFactorLoginDocument,
  ClientLoginDocument,
  type ClientLoginMutation,
} from '../../graphql/generated/graphql.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';
import { LoginForm } from './login-form.tsx';

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
const RETURN_TO = '/settings/account?tab=email';
const CHALLENGE = ['challenge', 'of', 'login'].join('-');

const loginForm = () => page.getByRole('form', { name: 'ログイン' });
const secondFactorForm = () =>
  page.getByRole('form', { name: '認証コードの入力' });
const emailInput = () => page.getByRole('textbox', { name: 'メールアドレス' });
const passwordInput = () => page.getByLabelText('パスワード', { exact: true });
const totpInput = () => page.getByRole('textbox', { name: '認証コード' });
const recoveryInput = () =>
  page.getByRole('textbox', { name: 'リカバリコード' });
const loginButton = () => page.getByRole('button', { name: 'ログインする' });
const alertIn = (form: ReturnType<typeof loginForm>) => form.getByRole('alert');

const SUCCEEDED: ClientLoginMutation = {
  login: { __typename: 'LoginSucceeded', viewer: { id: 'user-1' } },
};

const SECOND_FACTOR_REQUIRED: ClientLoginMutation = {
  login: {
    __typename: 'SecondFactorRequired',
    challenge: CHALLENGE,
    expiresAt: '2026-11-02T07:05:00.000Z',
  },
};

const failure = (code: string, message: string, status: number) =>
  Promise.resolve({
    ok: false,
    error: new GraphQLClientError({ code, message, status }),
  });

interface Responses {
  readonly login?: () => Promise<unknown>;
  readonly secondFactor?: () => Promise<unknown>;
}

function respond({ login, secondFactor }: Responses): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === ClientLoginDocument && login !== undefined) {
      return login();
    }
    if (
      document === ClientCompleteSecondFactorLoginDocument &&
      secondFactor !== undefined
    ) {
      return secondFactor();
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

async function renderForm() {
  const context = createPageRouterContext('local');
  context.queryClient.setQueryData(viewerQueryOptions().queryKey, {
    viewer: null,
  });
  const router = await renderInRouter(<LoginForm returnTo={RETURN_TO} />, {
    path: '/auth/login',
    context,
  });
  return { router, context };
}

async function submitPassword(): Promise<void> {
  await userEvent.type(emailInput(), EMAIL);
  await userEvent.type(passwordInput(), PASSWORD);
  await userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));
  await userEvent.click(loginButton());
}

const viewerInvalidated = (
  context: ReturnType<typeof createPageRouterContext>,
) =>
  context.queryClient.getQueryState(viewerQueryOptions().queryKey)
    ?.isInvalidated;

beforeEach(() => {
  executeGraphQL.mockReset();
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('LoginForm', () => {
  test('フォーカスを外した時に、文言規則のエラーを入力欄に関連付けて示す', async () => {
    await renderForm();

    await userEvent.click(emailInput());
    await userEvent.click(passwordInput());
    await userEvent.tab();

    await expect
      .element(emailInput())
      .toHaveAccessibleDescription('メールアドレスを入力してください。');
    await expect
      .element(passwordInput())
      .toHaveAccessibleDescription('パスワードを入力してください。');
    await expect.element(loginButton()).toBeDisabled();
  });

  test('bot判定はログインの操作名の非表示のウィジェットで行う', async () => {
    await renderForm();

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'login',
      size: 'invisible',
    });
  });

  test('ログインに成功すると、bot判定のトークンを付けて送り、利用者の取得を無効にして戻り先へ移る', async () => {
    respond({ login: () => Promise.resolve({ ok: true, data: SUCCEEDED }) });
    const { router, context } = await renderForm();

    await submitPassword();

    await expect.poll(() => router.state.location.href).toBe(RETURN_TO);
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      ClientLoginDocument,
      { input: { email: EMAIL, password: PASSWORD } },
      { turnstileToken: 'turnstile-token-1' },
    );
    expect(viewerInvalidated(context)).toBe(true);
  });

  test('照合に失敗すると、フォームの文言で示して画面に留まる', async () => {
    respond({
      login: () =>
        failure(
          'invalid_credentials',
          'メールアドレスまたはパスワードが正しくありません。',
          401,
        ),
    });
    const { router } = await renderForm();

    await submitPassword();

    await expect
      .element(alertIn(loginForm()))
      .toHaveTextContent('メールアドレスまたはパスワードが正しくありません。');
    expect(router.state.location.pathname).toBe('/auth/login');
  });

  test('登録とパスワードの再設定の画面への導線を持つ', async () => {
    await renderForm();

    await expect
      .element(page.getByRole('link', { name: '登録' }))
      .toHaveAttribute('href', '/auth/register');
    await expect
      .element(page.getByRole('link', { name: 'パスワードの再設定' }))
      .toHaveAttribute('href', '/auth/password-reset');
  });

  describe('第2要素', () => {
    test('第2要素が必要なら、同じ画面で認証コードの入力へ切り替え、入力欄へフォーカスを移す', async () => {
      respond({
        login: () =>
          Promise.resolve({ ok: true, data: SECOND_FACTOR_REQUIRED }),
      });
      const { router } = await renderForm();

      await submitPassword();

      await expect.element(totpInput()).toHaveFocus();
      expect(loginForm().elements()).toHaveLength(0);
      expect(recoveryInput().elements()).toHaveLength(0);
      expect(router.state.location.pathname).toBe('/auth/login');
    });

    test('認証コードだけを、challengeを足して送り、ログインして戻り先へ移る', async () => {
      respond({
        login: () =>
          Promise.resolve({ ok: true, data: SECOND_FACTOR_REQUIRED }),
        secondFactor: () =>
          Promise.resolve({
            ok: true,
            data: { completeSecondFactorLogin: { id: 'user-1' } },
          }),
      });
      const { router, context } = await renderForm();

      await submitPassword();
      await userEvent.type(totpInput(), '123456');
      await userEvent.click(loginButton());

      await expect.poll(() => router.state.location.href).toBe(RETURN_TO);
      expect(executeGraphQL).toHaveBeenLastCalledWith(
        ClientCompleteSecondFactorLoginDocument,
        {
          input: { challenge: CHALLENGE, secondFactor: { totpCode: '123456' } },
        },
        { turnstileToken: undefined },
      );
      expect(viewerInvalidated(context)).toBe(true);
    });

    test('リカバリコードの入力へ切り替えると、リカバリコードだけを送る', async () => {
      respond({
        login: () =>
          Promise.resolve({ ok: true, data: SECOND_FACTOR_REQUIRED }),
        secondFactor: () =>
          Promise.resolve({
            ok: true,
            data: { completeSecondFactorLogin: { id: 'user-1' } },
          }),
      });
      const { router } = await renderForm();

      await submitPassword();
      await userEvent.type(totpInput(), '12');
      await userEvent.click(
        page.getByRole('button', { name: 'リカバリコードを使う' }),
      );
      await userEvent.type(recoveryInput(), 'abcd-efgh');
      await userEvent.click(loginButton());

      await expect.poll(() => router.state.location.href).toBe(RETURN_TO);
      expect(totpInput().elements()).toHaveLength(0);
      expect(executeGraphQL).toHaveBeenLastCalledWith(
        ClientCompleteSecondFactorLoginDocument,
        {
          input: {
            challenge: CHALLENGE,
            secondFactor: { recoveryCode: 'abcd-efgh' },
          },
        },
        { turnstileToken: undefined },
      );
    });

    test('認証コードの入力へ戻すと、認証コードの欄を描き直す', async () => {
      respond({
        login: () =>
          Promise.resolve({ ok: true, data: SECOND_FACTOR_REQUIRED }),
      });
      await renderForm();

      await submitPassword();
      await userEvent.click(
        page.getByRole('button', { name: 'リカバリコードを使う' }),
      );
      await userEvent.click(
        page.getByRole('button', { name: '認証コードを使う' }),
      );

      await expect.element(totpInput()).toBeVisible();
      expect(recoveryInput().elements()).toHaveLength(0);
    });

    test('認証コードが正しくなければ、フォームの文言で示して入力を続けられる', async () => {
      respond({
        login: () =>
          Promise.resolve({ ok: true, data: SECOND_FACTOR_REQUIRED }),
        secondFactor: () =>
          failure(
            'invalid_second_factor',
            '認証コードが正しくありません。',
            401,
          ),
      });
      await renderForm();

      await submitPassword();
      await userEvent.type(totpInput(), '000000');
      await userEvent.click(loginButton());

      await expect
        .element(alertIn(secondFactorForm()))
        .toHaveTextContent('認証コードが正しくありません。');
      await expect.element(totpInput()).toBeVisible();
    });

    test('認証の有効期限が切れたら、文言を示してメールアドレスとパスワードの入力へ戻る', async () => {
      const expired =
        '認証の有効期限が切れました。もう一度ログインしてください。';
      respond({
        login: () =>
          Promise.resolve({ ok: true, data: SECOND_FACTOR_REQUIRED }),
        secondFactor: () => failure('login_challenge_expired', expired, 401),
      });
      await renderForm();

      await submitPassword();
      await userEvent.type(totpInput(), '123456');
      await userEvent.click(loginButton());

      await expect.element(alertIn(loginForm())).toHaveTextContent(expired);
      await expect.element(emailInput()).toHaveValue(EMAIL);
      await expect.element(passwordInput()).toHaveFocus();
    });
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('パスワードと第2要素の段階で、アクセシビリティの検査の違反が0件', async () => {
      respond({
        login: () =>
          Promise.resolve({ ok: true, data: SECOND_FACTOR_REQUIRED }),
      });
      await renderForm();
      const passwordStage = await runAxe(loginForm().element());

      await submitPassword();
      await expect.element(totpInput()).toHaveFocus();

      expect(passwordStage).toStrictEqual([]);
      expect(await runAxe(secondFactorForm().element())).toStrictEqual([]);
    });
  });
});
