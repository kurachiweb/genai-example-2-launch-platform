import { beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  AVATAR_OBJECT_KEY,
  callsOf,
  EXPIRED_ACCOUNT,
  failure,
  INVITED_ACCOUNT,
  MODERATOR_ACCOUNT,
  renderAccountsPage,
  respondAdminGraphQL,
  success,
  SUPER_ADMIN_ACCOUNT,
} from '../../../test/admin-accounts-fixtures.ts';
import { ADMIN_NICKNAME } from '../../../test/admin-viewer-fixtures.ts';
import { loadAdminAccounts } from '../../graphql/admin-accounts.ts';
import {
  AdminAccountsDocument,
  AdminInviteDocument,
  type AdminRole,
} from '../../graphql/generated/graphql.ts';
import { Route as AccountsRoute } from '../../routes/_authenticated/accounts/index.tsx';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const PAGE_TITLE = '管理者アカウント';
const INVITE_BUTTON = '管理者を招待';
const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';
const NEW_EMAIL = 'new-admin@admin.example';
const EMAIL_IN_USE_MESSAGE =
  'このメールアドレスは既に管理者として登録されています。';

const main = () => page.getByRole('main');
const table = () => main().getByRole('table', { name: '管理者の一覧' });
const rowOf = (text: string) =>
  table().getByRole('row').filter({ hasText: text });
const inviteButton = () =>
  main().getByRole('button', { name: INVITE_BUTTON, exact: true });
const inviteDialog = () => page.getByRole('dialog', { name: INVITE_BUTTON });
const emailInput = () =>
  inviteDialog().getByRole('textbox', { name: 'メールアドレス(必須)' });
const reasonInput = () =>
  inviteDialog().getByRole('textbox', { name: '理由(任意)' });
const inviteSubmit = () =>
  inviteDialog().getByRole('button', { name: '招待する' });

const ROW_ACTION_NAMES = Object.freeze({
  resend: (target: string) => `「${target}」の招待を再送`,
  changeRole: (target: string) => `「${target}」のロールを変更`,
  editProfile: (target: string) => `「${target}」のプロフィールを編集`,
  delete: (target: string) => `「${target}」を削除`,
});

type RowAction = keyof typeof ROW_ACTION_NAMES;

const actionButton = (action: RowAction, target: string) =>
  main().getByRole('button', {
    name: ROW_ACTION_NAMES[action](target),
    exact: true,
  });

async function expectRowActions(
  target: string,
  expected: readonly RowAction[],
): Promise<void> {
  for (const action of Object.keys(ROW_ACTION_NAMES) as RowAction[]) {
    const button = actionButton(action, target);
    if (expected.includes(action)) {
      await expect.element(button).toBeEnabled();
    } else {
      await expect.element(button).not.toBeInTheDocument();
    }
  }
}

const renderAs = async (role: AdminRole) => {
  respondAdminGraphQL(executeGraphQL, { role });
  const router = await renderAccountsPage(role);
  await expect.element(table()).toBeVisible();
  return router;
};

beforeEach(() => {
  executeGraphQL.mockReset();
});

describe('管理者の一覧', () => {
  test('全管理者を、画像・ニックネーム・肩書き・メールアドレス・ロール・状態・登録日時とともにAPIの順で表示する', async () => {
    await renderAs('VIEWER');

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent(PAGE_TITLE);
    const headers = table()
      .getByRole('columnheader')
      .elements()
      .map((element) => element.textContent);
    expect(headers).toStrictEqual([
      '画像',
      'ニックネーム',
      '肩書き',
      'メールアドレス',
      'ロール',
      '状態',
      '登録日時',
      '操作',
    ]);
    const moderatorRow = rowOf(MODERATOR_ACCOUNT.email);
    await expect.element(moderatorRow).toHaveTextContent('審査の担当');
    await expect.element(moderatorRow).toHaveTextContent('モデレーション担当');
    await expect.element(moderatorRow).toHaveTextContent('モデレーター');
    await expect.element(moderatorRow).toHaveTextContent('有効');
    expect(
      moderatorRow.element().querySelector('img')?.getAttribute('src'),
    ).toContain(AVATAR_OBJECT_KEY);
    expect(
      moderatorRow.element().querySelector('time')?.getAttribute('datetime'),
    ).toBe(MODERATOR_ACCOUNT.createdAt);
    const emails = table()
      .getByRole('row')
      .elements()
      .slice(1)
      .map((row) => row.querySelectorAll('td')[3]?.textContent);
    expect(emails).toStrictEqual([
      INVITED_ACCOUNT.email,
      EXPIRED_ACCOUNT.email,
      MODERATOR_ACCOUNT.email,
      SUPER_ADMIN_ACCOUNT.email,
      'operator@admin.example',
    ]);
  });

  test('画像の無い管理者は既定のアイコンを、招待の完了前の管理者は未設定と招待の状態を表示する', async () => {
    await renderAs('VIEWER');

    const superAdminRow = rowOf(SUPER_ADMIN_ACCOUNT.email);
    expect(superAdminRow.element().querySelector('img')).toBeNull();
    expect(
      superAdminRow.element().querySelector('[data-slot="media-placeholder"]')
        ?.textContent,
    ).toBe('統');
    await expect.element(superAdminRow).toHaveTextContent('最上位管理者');
    const invitedRow = rowOf(INVITED_ACCOUNT.email);
    await expect.element(invitedRow).toHaveTextContent('未設定');
    await expect.element(invitedRow).toHaveTextContent('閲覧のみ');
    await expect.element(invitedRow).toHaveTextContent('招待中');
    await expect
      .element(rowOf(EXPIRED_ACCOUNT.email))
      .toHaveTextContent('招待期限切れ');
  });

  test('自分の行に自分である印を付ける', async () => {
    await renderAs('VIEWER');

    await expect
      .element(rowOf('operator@admin.example'))
      .toHaveTextContent(`${ADMIN_NICKNAME}自分`);
  });

  test('経路の読み込みは、一覧を取得してから描く', () => {
    expect(AccountsRoute.options.loader).toBe(loadAdminAccounts);
  });

  test('一覧の取得に失敗したら、ページのエラーの画面を表示する', async () => {
    respondAdminGraphQL(executeGraphQL, {
      role: 'VIEWER',
      handlers: new Map([
        [
          AdminAccountsDocument,
          () =>
            failure({
              code: 'upstream_unavailable',
              message: '現在ご利用いただけません。',
              status: 503,
            }),
        ],
      ]),
    });

    await renderAccountsPage('VIEWER');

    await expect
      .element(main().getByRole('heading', { level: 1 }))
      .toHaveTextContent('ページを表示できませんでした。');
  });
});

