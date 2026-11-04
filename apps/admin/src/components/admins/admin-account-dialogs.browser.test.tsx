import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  stubUploadFetch,
  uploadedReply,
} from '../../../lib/test/fake-upload-fetch.ts';
import { createSvgFile } from '../../../lib/test/media-files.ts';
import {
  AVATAR,
  callsOf,
  failure,
  type GraphQLHandler,
  INVITED_ACCOUNT,
  MODERATOR_ACCOUNT,
  renderAccountsPage,
  respondAdminGraphQL,
  selfAccountOf,
  success,
  SUPER_ADMIN_ACCOUNT,
} from '../../../test/admin-accounts-fixtures.ts';
import {
  ADMIN_NICKNAME,
  adminViewerResult,
  adminWithRole,
} from '../../../test/admin-viewer-fixtures.ts';
import {
  AdminAccountsDocument,
  AdminChangeRoleDocument,
  AdminDeleteDocument,
  AdminResendInvitationDocument,
  type AdminRole,
  AdminUpdateProfileDocument,
  AdminViewerDocument,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';
const LAST_SUPER_ADMIN_MESSAGE =
  '最上位管理者が1人だけのため、この操作はできません。';
const UPLOADED_FILE_ID = '01JC0UPLOAD00000000000000000';

const main = () => page.getByRole('main');
const table = () => main().getByRole('table', { name: '管理者の一覧' });
const listHeading = () =>
  main().getByRole('heading', { level: 2, name: '管理者の一覧' });
const button = (name: string) =>
  main().getByRole('button', { name, exact: true });
const dialogNamed = (name: string) => page.getByRole('dialog', { name });
const reasonOf = (dialog: ReturnType<typeof dialogNamed>) =>
  dialog.getByRole('textbox', { name: '理由(任意)' });

const lastSuperAdminFailure = () =>
  failure({
    code: 'last_super_admin',
    message: LAST_SUPER_ADMIN_MESSAGE,
    status: 200,
  });

async function renderWith(
  role: AdminRole,
  handlers: ReadonlyMap<unknown, GraphQLHandler>,
): Promise<void> {
  respondAdminGraphQL(executeGraphQL, { role, handlers });
  await renderAccountsPage(role);
  await expect.element(table()).toBeVisible();
}

beforeEach(() => {
  executeGraphQL.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('招待の再送', () => {
  const DIALOG = `「${INVITED_ACCOUNT.email}」に招待を再送しますか?`;

  test('任意の理由と監査ログの旨を示して確かめてから再送し、一覧を取り直す', async () => {
    const resend = vi.fn(() =>
      success({ resendAdminInvitation: INVITED_ACCOUNT }),
    );
    await renderWith(
      'MODERATOR',
      new Map([[AdminResendInvitationDocument, resend]]),
    );

    await button(`「${INVITED_ACCOUNT.email}」の招待を再送`).click();
    const dialog = dialogNamed(DIALOG);
    await expect.element(dialog.getByText(AUDITED_NOTICE)).toBeVisible();
    await expect.element(reasonOf(dialog)).toBeVisible();
    await dialog.getByRole('button', { name: '再送する' }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    expect(resend).toHaveBeenCalledExactlyOnceWith({
      id: INVITED_ACCOUNT.id,
      reason: undefined,
    });
    await expect
      .poll(() => callsOf(executeGraphQL, AdminAccountsDocument).length)
      .toBe(2);
  });
});

describe('管理者の削除', () => {
  const DIALOG = '管理者「審査の担当」を削除しますか?';

  test('任意の理由を添えて削除し、閉じた後は一覧の見出しへフォーカスを移す', async () => {
    const remove = vi.fn(() => success({ deleteAdmin: true }));
    await renderWith('MODERATOR', new Map([[AdminDeleteDocument, remove]]));

    await button('「審査の担当」を削除').click();
    const dialog = dialogNamed(DIALOG);
    await expect.element(dialog.getByText(AUDITED_NOTICE)).toBeVisible();
    await userEvent.fill(reasonOf(dialog), '退職のため');
    await dialog.getByRole('button', { name: '削除する' }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    expect(remove).toHaveBeenCalledExactlyOnceWith({
      id: MODERATOR_ACCOUNT.id,
      reason: '退職のため',
    });
    await expect.element(listHeading()).toHaveFocus();
    await expect
      .poll(() => callsOf(executeGraphQL, AdminAccountsDocument).length)
      .toBe(2);
  });

  test('招待中の管理者の削除は、招待の取り消しとして確かめる', async () => {
    await renderWith(
      'MODERATOR',
      new Map([[AdminDeleteDocument, () => success({ deleteAdmin: true })]]),
    );

    await button(`「${INVITED_ACCOUNT.email}」を削除`).click();

    await expect
      .element(dialogNamed(`管理者「${INVITED_ACCOUNT.email}」を削除しますか?`))
      .toHaveTextContent('招待を取り消し、招待のリンクを無効にします。');
  });

  test('取り消すと、開いた元の削除のボタンへフォーカスを戻す', async () => {
    await renderWith('MODERATOR', new Map());

    await button('「審査の担当」を削除').click();
    await dialogNamed(DIALOG)
      .getByRole('button', { name: 'キャンセル' })
      .click();

    await expect.element(button('「審査の担当」を削除')).toHaveFocus();
  });

  test('最後の最上位管理者の拒否は、理由の入力を保ったままダイアログの中に示す', async () => {
    await renderWith(
      'SUPER_ADMIN',
      new Map([[AdminDeleteDocument, lastSuperAdminFailure]]),
    );

    await button('「統括の担当」を削除').click();
    const dialog = dialogNamed('管理者「統括の担当」を削除しますか?');
    await userEvent.fill(reasonOf(dialog), '体制の変更');
    await dialog.getByRole('button', { name: '削除する' }).click();

    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent(LAST_SUPER_ADMIN_MESSAGE);
    await expect.element(reasonOf(dialog)).toHaveValue('体制の変更');
  });
});

describe('ロールの変更', () => {
  const DIALOG = '「審査の担当」のロールを変更';
  const roleRadio = (name: string) =>
    dialogNamed(DIALOG).getByRole('radio', { name, exact: true });

  test('現在のロールを示して選べなくし、選んだロールと任意の理由で変更する', async () => {
    const change = vi.fn(() =>
      success({
        changeAdminRole: { ...MODERATOR_ACCOUNT, role: 'SUPER_ADMIN' },
      }),
    );
    await renderWith(
      'SUPER_ADMIN',
      new Map([[AdminChangeRoleDocument, change]]),
    );

    await button('「審査の担当」のロールを変更').click();
    const dialog = dialogNamed(DIALOG);
    await expect
      .element(dialog)
      .toHaveTextContent('現在のロール: モデレーター');
    await expect.element(roleRadio('モデレーター')).toBeDisabled();
    await expect.element(dialog.getByText(AUDITED_NOTICE)).toBeVisible();
    await expect
      .element(dialog.getByRole('button', { name: '変更する' }))
      .toBeDisabled();
    await roleRadio('最上位管理者').click();
    await userEvent.fill(reasonOf(dialog), '体制の変更');
    await dialog.getByRole('button', { name: '変更する' }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    expect(change).toHaveBeenCalledExactlyOnceWith({
      id: MODERATOR_ACCOUNT.id,
      role: 'SUPER_ADMIN',
      reason: '体制の変更',
    });
    await expect
      .poll(() => callsOf(executeGraphQL, AdminAccountsDocument).length)
      .toBe(2);
    expect(callsOf(executeGraphQL, AdminViewerDocument)).toHaveLength(0);
  });

  test('最後の最上位管理者の自己降格の拒否を、ダイアログの中に示す', async () => {
    await renderWith(
      'SUPER_ADMIN',
      new Map([[AdminChangeRoleDocument, lastSuperAdminFailure]]),
    );

    await button(`「${ADMIN_NICKNAME}」のロールを変更`).click();
    const dialog = dialogNamed(`「${ADMIN_NICKNAME}」のロールを変更`);
    await dialog.getByRole('radio', { name: '閲覧のみ', exact: true }).click();
    await dialog.getByRole('button', { name: '変更する' }).click();

    await expect
      .element(dialog.getByRole('alert'))
      .toHaveTextContent(LAST_SUPER_ADMIN_MESSAGE);
  });

  test('自分のロールを下げてロールの変更の操作が消えたら、ログイン中の管理者を取り直し、閉じた後に一覧の見出しへフォーカスを移す', async () => {
    await renderWith(
      'SUPER_ADMIN',
      new Map<unknown, GraphQLHandler>([
        [
          AdminChangeRoleDocument,
          () => success({ changeAdminRole: selfAccountOf('MODERATOR') }),
        ],
        [
          AdminViewerDocument,
          () => Promise.resolve(adminViewerResult(adminWithRole('MODERATOR'))),
        ],
      ]),
    );

    await button(`「${ADMIN_NICKNAME}」のロールを変更`).click();
    const dialog = dialogNamed(`「${ADMIN_NICKNAME}」のロールを変更`);
    await dialog
      .getByRole('radio', { name: 'モデレーター', exact: true })
      .click();
    await dialog.getByRole('button', { name: '変更する' }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    expect(callsOf(executeGraphQL, AdminViewerDocument).length).toBeGreaterThan(
      0,
    );
    await expect
      .element(button(`「${ADMIN_NICKNAME}」のロールを変更`))
      .not.toBeInTheDocument();
    await expect
      .element(button('「審査の担当」のロールを変更'))
      .not.toBeInTheDocument();
    await expect.element(listHeading()).toHaveFocus();
  });

  test('変更の後も開いた元の操作が残るときは、そのボタンへフォーカスを戻す', async () => {
    await renderWith(
      'SUPER_ADMIN',
      new Map([
        [
          AdminChangeRoleDocument,
          () =>
            success({
              changeAdminRole: { ...MODERATOR_ACCOUNT, role: 'VIEWER' },
            }),
        ],
      ]),
    );

    await button('「審査の担当」のロールを変更').click();
    const dialog = dialogNamed('「審査の担当」のロールを変更');
    await dialog.getByRole('radio', { name: '閲覧のみ', exact: true }).click();
    await dialog.getByRole('button', { name: '変更する' }).click();

    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(button('「審査の担当」のロールを変更')).toHaveFocus();
  });
});

describe('プロフィールの編集', () => {
  const DIALOG = '「審査の担当」のプロフィールを編集';
  const dialog = () => dialogNamed(DIALOG);
  const nicknameInput = () =>
    dialog().getByRole('textbox', { name: 'ニックネーム(必須)' });
  const titleInput = () =>
    dialog().getByRole('textbox', { name: '肩書き(任意)' });
  const saveButton = () => dialog().getByRole('button', { name: '保存する' });

  const renderProfile = async (
    update: GraphQLHandler = () =>
      success({ updateAdminProfile: MODERATOR_ACCOUNT }),
  ) => {
    await renderWith(
      'SUPER_ADMIN',
      new Map([[AdminUpdateProfileDocument, update]]),
    );
    await button('「審査の担当」のプロフィールを編集').click();
    await expect.element(dialog()).toBeVisible();
  };

  test('現在の値から始め、画像を保ったまま編集したニックネームと肩書きを保存する', async () => {
    const update = vi.fn(() =>
      success({ updateAdminProfile: MODERATOR_ACCOUNT }),
    );
    await renderProfile(update);

    await expect.element(nicknameInput()).toHaveValue('審査の担当');
    await expect.element(titleInput()).toHaveValue('モデレーション担当');
    await userEvent.fill(nicknameInput(), ' 審査の責任者 ');
    await userEvent.fill(titleInput(), '');
    await saveButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      id: MODERATOR_ACCOUNT.id,
      nickname: '審査の責任者',
      title: null,
      avatarFileId: AVATAR.id,
    });
    await expect
      .poll(() => callsOf(executeGraphQL, AdminAccountsDocument).length)
      .toBe(2);
  });

  test('画像を取り除くと、既定のアイコンに戻す旨を示し、画像なしで保存する', async () => {
    const update = vi.fn(() =>
      success({ updateAdminProfile: MODERATOR_ACCOUNT }),
    );
    await renderProfile(update);

    await dialog().getByRole('button', { name: '画像を取り除く' }).click();
    await expect
      .element(dialog())
      .toHaveTextContent('ニックネームから作るアイコンを表示します。');
    await saveButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      id: MODERATOR_ACCOUNT.id,
      nickname: '審査の担当',
      title: 'モデレーション担当',
      avatarFileId: null,
    });
  });

  test('管理者の画像の用途でアップロードした画像を保存する', async () => {
    const uploads = stubUploadFetch();
    const update = vi.fn(() =>
      success({ updateAdminProfile: MODERATOR_ACCOUNT }),
    );
    await renderProfile(update);
    const svg = createSvgFile('avatar.svg');

    const input = dialog()
      .element()
      .querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) {
      throw new Error('ファイルの入力欄が描画されていません。');
    }
    await userEvent.upload(input, [svg]);
    await uploads.reply(uploadedReply(svg, UPLOADED_FILE_ID));
    await expect
      .element(dialog().getByText('アップロード済み').first())
      .toBeVisible();
    await saveButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(uploads.calls[0]?.path).toContain('/_bff/uploads/admin-avatar');
    expect(update).toHaveBeenCalledExactlyOnceWith({
      id: MODERATOR_ACCOUNT.id,
      nickname: '審査の担当',
      title: 'モデレーション担当',
      avatarFileId: UPLOADED_FILE_ID,
    });
  });

  test('入力の違反は欄ごとに示し、サーバーの欄の詳細も欄に示す', async () => {
    await renderProfile(() =>
      failure({
        code: 'validation_error',
        message: '入力内容を確認してください。',
        status: 200,
        details: [
          {
            field: 'title',
            code: 'too-long',
            message: '肩書きは50文字以内で入力してください。',
          },
        ],
      }),
    );

    await userEvent.fill(nicknameInput(), '');
    await titleInput().click();
    await expect
      .element(nicknameInput())
      .toHaveAccessibleDescription(/ニックネームを入力してください。/);
    await userEvent.fill(nicknameInput(), '審査の担当');
    await saveButton().click();

    await expect
      .element(titleInput())
      .toHaveAccessibleDescription(/肩書きは50文字以内で入力してください。/);
    await expect.element(titleInput()).toHaveAttribute('aria-invalid', 'true');
  });

  test('画像のアップロード中に保存すると、以前の画像のまま保存せずダイアログを開いたまま画像の欄に待つ旨を示し、アップロードの後に新しい画像で保存する', async () => {
    const uploads = stubUploadFetch();
    const update = vi.fn(() =>
      success({ updateAdminProfile: MODERATOR_ACCOUNT }),
    );
    await renderProfile(update);
    const avatarButton = dialog().getByRole('button', {
      name: 'プロフィール画像(任意) 画像を選択',
      exact: true,
    });
    const svg = createSvgFile('avatar.svg');
    const input = dialog()
      .element()
      .querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) {
      throw new Error('ファイルの入力欄が描画されていません。');
    }

    await userEvent.upload(input, [svg]);
    await expect.poll(() => uploads.pendingCount()).toBe(1);
    await saveButton().click();

    await expect
      .element(avatarButton)
      .toHaveAccessibleDescription(
        /プロフィール画像のアップロードが終わってから、もう一度お試しください。/,
      );
    await expect.element(avatarButton).toHaveFocus();
    await expect.element(dialog()).toBeVisible();
    expect(update).not.toHaveBeenCalled();

    await uploads.reply(uploadedReply(svg, UPLOADED_FILE_ID));
    await expect
      .element(dialog().getByText('アップロード済み').first())
      .toBeVisible();
    await saveButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      id: MODERATOR_ACCOUNT.id,
      nickname: '審査の担当',
      title: 'モデレーション担当',
      avatarFileId: UPLOADED_FILE_ID,
    });
  });

  test('欄に対応しない失敗は、ダイアログの中に問い合わせを促さない文言で示す', async () => {
    await renderProfile(() =>
      failure({
        code: 'invalid_upload',
        message:
          '画像を確認できませんでした。もう一度アップロードしてください。',
        status: 200,
      }),
    );

    await saveButton().click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(
        '画像を確認できませんでした。もう一度アップロードしてください。',
      );
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('ロールの変更とプロフィールの編集のダイアログのアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderWith('SUPER_ADMIN', new Map());

    await button('「統括の担当」のロールを変更').click();
    const roleDialog = dialogNamed('「統括の担当」のロールを変更');
    await expect.element(roleDialog).toBeVisible();
    expect(await runAxe(roleDialog.element())).toStrictEqual([]);
    await roleDialog.getByRole('button', { name: 'キャンセル' }).click();
    await expect.element(roleDialog).not.toBeInTheDocument();

    await button(
      `「${SUPER_ADMIN_ACCOUNT.nickname ?? ''}」のプロフィールを編集`,
    ).click();
    const profileDialog = dialogNamed('「統括の担当」のプロフィールを編集');
    await expect.element(profileDialog).toBeVisible();
    expect(await runAxe(profileDialog.element())).toStrictEqual([]);
  });
});
