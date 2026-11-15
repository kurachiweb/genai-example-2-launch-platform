import type { ReactNode } from 'react';
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
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  signedInViewerQuery,
  viewerResult,
} from '../../../test/viewer-fixtures.ts';
import {
  ClientConfirmEmailChangeDocument,
  ClientConfirmPasswordChangeDocument,
  ClientVerifyEmailDocument,
  ClientViewerDocument,
  type ClientViewerQuery,
} from '../../graphql/generated/graphql.ts';
import { viewerQueryOptions } from '../../graphql/viewer.ts';
import { EmailChangeConfirmation } from './email-change-confirmation.tsx';
import { PasswordChangeConfirmation } from './password-change-confirmation.tsx';
import { VerifyEmailConfirmation } from './verify-email-confirmation.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/observability/browser-error-reporting.ts', {
  spy: true,
});

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKEN = ['mail', 'link', 'value'].join('_');
const INVALID_LINK_MESSAGE = 'このリンクは無効か、有効期限が切れています。';

interface ConfirmationCase {
  readonly name: string;
  readonly path: string;
  readonly element: ReactNode;
  readonly document: unknown;
  readonly actionLabel: string;
  readonly succeeded: unknown;
  readonly successMessage: string;
  readonly retryLink: { readonly name: string; readonly href: string };
}

const VERIFY_EMAIL: ConfirmationCase = {
  name: 'メールアドレスの確認',
  path: '/auth/verify-email',
  element: <VerifyEmailConfirmation />,
  document: ClientVerifyEmailDocument,
  actionLabel: 'メールアドレスを確認する',
  succeeded: { verifyEmail: true },
  successMessage: 'メールアドレスの確認が完了しました。',
  retryLink: { name: 'ログイン', href: '/auth/login' },
};

const EMAIL_CHANGE: ConfirmationCase = {
  name: 'メールアドレスの変更',
  path: '/auth/email-change/confirm',
  element: <EmailChangeConfirmation />,
  document: ClientConfirmEmailChangeDocument,
  actionLabel: 'メールアドレスの変更を確定する',
  succeeded: { confirmEmailChange: { viewer: { id: 'user-1' } } },
  successMessage: 'メールアドレスを変更しました。',
  retryLink: { name: 'アカウントの設定', href: '/settings/account' },
};

const PASSWORD_CHANGE: ConfirmationCase = {
  name: 'パスワードの変更',
  path: '/auth/password-change/confirm',
  element: <PasswordChangeConfirmation />,
  document: ClientConfirmPasswordChangeDocument,
  actionLabel: 'パスワードの変更を確定する',
  succeeded: { confirmPasswordChange: { viewer: { id: 'user-1' } } },
  successMessage: 'パスワードを変更しました。',
  retryLink: { name: 'アカウントの設定', href: '/settings/account' },
};

const CASES = [VERIFY_EMAIL, EMAIL_CHANGE, PASSWORD_CHANGE];

const failure = (code: string, message: string, status: number) =>
  Promise.resolve({
    ok: false,
    error: new GraphQLClientError({ code, message, status }),
  });