describe('ロールによる操作の出し分け', () => {
  test('閲覧のみには、招待と行の操作を表示しない', async () => {
    await renderAs('VIEWER');

    await expect.element(inviteButton()).not.toBeInTheDocument();
    await expectRowActions(INVITED_ACCOUNT.email, []);
    await expectRowActions('審査の担当', []);
    await expectRowActions(ADMIN_NICKNAME, []);
  });

  test('モデレーターには、招待と、招待中への再送と、最上位管理者以外の他の管理者の削除を表示する', async () => {
    await renderAs('MODERATOR');

    await expect.element(inviteButton()).toBeEnabled();
    await expectRowActions(INVITED_ACCOUNT.email, ['resend', 'delete']);
    await expectRowActions(EXPIRED_ACCOUNT.email, ['resend', 'delete']);
    await expectRowActions('審査の担当', ['delete']);
    await expectRowActions('統括の担当', []);
    await expectRowActions(ADMIN_NICKNAME, []);
  });

  test('最上位管理者には、すべての管理者のロールの変更と、他の有効な管理者のプロフィールの編集と、自分以外の削除を表示する', async () => {
    await renderAs('SUPER_ADMIN');

    await expect.element(inviteButton()).toBeEnabled();
    await expectRowActions(INVITED_ACCOUNT.email, [
      'resend',
      'changeRole',
      'delete',
    ]);
    await expectRowActions('審査の担当', [
      'changeRole',
      'editProfile',
      'delete',
    ]);
    await expectRowActions('統括の担当', [
      'changeRole',
      'editProfile',
      'delete',
    ]);
    await expectRowActions(ADMIN_NICKNAME, ['changeRole']);
  });
});

