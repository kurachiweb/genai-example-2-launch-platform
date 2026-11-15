import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { reportUnexpectedErrorInBrowser } from '../../../lib/start/observability/browser-error-reporting.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import {
  adminViewerResult,
  GUEST_ADMIN_QUERY,
  signedInAdminQuery,
} from '../../../test/admin-viewer-fixtures.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { adminViewerQueryOptions } from '../../graphql/admin-viewer.ts';
import {
  AdminResetPasswordDocument,
  AdminViewerDocument,
} from '../../graphql/generated/graphql.ts';
import { NewPasswordForm } from './new-password-form.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKEN = ['reset', 'link', 'value'].join('_');
const NEW_PASSWORD = ['console', 'gate', 'keeper'].join('-');
const INVALID_LINK_MESSAGE = 'このリンクは無効か、有効期限が切れています。';
const DONE_MESSAGE =
  'パスワードを再設定しました。新しいパスワードでログインしてください。';
const PATH = '/auth/password-reset/confirm';

const resetForm = () =>
  page.getByRole('form', { name: '新しいパスワードの設定' });
const passwordInput = () =>
  page.getByLabelText('新しいパスワード(必須)', { exact: true });
const resetButton = () =>
  page.getByRole('button', { name: 'パスワードを再設定する' });