function respond(
  document: unknown,
  result: () => Promise<unknown>,
  viewerAfter: ClientViewerQuery = GUEST_VIEWER_QUERY,
): void {
  executeGraphQL.mockImplementation((requested: unknown) => {
    if (requested === document) {
      return result();
    }
    if (requested === ClientViewerDocument) {
      return Promise.resolve(viewerResult(viewerAfter));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

async function renderAt(
  { element, path }: ConfirmationCase,
  hash: string,
  cachedViewer: ClientViewerQuery = GUEST_VIEWER_QUERY,
) {
  const context = createPageRouterContext('local');
  const router = await renderInRouter(element, {
    path: `${path}${hash}`,
    context,
    cachedViewer,
  });
  return { router, context };
}

const actionButton = ({ actionLabel }: ConfirmationCase) =>
  page.getByRole('button', { name: actionLabel });

// 画面が利用者を読んでいる間は、無効にした取得がすぐ取り直されるため、取り直しも無効にした結果として扱う
const viewerRefreshed = (
  context: ReturnType<typeof createPageRouterContext>,
): boolean => {
  const state = context.queryClient.getQueryState(
    viewerQueryOptions().queryKey,
  );
  return (
    state !== undefined && (state.isInvalidated || state.dataUpdateCount > 1)
  );
};

const callsOf = (document: unknown): number =>
  executeGraphQL.mock.calls.filter(([requested]) => requested === document)
    .length;

beforeEach(() => {
  executeGraphQL.mockReset();
  vi.mocked(reportUnexpectedErrorInBrowser).mockClear();
});

afterEach(() => {
  applyColorScheme('light');
});

describe.each(CASES)('$nameのリンクの画面', (confirmation) => {
  test('フラグメントからトークンを読んでフラグメントを消し、開いただけでは送信しない', async () => {
    const { router } = await renderAt(confirmation, `#token=${TOKEN}`);

    await expect.element(actionButton(confirmation)).toBeVisible();
    await expect.poll(() => router.history.location.hash).toBe('');
    expect(router.state.location.hash).toBe('');
    expect(router.state.location.pathname).toBe(confirmation.path);
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('確定のボタンでトークンを送り、成功を示して利用者の取得を無効にする', async () => {
    respond(confirmation.document, () =>
      Promise.resolve({ ok: true, data: confirmation.succeeded }),
    );
    const { context } = await renderAt(confirmation, `#token=${TOKEN}`);

    await userEvent.click(actionButton(confirmation));

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(confirmation.successMessage);
    await expect.element(page.getByRole('status')).toHaveFocus();
    expect(executeGraphQL).toHaveBeenCalledWith(
      confirmation.document,
      { token: TOKEN },
      { turnstileToken: undefined },
    );
    expect(actionButton(confirmation).elements()).toHaveLength(0);
    expect(viewerRefreshed(context)).toBe(true);
  });

  test('確定の後の利用者の取り直しに失敗しても、成功を示してエラートラッキングへ送る', async () => {
    respond(confirmation.document, () =>
      Promise.resolve({ ok: true, data: confirmation.succeeded }),
    );
    const { context } = await renderAt(confirmation, `#token=${TOKEN}`);
    const refreshFailure = new Error('取り直しの失敗');
    vi.spyOn(context.queryClient, 'invalidateQueries').mockRejectedValueOnce(
      refreshFailure,
    );

    await userEvent.click(actionButton(confirmation));

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(confirmation.successMessage);
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    expect(callsOf(confirmation.document)).toBe(1);
    expect(reportUnexpectedErrorInBrowser).toHaveBeenCalledExactlyOnceWith(
      refreshFailure,
      'render',
    );
  });

  test('無効なリンクなら、無効の文言と再度の手続きへの導線を示す', async () => {
    respond(confirmation.document, () =>
      failure('invalid_link', INVALID_LINK_MESSAGE, 422),
    );
    await renderAt(confirmation, `#token=${TOKEN}`);

    await userEvent.click(actionButton(confirmation));

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INVALID_LINK_MESSAGE);
    await expect.element(page.getByRole('alert')).toHaveFocus();
    await expect
      .element(page.getByRole('link', { name: confirmation.retryLink.name }))
      .toHaveAttribute('href', confirmation.retryLink.href);
    expect(actionButton(confirmation).elements()).toHaveLength(0);
  });

  test('長すぎるトークンの入力の不正も、無効なリンクとして示す', async () => {
    respond(confirmation.document, () =>
      Promise.resolve({
        ok: false,
        error: new GraphQLClientError({
          code: 'validation_error',
          message: '入力内容を確認してください。',
          status: 400,
          details: [
            {
              field: 'token',
              code: 'too_big',
              message: INVALID_LINK_MESSAGE,
            },
          ],
        }),
      }),
    );
    await renderAt(confirmation, `#token=${'a'.repeat(257)}`);

    await userEvent.click(actionButton(confirmation));

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INVALID_LINK_MESSAGE);
  });

  test('フラグメントにトークンが無ければ、送信せずに無効なリンクとして示す', async () => {
    await renderAt(confirmation, '');

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(INVALID_LINK_MESSAGE);
    expect(actionButton(confirmation).elements()).toHaveLength(0);
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('リンクと関係の無い失敗は文言を示し、もう一度確定できる', async () => {
    const unavailable = '通信に失敗しました。時間をおいて再度お試しください。';
    respond(confirmation.document, () =>
      failure('network_error', unavailable, 0),
    );
    await renderAt(confirmation, `#token=${TOKEN}`);

    await userEvent.click(actionButton(confirmation));

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(unavailable);
    await expect.element(actionButton(confirmation)).toBeEnabled();
    respond(confirmation.document, () =>
      Promise.resolve({ ok: true, data: confirmation.succeeded }),
    );
    await userEvent.click(actionButton(confirmation));

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(confirmation.successMessage);
    expect(callsOf(confirmation.document)).toBe(2);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('確定の前と無効なリンクの表示で、アクセシビリティの検査の違反が0件', async () => {
      respond(confirmation.document, () =>
        failure('invalid_link', INVALID_LINK_MESSAGE, 422),
      );
      await renderAt(confirmation, `#token=${TOKEN}`);
      await expect.element(actionButton(confirmation)).toBeVisible();
      const before = await runAxe(document.body);

      await userEvent.click(actionButton(confirmation));
      await expect.element(page.getByRole('alert')).toBeVisible();

      expect(before).toStrictEqual([]);
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});

describe('メールアドレスの確認の無効なリンク', () => {
  test('ログイン中で未確認なら、画面上部の帯から再送できることを示す', async () => {
    await renderAt(
      VERIFY_EMAIL,
      '',
      signedInViewerQuery({ emailVerified: false }),
    );

    await expect
      .element(
        page.getByText(
          '確認メールは、画面上部の「確認メールを再送」から再送できます。',
        ),
      )
      .toBeVisible();
    expect(
      page.getByRole('link', { name: 'ログイン' }).elements(),
    ).toHaveLength(0);
  });

  test('ログイン中で確認済みなら、確認済みであることを示す', async () => {
    await renderAt(VERIFY_EMAIL, '', signedInViewerQuery());

    await expect
      .element(page.getByText('メールアドレスは確認済みです。'))
      .toBeVisible();
  });
});

describe('成功の後の案内', () => {
  test('メールアドレスの確認の後は、トップページへの導線を示す', async () => {
    respond(VERIFY_EMAIL.document, () =>
      Promise.resolve({ ok: true, data: VERIFY_EMAIL.succeeded }),
    );
    await renderAt(VERIFY_EMAIL, `#token=${TOKEN}`);

    await userEvent.click(actionButton(VERIFY_EMAIL));

    await expect
      .element(page.getByRole('link', { name: 'トップページへ' }))
      .toHaveAttribute('href', '/');
  });

  test.each([
    [EMAIL_CHANGE, 'confirmEmailChange', 'メールアドレス'],
    [PASSWORD_CHANGE, 'confirmPasswordChange', 'パスワード'],
  ] as const)(
    '$nameの後にこの端末がログイン中でなければ、新しい値でのログインへ案内する',
    async (confirmation, field, subject) => {
      respond(confirmation.document, () =>
        Promise.resolve({ ok: true, data: { [field]: { viewer: null } } }),
      );
      await renderAt(confirmation, `#token=${TOKEN}`);

      await userEvent.click(actionButton(confirmation));

      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent(
          `${confirmation.successMessage}新しい${subject}でログインしてください。`,
        );
      await expect
        .element(page.getByRole('link', { name: 'ログイン画面へ' }))
        .toHaveAttribute('href', '/auth/login');
    },
  );

  test.each([EMAIL_CHANGE, PASSWORD_CHANGE])(
    '$nameの後にこの端末が同じ利用者としてログイン中なら、トップページへの導線を示す',
    async (confirmation) => {
      respond(
        confirmation.document,
        () => Promise.resolve({ ok: true, data: confirmation.succeeded }),
        signedInViewerQuery(),
      );
      await renderAt(confirmation, `#token=${TOKEN}`, signedInViewerQuery());

      await userEvent.click(actionButton(confirmation));

      await expect
        .element(page.getByRole('status'))
        .toHaveTextContent(confirmation.successMessage);
      await expect
        .element(page.getByRole('link', { name: 'トップページへ' }))
        .toHaveAttribute('href', '/');
    },
  );
});