describe('管理者の招待', () => {
  test('招待の処理中は、確定のボタンにフォーカスを保ち、右上の「閉じる」を無効にし、取り消し・Escape・ダイアログの外の押下では閉じない', async () => {
    let resolveInvite: (value: unknown) => void = () => undefined;
    const invite = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveInvite = resolve;
        }),
    );
    respondAdminGraphQL(executeGraphQL, {
      role: 'MODERATOR',
      handlers: new Map([[AdminInviteDocument, invite]]),
    });
    await renderAccountsPage('MODERATOR');
    await inviteButton().click();
    await userEvent.fill(emailInput(), NEW_EMAIL);

    await inviteSubmit().click();

    const busyButton = inviteDialog().getByRole('button', { name: '送信中' });
    const cancelButton = inviteDialog().getByRole('button', {
      name: 'キャンセル',
    });
    await expect.element(busyButton).toHaveAttribute('aria-busy', 'true');
    await expect.element(busyButton).toHaveFocus();
    await expect.element(cancelButton).toHaveAttribute('aria-disabled', 'true');
    await expect.element(cancelButton).not.toHaveAttribute('disabled');
    await expect
      .element(
        inviteDialog().getByRole('button', { name: '閉じる', exact: true }),
      )
      .toHaveAttribute('disabled');
    await userEvent.keyboard('{Escape}');
    await cancelButton.click({ force: true });
    await userEvent.click(
      page.elementLocator(
        document.querySelector('[data-slot="dialog-overlay"]') ?? document.body,
      ),
      { position: { x: 4, y: 4 } },
    );
    await expect.element(inviteDialog()).toBeVisible();
    expect(document.activeElement).not.toBe(document.body);
    expect(inviteDialog().element().contains(document.activeElement)).toBe(
      true,
    );

    resolveInvite({
      ok: true,
      data: { inviteAdmin: { ...INVITED_ACCOUNT, email: NEW_EMAIL } },
    });

    await expect.element(inviteDialog()).not.toBeInTheDocument();
    expect(invite).toHaveBeenCalledOnce();
  });

  test('メールアドレスと任意の理由で招待し、監査ログに記録される旨を示し、閉じた後に一覧を取り直す', async () => {
    const invite = vi.fn(() =>
      success({ inviteAdmin: { ...INVITED_ACCOUNT, email: NEW_EMAIL } }),
    );
    respondAdminGraphQL(executeGraphQL, {
      role: 'MODERATOR',
      handlers: new Map([[AdminInviteDocument, invite]]),
    });
    await renderAccountsPage('MODERATOR');

    await inviteButton().click();
    await expect.element(inviteDialog()).toBeVisible();
    await expect
      .element(inviteDialog().getByText(AUDITED_NOTICE))
      .toBeVisible();
    await expect.element(reasonInput()).not.toHaveAttribute('aria-required');
    await userEvent.fill(emailInput(), ` ${NEW_EMAIL} `);
    await userEvent.fill(reasonInput(), '運営の増員');
    await inviteSubmit().click();

    await expect.element(inviteDialog()).not.toBeInTheDocument();
    expect(invite).toHaveBeenCalledExactlyOnceWith({
      email: NEW_EMAIL,
      reason: '運営の増員',
    });
    await expect
      .poll(() => callsOf(executeGraphQL, AdminAccountsDocument).length)
      .toBe(2);
    await expect.element(inviteButton()).toHaveFocus();
  });

  test('理由を空にすると理由を送らない', async () => {
    const invite = vi.fn(() =>
      success({ inviteAdmin: { ...INVITED_ACCOUNT, email: NEW_EMAIL } }),
    );
    respondAdminGraphQL(executeGraphQL, {
      role: 'SUPER_ADMIN',
      handlers: new Map([[AdminInviteDocument, invite]]),
    });
    await renderAccountsPage('SUPER_ADMIN');

    await inviteButton().click();
    await userEvent.fill(emailInput(), NEW_EMAIL);
    await inviteSubmit().click();

    await expect.element(inviteDialog()).not.toBeInTheDocument();
    expect(invite).toHaveBeenCalledExactlyOnceWith({
      email: NEW_EMAIL,
      reason: undefined,
    });
  });

  test('登録済みのメールアドレスの拒否は、入力を保ったままダイアログの中に示す', async () => {
    respondAdminGraphQL(executeGraphQL, {
      role: 'MODERATOR',
      handlers: new Map([
        [
          AdminInviteDocument,
          () =>
            failure({
              code: 'admin_email_in_use',
              message: EMAIL_IN_USE_MESSAGE,
              status: 200,
            }),
        ],
      ]),
    });
    await renderAccountsPage('MODERATOR');

    await inviteButton().click();
    await userEvent.fill(emailInput(), NEW_EMAIL);
    await inviteSubmit().click();

    await expect
      .element(inviteDialog().getByRole('alert'))
      .toHaveTextContent(EMAIL_IN_USE_MESSAGE);
    await expect.element(emailInput()).toHaveValue(NEW_EMAIL);
  });

  test('サーバーが返したメールアドレスの欄の詳細は、欄のエラーとして示す', async () => {
    respondAdminGraphQL(executeGraphQL, {
      role: 'MODERATOR',
      handlers: new Map([
        [
          AdminInviteDocument,
          () =>
            failure({
              code: 'validation_error',
              message: '入力内容を確認してください。',
              status: 200,
              details: [
                {
                  field: 'email',
                  code: 'invalid',
                  message: 'メールアドレスの形式が正しくありません。',
                },
              ],
            }),
        ],
      ]),
    });
    await renderAccountsPage('MODERATOR');

    await inviteButton().click();
    await userEvent.fill(emailInput(), NEW_EMAIL);
    await inviteSubmit().click();

    await expect.element(emailInput()).toHaveAttribute('aria-invalid', 'true');
    await expect
      .element(emailInput())
      .toHaveAccessibleDescription('メールアドレスの形式が正しくありません。');
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('最上位管理者の一覧と招待のダイアログのアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderAs('SUPER_ADMIN');

    expect(await runAxe(document.body)).toStrictEqual([]);

    await inviteButton().click();
    await expect.element(inviteDialog()).toBeVisible();

    expect(await runAxe(inviteDialog().element())).toStrictEqual([]);
  });
});
