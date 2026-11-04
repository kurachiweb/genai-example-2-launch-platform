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
import { signedInAdminQuery } from '../../../test/admin-viewer-fixtures.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { adminViewerQueryOptions } from '../../graphql/admin-viewer.ts';
import {
  AdminCompleteSecondFactorLoginDocument,
  AdminLoginDocument,
  type AdminLoginMutation,
} from '../../graphql/generated/graphql.ts';
import { LoginForm } from './login-form.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../../lib/test/fake-turnstile.tsx'),
);

const PASSWORD = ['console', 'gate', 'keeper'].join('-');
const EMAIL = 'operator@admin.example';
const RETURN_TO = '/accounts?status=invited';
const CHALLENGE = ['challenge', 'of', 'admin'].join('-');
const LOGIN_PATH = '/auth/login';

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

const SECOND_FACTOR_REQUIRED: AdminLoginMutation = {
  adminLogin: { challenge: CHALLENGE, expiresAt: '2026-11-04T07:05:00.000Z' },
};

const signedIn = () => {
  const { adminViewer } = signedInAdminQuery();
  return Promise.resolve({
    ok: true,
    data: { completeAdminSecondFactorLogin: adminViewer },
  });
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
    if (document === AdminLoginDocument && login !== undefined) {
      return login();
    }
    if (
      document === AdminCompleteSecondFactorLoginDocument &&
      secondFactor !== undefined
    ) {
      return secondFactor();
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

const requireSecondFactor = (secondFactor?: () => Promise<unknown>) => {
  respond({
    login: () => Promise.resolve({ ok: true, data: SECOND_FACTOR_REQUIRED }),
    ...(secondFactor === undefined ? {} : { secondFactor }),
  });
};

async function renderForm() {
  const context = createPageRouterContext('local');
  const router = await renderInRouter(<LoginForm returnTo={RETURN_TO} />, {
    path: LOGIN_PATH,
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
  context.queryClient.getQueryState(adminViewerQueryOptions().queryKey)
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
  test('フォーカスを外した時に、APIと同じ文言のエラーを入力欄に関連付けて示す', async () => {
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

  test('bot判定は管理者のログインの操作名の非表示のウィジェットで行う', async () => {
    await renderForm();

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    expect(lastTurnstileProps().options).toMatchObject({
      action: 'admin_login',
      size: 'invisible',
    });
  });

  test('メールアドレスとパスワードをbot判定のトークンを付けて送り、同じ画面で認証コードの入力へ切り替えてフォーカスを移す', async () => {
    requireSecondFactor();
    const { router } = await renderForm();

    await submitPassword();

    await expect.element(totpInput()).toHaveFocus();
    expect(executeGraphQL).toHaveBeenCalledExactlyOnceWith(
      AdminLoginDocument,
      { email: EMAIL, password: PASSWORD },
      { turnstileToken: 'turnstile-token-1' },
    );
    expect(loginForm().elements()).toHaveLength(0);
    expect(recoveryInput().elements()).toHaveLength(0);
    expect(router.state.location.pathname).toBe(LOGIN_PATH);
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
    expect(router.state.location.pathname).toBe(LOGIN_PATH);
  });

  test('パスワードの再設定の画面への導線を持ち、登録の導線を持たない', async () => {
    await renderForm();

    await expect
      .element(page.getByRole('link', { name: 'パスワードの再設定' }))
      .toHaveAttribute('href', '/auth/password-reset');
    expect(page.getByRole('link').elements()).toHaveLength(1);
  });

  describe('第2要素', () => {
    test('認証コードだけを、challengeを足して送り、管理者の取得を無効にして戻り先へ移る', async () => {
      requireSecondFactor(signedIn);
      const { router, context } = await renderForm();

      await submitPassword();
      await userEvent.type(totpInput(), '123456');
      await userEvent.click(loginButton());

      await expect.poll(() => router.state.location.href).toBe(RETURN_TO);
      expect(executeGraphQL).toHaveBeenLastCalledWith(
        AdminCompleteSecondFactorLoginDocument,
        { challenge: CHALLENGE, secondFactor: { totpCode: '123456' } },
        { turnstileToken: undefined },
      );
      expect(viewerInvalidated(context)).toBe(true);
    });

    test('リカバリコードの入力へ切り替えると、入力途中の認証コードを送らずリカバリコードだけを送る', async () => {
      requireSecondFactor(signedIn);
      const { router } = await renderForm();

      await submitPassword();
      await userEvent.type(totpInput(), '12');
      await userEvent.click(
        page.getByRole('button', { name: 'リカバリコードを使う' }),
      );
      await expect.element(recoveryInput()).toHaveFocus();
      await userEvent.type(recoveryInput(), 'abcd-efgh');
      await userEvent.click(loginButton());

      await expect.poll(() => router.state.location.href).toBe(RETURN_TO);
      expect(totpInput().elements()).toHaveLength(0);
      expect(executeGraphQL).toHaveBeenLastCalledWith(
        AdminCompleteSecondFactorLoginDocument,
        { challenge: CHALLENGE, secondFactor: { recoveryCode: 'abcd-efgh' } },
        { turnstileToken: undefined },
      );
    });

    test('認証コードの入力へ戻すと、認証コードの欄を描き直してフォーカスを移し、認証コードだけを送る', async () => {
      requireSecondFactor(signedIn);
      const { router } = await renderForm();

      await submitPassword();
      await userEvent.click(
        page.getByRole('button', { name: 'リカバリコードを使う' }),
      );
      await userEvent.type(recoveryInput(), 'abcd-efgh');
      await userEvent.click(
        page.getByRole('button', { name: '認証コードを使う' }),
      );
      await expect.element(totpInput()).toHaveFocus();
      expect(recoveryInput().elements()).toHaveLength(0);
      await userEvent.type(totpInput(), '654321');
      await userEvent.click(loginButton());

      await expect.poll(() => router.state.location.href).toBe(RETURN_TO);
      expect(executeGraphQL).toHaveBeenLastCalledWith(
        AdminCompleteSecondFactorLoginDocument,
        { challenge: CHALLENGE, secondFactor: { totpCode: '654321' } },
        { turnstileToken: undefined },
      );
    });

    test('認証コードが正しくなければ、フォームの文言で示して入力を続けられる', async () => {
      requireSecondFactor(() =>
        failure('invalid_second_factor', '認証コードが正しくありません。', 401),
      );
      const { router } = await renderForm();

      await submitPassword();
      await userEvent.type(totpInput(), '000000');
      await userEvent.click(loginButton());

      await expect
        .element(alertIn(secondFactorForm()))
        .toHaveTextContent('認証コードが正しくありません。');
      await expect.element(totpInput()).toBeVisible();
      expect(router.state.location.pathname).toBe(LOGIN_PATH);
    });

    test('認証の有効期限が切れたら、文言を示してメールアドレスとパスワードの入力へ戻る', async () => {
      const expired =
        '認証の有効期限が切れました。もう一度ログインしてください。';
      requireSecondFactor(() =>
        failure('login_challenge_expired', expired, 401),
      );
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
      requireSecondFactor();
      await renderForm();
      const passwordStage = await runAxe(loginForm().element());

      await submitPassword();
      await expect.element(totpInput()).toHaveFocus();

      expect(passwordStage).toStrictEqual([]);
      expect(await runAxe(secondFactorForm().element())).toStrictEqual([]);
    });
  });
});
