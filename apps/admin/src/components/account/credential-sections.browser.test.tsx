import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  CURRENT_PASSWORD,
  CURRENT_PASSWORD_INCORRECT,
  NEW_PASSWORD,
  reauthenticationFailed,
  renderAccountPage,
  respondAccountGraphQL,
  SECOND_FACTOR_INCORRECT,
} from '../../../test/account-fixtures.ts';
import {
  callsOf,
  failure,
  type GraphQLHandler,
  success,
} from '../../../test/admin-accounts-fixtures.ts';
import { signedInAdminQuery } from '../../../test/admin-viewer-fixtures.ts';
import {
  AdminChangePasswordDocument,
  AdminRequestEmailChangeDocument,
  AdminViewerDocument,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const NEW_EMAIL = 'next-operator@admin.example';
const EMAIL_SENT_MESSAGE =
  '入力したメールアドレスがほかの管理者に使われていない場合は、確認のリンクを送信しました。リンクの有効期限は24時間です。';
const PASSWORD_CHANGED_MESSAGE =
  'パスワードを変更しました。ほかの端末ではログアウトしました。';
const PASSWORD_REJECTED =
  'このパスワードは過去に漏洩したことがあります。別のパスワードを設定してください。';

const main = () => page.getByRole('main');
const emailSection = () =>
  main().getByRole('region', { name: 'メールアドレスの変更' });
const emailForm = () =>
  emailSection().getByRole('form', { name: 'メールアドレスの変更' });
const passwordSection = () =>
  main().getByRole('region', { name: 'パスワードの変更' });
const passwordForm = () =>
  passwordSection().getByRole('form', { name: 'パスワードの変更' });

type FormLocator = ReturnType<typeof emailForm>;

const currentPasswordOf = (form: FormLocator) =>
  form.getByLabelText('現在のパスワード(必須)', { exact: true });
const totpCodeOf = (form: FormLocator) =>
  form.getByRole('textbox', { name: '認証コード(必須)' });
const recoveryCodeOf = (form: FormLocator) =>
  form.getByRole('textbox', { name: 'リカバリコード(必須)' });
const newEmailInput = () =>
  emailForm().getByRole('textbox', { name: '新しいメールアドレス(必須)' });
const newPasswordInput = () =>
  passwordForm().getByLabelText('新しいパスワード(必須)', { exact: true });
const emailSubmit = () =>
  emailForm().getByRole('button', { name: '確認のリンクを送信する' });
const passwordSubmit = () =>
  passwordForm().getByRole('button', { name: 'パスワードを変更する' });

async function renderWith(
  handlers: ReadonlyMap<unknown, GraphQLHandler>,
): Promise<void> {
  respondAccountGraphQL(executeGraphQL, { handlers });
  await renderAccountPage();
  await expect.element(emailForm()).toBeVisible();
}

async function fillReauthentication(form: FormLocator): Promise<void> {
  await userEvent.fill(currentPasswordOf(form), CURRENT_PASSWORD);
  await userEvent.fill(totpCodeOf(form), '123456');
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  applyColorScheme('light');
});

