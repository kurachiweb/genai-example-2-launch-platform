import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
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
  AdminConfirmEmailChangeDocument,
  AdminViewerDocument,
} from '../../graphql/generated/graphql.ts';
import { EmailChangeConfirmation } from './email-change-confirmation.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const TOKEN = ['email', 'change', 'value'].join('_');
const INVALID_LINK_MESSAGE = 'このリンクは無効か、有効期限が切れています。';
const CHANGED_MESSAGE = 'メールアドレスを変更しました。';
const PATH = '/auth/email-change/confirm';

const confirmButton = () =>
  page.getByRole('button', { name: 'メールアドレスの変更を確定する' });

function respond(result: () => Promise<unknown>): void {
  executeGraphQL.mockImplementation((document: unknown) => {
    if (document === AdminConfirmEmailChangeDocument) {
      return result();
    }
    if (document === AdminViewerDocument) {
      return Promise.resolve(adminViewerResult(GUEST_ADMIN_QUERY));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

const confirmed = (signedIn: boolean) => () =>
  Promise.resolve({
    ok: true,
    data: {
      confirmAdminEmailChange: {
        viewer: signedIn ? signedInAdminQuery().adminViewer : null,
      },
    },
  });

const failure = (init: ConstructorParameters<typeof GraphQLClientError>[0]) =>
  Promise.resolve({ ok: false, error: new GraphQLClientError(init) });

async function renderAt(hash: string) {
  const context = createPageRouterContext('local');
  const router = await renderInRouter(<EmailChangeConfirmation />, {
    path: `${PATH}${hash}`,
    context,
  });
  return { router, context };
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('EmailChangeConfirmation', () => {
  test('リンクを開いただけでは確定せず、他の端末でログアウトする旨と確定のボタンを示す', async () => {
    const { router } = await renderAt(`#token=${TOKEN}`);

    await expect.element(confirmButton()).toBeVisible();
    await expect
      .element(
        page.getByText(
          'ボタンを押すと、メールアドレスの変更が完了します。ほかの端末ではログアウトします。',
        ),
      )
      .toBeVisible();
    await expect.poll(() => router.history.location.hash).toBe('');
    expect(executeGraphQL).not.toHaveBeenCalled();
  });

  test('ボタンでリンクのトークンを送り、ログイン中の端末ならダッシュボードへ案内して管理者の取得を無効にする', async () => {
    respond(confirmed(true));
    const { context } = await renderAt(`#token=${TOKEN}`);

    await userEvent.click(confirmButton());

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(CHANGED_MESSAGE);
    expect(executeGraphQL).toHaveBeenCalledWith(
      AdminConfirmEmailChangeDocument,
      { token: TOKEN },
      { turnstileToken: undefined },
    );
    await expect
      .element(page.getByRole('link', { name: 'ダッシュボードへ' }))
      .toHaveAttribute('href', '/');
    expect(
      context.queryClient.getQueryState(adminViewerQueryOptions().queryKey)
        ?.isInvalidated,
    ).toBe(true);
  });

  test('確定した端末がログイン中でなければ、新しいメールアドレスでのログインへ案内する', async () => {
    respond(confirmed(false));
    await renderAt(`#token=${TOKEN}`);

    await userEvent.click(confirmButton());

    await expect
      .element(page.getByRole('status'))
      .toHaveTextContent(
        `${CHANGED_MESSAGE}新しいメールアドレスでログインしてください。`,
      );
    await expect
      .element(page.getByRole('link', { name: 'ログイン画面へ' }))
      .toHaveAttribute('href', '/auth/login');
  });

  test('無効なリンクなら、自分のアカウントからやり直す導線を示す', async () => {
    respond(() =>
      failure({
        code: 'invalid_link',
        message: INVALID_LINK_MESSAGE,
        status: 422,
      }),
    );
    await renderAt(`#token=${TOKEN}`);

    await userEvent.click(confirmButton());

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(
        `${INVALID_LINK_MESSAGE}自分のアカウントから、もう一度変更を行ってください。`,
      );
    await expect
      .element(page.getByRole('link', { name: '自分のアカウント' }))
      .toHaveAttribute('href', '/account');
    expect(confirmButton().elements()).toHaveLength(0);
  });

  test('リンクと関係の無い失敗は、問い合わせを促さない文言で示して押し直せる', async () => {
    respond(() =>
      failure({
        code: 'internal_error',
        message: '予期しないエラーが発生しました。',
        status: 500,
      }),
    );
    await renderAt(`#token=${TOKEN}`);

    await userEvent.click(confirmButton());

    await expect.element(page.getByRole('alert')).toBeVisible();
    expect(page.getByRole('alert').element().textContent).not.toContain(
      '問い合わせ',
    );
    await expect.element(confirmButton()).toBeVisible();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('確定の前と後で、アクセシビリティの検査の違反が0件', async () => {
      respond(confirmed(true));
      await renderAt(`#token=${TOKEN}`);
      await expect.element(confirmButton()).toBeVisible();
      const idle = await runAxe(document.body);

      await userEvent.click(confirmButton());
      await expect.element(page.getByRole('status')).toBeVisible();

      expect(idle).toStrictEqual([]);
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