function respond(result: () => Promise<unknown>): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === AdminResetPasswordDocument) {
      return result();
    }
    if (document === AdminViewerDocument) {
      return Promise.resolve(adminViewerResult(GUEST_ADMIN_QUERY));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

const failure = (init: ConstructorParameters<typeof GraphQLClientError>[0]) =>
  Promise.resolve({ ok: false, error: new GraphQLClientError(init) });

const resetDone = () =>
  Promise.resolve({ ok: true, data: { resetAdminPassword: true } });

async function renderAt(hash: string) {
  const context = createPageRouterContext('local');
  const router = await renderInRouter(<NewPasswordForm />, {
    path: `${PATH}${hash}`,
    context,
    cachedViewer: signedInAdminQuery(),
  });
  return { router, context };
}

async function submitPassword(): Promise<void> {
  await userEvent.type(passwordInput(), NEW_PASSWORD);
  await userEvent.click(resetButton());
}

beforeEach(() => {
  executeGraphQL.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('NewPasswordForm', () => {
  test('フラグメントからトークンを読んでフラグメントを消し、開いただけでは送信しない', async () => {
    const { router } = await renderAt(`#token=${TOKEN}`);

    await expect.element(passwordInput()).toBeVisible();
    await expect.poll(() => router.history.location.hash).toBe('');
    expect(router.state.location.hash).toBe('');
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('新しいパスワードはフォーカスを外した時に文字数を検証して入力欄に示し、新しいパスワードとして入力させる', async () => {
    await renderAt(`#token=${TOKEN}`);

    await userEvent.type(passwordInput(), 'short');
    await userEvent.tab();

    await expect
      .element(passwordInput())
      .toHaveAccessibleDescription(
        '8文字以上128文字以内で設定してください。 パスワードは8文字以上128文字以内で入力してください。',
      );
    await expect
      .element(passwordInput())
      .toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(passwordInput())
      .toHaveAttribute('autocomplete', 'new-password');
    await expect.element(resetButton()).toBeDisabled();
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('トークンをスキーマの入力に含めず送信の時に足して送り、管理者の取得を無効にしてログインへ案内する', async () => {
    respond(resetDone);
    const { context } = await renderAt(`#token=${TOKEN}`);

    await submitPassword();

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(DONE_MESSAGE);
    await expect.element(page.getByRole('status')).toHaveFocus();
    expect(executeGraphQL).toHaveBeenCalledWith(
      AdminResetPasswordDocument,
      { token: TOKEN, newPassword: NEW_PASSWORD },
      { turnstileToken: undefined },
    );
    expect(resetForm().elements()).toHaveLength(0);
    await expect
      .element(page.getByRole('link', { name: 'ログイン画面へ' }))
      .toHaveAttribute('href', '/auth/login');
    expect(
      context.queryClient.getQueryState(adminViewerQueryOptions().queryKey)
        ?.isInvalidated,
    ).toBe(true);
  });

  test('再設定の後の管理者の取り直しに失敗しても、成功を示してエラートラッキングへ送る', async () => {
    respond(resetDone);
    const { context } = await renderAt(`#token=${TOKEN}`);
    const refreshFailure = new Error('取り直しの失敗');
    vi.spyOn(context.queryClient, 'invalidateQueries').mockRejectedValueOnce(
      refreshFailure,
    );

    await submitPassword();

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(DONE_MESSAGE);
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledExactlyOnceWith(
      refreshFailure,
      'render',
    );
  });

  test('新しいパスワードへのサーバーの拒否を入力欄に示す', async () => {
    const pwned =
      'このパスワードは過去に漏洩したことがあります。別のパスワードを設定してください。';
    respond(() =>
      failure({
        code: 'password_rejected',
        message: pwned,
        status: 422,
        details: [{ field: 'newPassword', code: 'pwned', message: pwned }],
      }),
    );
    await renderAt(`#token=${TOKEN}`);

    await submitPassword();

    await expect
      .element(passwordInput())
      .toHaveAccessibleDescription(
        `8文字以上128文字以内で設定してください。 ${pwned}`,
      );
    await expect.element(passwordInput()).toHaveFocus();
  });

  test('無効なリンクなら、フォームに代えて無効の文言と再設定のやり直しへの導線を示す', async () => {
    respond(() =>
      failure({
        code: 'invalid_link',
        message: INVALID_LINK_MESSAGE,
        status: 422,
      }),
    );
    await renderAt(`#token=${TOKEN}`);

    await submitPassword();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INVALID_LINK_MESSAGE);
    await expect.element(page.getByRole('alert')).toHaveFocus();
    expect(resetForm().elements()).toHaveLength(0);
    await expect
      .element(page.getByRole('link', { name: 'パスワードの再設定' }))
      .toHaveAttribute('href', '/auth/password-reset');
  });

  test('トークンへの入力の不正も、無効なリンクとして示す', async () => {
    respond(() =>
      failure({
        code: 'validation_error',
        message: '入力内容を確認してください。',
        status: 400,
        details: [
          { field: 'token', code: 'too_big', message: INVALID_LINK_MESSAGE },
        ],
      }),
    );
    await renderAt(`#token=${'a'.repeat(257)}`);

    await submitPassword();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INVALID_LINK_MESSAGE);
    expect(resetForm().elements()).toHaveLength(0);
  });

  test('リンクと関係の無い失敗は、フォームの文言で示して入力を続けられる', async () => {
    const unavailable = '通信に失敗しました。時間をおいて再度お試しください。';
    respond(() =>
      failure({ code: 'network_error', message: unavailable, status: 0 }),
    );
    await renderAt(`#token=${TOKEN}`);

    await submitPassword();

    await expect
      .element(resetForm().getByRole('alert'))
      .toHaveTextContent(unavailable);
    await expect.element(resetButton()).toBeEnabled();
  });

  test('フラグメントにトークンが無ければ、フォームを描かずに無効なリンクとして示す', async () => {
    await renderAt('');

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INVALID_LINK_MESSAGE);
    expect(resetForm().elements()).toHaveLength(0);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('入力と完了の段階で、アクセシビリティの検査の違反が0件', async () => {
      respond(resetDone);
      await renderAt(`#token=${TOKEN}`);
      await expect.element(passwordInput()).toBeVisible();
      const editing = await runAxe(document.body);

      await submitPassword();
      await expect.element(page.getByRole('status')).toBeVisible();

      expect(editing).toStrictEqual([]);
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