describe('メールアドレスの変更', () => {
  test('現在のメールアドレスを示し、新しいメールアドレスと本人確認を送ると、送信後の案内を示して入力を空にする', async () => {
    const request = vi.fn(() => success({ requestAdminEmailChange: true }));
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [AdminRequestEmailChangeDocument, request],
      ]),
    );

    await expect
      .element(emailSection())
      .toHaveTextContent('現在のメールアドレス: operator@admin.example');
    await userEvent.fill(newEmailInput(), ` ${NEW_EMAIL} `);
    await fillReauthentication(emailForm());
    await emailSubmit().click();

    await expect
      .element(emailSection().getByRole('status'))
      .toHaveTextContent(EMAIL_SENT_MESSAGE);
    expect(request).toHaveBeenCalledExactlyOnceWith({
      newEmail: NEW_EMAIL,
      reAuthentication: {
        currentPassword: CURRENT_PASSWORD,
        secondFactor: { totpCode: '123456' },
      },
    });
    await expect.element(newEmailInput()).toHaveValue('');
    await expect.element(currentPasswordOf(emailForm())).toHaveValue('');
  });

  test('リカバリコードに切り替えると、その欄へフォーカスを移し、リカバリコードだけを送る', async () => {
    const request = vi.fn(() => success({ requestAdminEmailChange: true }));
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [AdminRequestEmailChangeDocument, request],
      ]),
    );

    await userEvent.fill(newEmailInput(), NEW_EMAIL);
    await userEvent.fill(currentPasswordOf(emailForm()), CURRENT_PASSWORD);
    await emailForm()
      .getByRole('button', { name: 'リカバリコードを使う' })
      .click();
    await expect.element(recoveryCodeOf(emailForm())).toHaveFocus();
    expect(totpCodeOf(emailForm()).elements()).toHaveLength(0);
    await userEvent.fill(recoveryCodeOf(emailForm()), 'abcd-efgh');
    await emailSubmit().click();

    await expect.element(emailSection().getByRole('status')).toBeVisible();
    expect(request).toHaveBeenCalledExactlyOnceWith({
      newEmail: NEW_EMAIL,
      reAuthentication: {
        currentPassword: CURRENT_PASSWORD,
        secondFactor: { recoveryCode: 'abcd-efgh' },
      },
    });
  });

  test('本人確認の誤りは、現在のパスワードの欄と描いている第2要素の欄に詳細を示す', async () => {
    let field = 'reAuthentication.currentPassword';
    let message = CURRENT_PASSWORD_INCORRECT;
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [
          AdminRequestEmailChangeDocument,
          () => reauthenticationFailed(field, message),
        ],
      ]),
    );

    await userEvent.fill(newEmailInput(), NEW_EMAIL);
    await fillReauthentication(emailForm());
    await emailSubmit().click();
    await expect
      .element(currentPasswordOf(emailForm()))
      .toHaveAccessibleDescription(CURRENT_PASSWORD_INCORRECT);
    await expect.element(currentPasswordOf(emailForm())).toHaveFocus();

    field = 'reAuthentication.secondFactor.recoveryCode';
    message = 'リカバリコードが正しくありません。';
    await userEvent.fill(
      currentPasswordOf(emailForm()),
      `${CURRENT_PASSWORD}-retry`,
    );
    await emailForm()
      .getByRole('button', { name: 'リカバリコードを使う' })
      .click();
    await userEvent.fill(recoveryCodeOf(emailForm()), 'abcd-efgh');
    await emailSubmit().click();

    await expect
      .element(recoveryCodeOf(emailForm()))
      .toHaveAccessibleDescription(/リカバリコードが正しくありません。/);
    await expect
      .element(recoveryCodeOf(emailForm()))
      .toHaveAttribute('aria-invalid', 'true');
  });
});

describe('パスワードの変更', () => {
  test('新しいパスワードと本人確認を送ると、変更の結果を示して入力を空にし、入れ替わったセッションでログイン中の管理者を取り直す', async () => {
    const change = vi.fn(() => success({ changeAdminPassword: true }));
    await renderWith(
      new Map<unknown, GraphQLHandler>([[AdminChangePasswordDocument, change]]),
    );
    const viewerCalls = callsOf(executeGraphQL, AdminViewerDocument).length;

    await userEvent.fill(newPasswordInput(), NEW_PASSWORD);
    await fillReauthentication(passwordForm());
    await passwordSubmit().click();

    await expect
      .element(passwordSection().getByRole('status'))
      .toHaveTextContent(PASSWORD_CHANGED_MESSAGE);
    expect(change).toHaveBeenCalledExactlyOnceWith({
      newPassword: NEW_PASSWORD,
      reAuthentication: {
        currentPassword: CURRENT_PASSWORD,
        secondFactor: { totpCode: '123456' },
      },
    });
    await expect.element(newPasswordInput()).toHaveValue('');
    await expect
      .poll(() => callsOf(executeGraphQL, AdminViewerDocument).length)
      .toBeGreaterThan(viewerCalls);
  });

  test('新しいパスワードの拒否は新しいパスワードの欄に、認証コードの誤りは認証コードの欄に示す', async () => {
    let result = () =>
      failure({
        code: 'password_rejected',
        message: PASSWORD_REJECTED,
        status: 200,
        details: [
          { field: 'newPassword', code: 'pwned', message: PASSWORD_REJECTED },
        ],
      });
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [AdminChangePasswordDocument, () => result()],
      ]),
    );

    await userEvent.fill(newPasswordInput(), NEW_PASSWORD);
    await fillReauthentication(passwordForm());
    await passwordSubmit().click();
    await expect
      .element(newPasswordInput())
      .toHaveAccessibleDescription(new RegExp(PASSWORD_REJECTED));

    result = () =>
      reauthenticationFailed(
        'reAuthentication.secondFactor.totpCode',
        SECOND_FACTOR_INCORRECT,
      );
    await userEvent.fill(newPasswordInput(), `${NEW_PASSWORD}-2`);
    await passwordSubmit().click();

    await expect
      .element(totpCodeOf(passwordForm()))
      .toHaveAccessibleDescription(new RegExp(SECOND_FACTOR_INCORRECT));
  });

  test('第2要素を送らなかった時の詳細は、フォーム全体の失敗として示し、送信ボタンを無効のまま残さない', async () => {
    await renderWith(
      new Map<unknown, GraphQLHandler>([
        [
          AdminChangePasswordDocument,
          () =>
            reauthenticationFailed(
              'reAuthentication.secondFactor',
              SECOND_FACTOR_INCORRECT,
            ),
        ],
      ]),
    );

    await userEvent.fill(newPasswordInput(), NEW_PASSWORD);
    await fillReauthentication(passwordForm());
    await passwordSubmit().click();

    await expect
      .element(passwordForm().getByRole('alert'))
      .toHaveTextContent(SECOND_FACTOR_INCORRECT);
    await expect.element(passwordSubmit()).toBeEnabled();
  });

  test('8文字未満の新しいパスワードを、フォーカスを外した時に示して送信できなくする', async () => {
    await renderWith(new Map());

    await userEvent.fill(newPasswordInput(), 'short');
    await userEvent.tab();

    await expect
      .element(newPasswordInput())
      .toHaveAccessibleDescription(
        /パスワードは8文字以上128文字以内で入力してください。/,
      );
    await expect.element(passwordSubmit()).toBeDisabled();
  });
});

describe('本人確認でリカバリコードを使った後の残数', () => {
  const recoverySection = () =>
    main().getByRole('region', { name: 'リカバリコード' });

  // サーバーは本人確認が通るとリカバリコードを使用済みにするため、操作の結果によらず残数が1つ減る
  async function renderConsuming(
    document: unknown,
    result: () => Promise<unknown>,
  ): Promise<void> {
    let remaining = 5;
    respondAccountGraphQL(executeGraphQL, {
      viewer: () => signedInAdminQuery({ remainingRecoveryCodes: remaining }),
      handlers: new Map<unknown, GraphQLHandler>([
        [
          document,
          () => {
            remaining = 4;
            return result();
          },
        ],
      ]),
    });
    await renderAccountPage(signedInAdminQuery({ remainingRecoveryCodes: 5 }));
    await expect
      .element(recoverySection())
      .toHaveTextContent('未使用のリカバリコードは残り5個です。');
  }

  async function fillWithRecoveryCode(form: FormLocator): Promise<void> {
    await userEvent.fill(currentPasswordOf(form), CURRENT_PASSWORD);
    await form.getByRole('button', { name: 'リカバリコードを使う' }).click();
    await userEvent.fill(recoveryCodeOf(form), 'abcd-efgh');
  }

  test('メールアドレス変更の要求をリカバリコードで送った後、取り直した残数を示す', async () => {
    await renderConsuming(AdminRequestEmailChangeDocument, () =>
      success({ requestAdminEmailChange: true }),
    );

    await userEvent.fill(newEmailInput(), NEW_EMAIL);
    await fillWithRecoveryCode(emailForm());
    await emailSubmit().click();

    await expect.element(emailSection().getByRole('status')).toBeVisible();
    await expect
      .element(recoverySection())
      .toHaveTextContent('未使用のリカバリコードは残り4個です。');
  });

  test('本人確認が通った後にパスワード変更が拒否されても、取り直した残数を示す', async () => {
    await renderConsuming(AdminChangePasswordDocument, () =>
      failure({
        code: 'password_rejected',
        message: PASSWORD_REJECTED,
        status: 200,
        details: [
          { field: 'newPassword', code: 'pwned', message: PASSWORD_REJECTED },
        ],
      }),
    );

    await userEvent.fill(newPasswordInput(), NEW_PASSWORD);
    await fillWithRecoveryCode(passwordForm());
    await passwordSubmit().click();

    await expect
      .element(newPasswordInput())
      .toHaveAccessibleDescription(new RegExp(PASSWORD_REJECTED));
    await expect
      .element(recoverySection())
      .toHaveTextContent('未使用のリカバリコードは残り4個です。');
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('入力の誤りを示した2つのフォームのアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderWith(new Map());

    await userEvent.fill(newPasswordInput(), 'short');
    await userEvent.tab();
    await expect
      .element(newPasswordInput())
      .toHaveAttribute('aria-invalid', 'true');

    expect(await runAxe(emailSection().element())).toStrictEqual([]);
    expect(await runAxe(passwordSection().element())).toStrictEqual([]);
  });
});
