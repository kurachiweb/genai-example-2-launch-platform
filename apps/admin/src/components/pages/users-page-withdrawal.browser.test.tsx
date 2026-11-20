import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../lib/utilities/messages/state-messages.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import {
  ACTIVE_USER_NODE,
  changedResult,
  MODERATION_DISPLAY,
  MODERATION_REASON,
  type ModerationGraphQLHandler,
  variablesOf,
} from '../../../test/moderation-fixtures.ts';
import {
  SUSPENDED_USER_NODE,
  USER_NODES,
  usersQueryOf,
} from '../../../test/moderation-users-fixtures.tsx';
import {
  actionButton,
  actionNames,
  dialog,
  listHeading,
  reasonBox,
  rowOf,
  table,
  usersPageHarness,
} from '../../../test/moderation-users-page.ts';
import { AdminWithdrawUserByAdministratorDocument } from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const { renderWith } = usersPageHarness(executeGraphQL);

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

const WITHDRAW_TARO = '「サンプル太郎」の代理の退会';

const OUTSIDE_EMAIL_NOTICE =
  '退会は取り消せず、利用者のデータは退会の規則どおりに削除されます。本人の意思の確かめと退会の完了の知らせは、システムの外のメールで行ってください。';

const PERSONAL_INFORMATION_NOTICE =
  '理由には、ユーザーや管理者のメールアドレス・氏名などの個人情報を含めないでください。';

const confirmButton = () =>
  dialog().getByRole('button', { name: '退会させる', exact: true });

const withdrawalVariables = () =>
  variablesOf(executeGraphQL, AdminWithdrawUserByAdministratorDocument);

const renderAsSuperAdmin = (
  handler?: ModerationGraphQLHandler,
  users?: () => Promise<unknown>,
) =>
  renderWith({
    role: 'SUPER_ADMIN',
    ...(users === undefined ? {} : { users }),
    ...(handler === undefined
      ? {}
      : {
          handlers: new Map([
            [AdminWithdrawUserByAdministratorDocument, handler],
          ]),
        }),
  });

const openWithdrawal = async (name = WITHDRAW_TARO): Promise<void> => {
  await userEvent.click(actionButton(name));
  await expect.element(dialog()).toBeVisible();
};

describe('代理の退会の操作の表示', () => {
  test.each(['VIEWER', 'MODERATOR'] as const)(
    '%sには「代理の退会」を出さない',
    async (role) => {
      await renderWith({ role });
      await expect.element(table()).toBeVisible();

      expect(
        actionNames().filter((name) => name?.endsWith('の代理の退会')),
      ).toStrictEqual([]);
      expect(
        table()
          .getByRole('button', { name: /代理の退会/u })
          .query(),
      ).toBeNull();
    },
  );

  test('最上位管理者には、停止状態によらず全ての行に「代理の退会」を対象のニックネームを含む名前で置く', async () => {
    await renderAsSuperAdmin();
    await expect.element(table()).toBeVisible();

    expect(actionNames()).toStrictEqual([
      '「サンプル太郎」を停止',
      '「サンプル太郎」の代理の退会',
      '「サンプル花子」を停止',
      '「サンプル花子」のプロフィール画像を隔離',
      '「サンプル花子」の代理の退会',
      '「サンプル次郎」の停止解除',
      '「サンプル次郎」の代理の退会',
      '「サンプル三郎」の停止解除',
      '「サンプル三郎」の代理の退会',
    ]);
    await expect
      .element(actionButton(WITHDRAW_TARO))
      .toHaveTextContent('代理の退会');
  });
});

describe('代理の退会の確認', () => {
  test('題名にニックネーム、説明の文にハンドル・停止状態・取り消せない旨・システムの外のメールで行う旨を示し、理由(必須)の欄と個人情報の注記・監査ログに記録される旨を出す', async () => {
    await renderAsSuperAdmin();

    await openWithdrawal();

    await expect
      .element(
        page.getByRole('dialog', {
          name: 'ユーザー「サンプル太郎」を退会させますか?',
        }),
      )
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        `対象は@maker_ai(利用中)の利用者です。${OUTSIDE_EMAIL_NOTICE}`,
      );
    expect(dialog().element().querySelectorAll('ul, ol, li')).toHaveLength(0);
    await expect.element(reasonBox()).toBeVisible();
    await expect
      .element(reasonBox())
      .toHaveAccessibleDescription(PERSONAL_INFORMATION_NOTICE);
    await expect
      .element(dialog().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();
  });

  test('停止中の利用者の確認には停止中であることを示す', async () => {
    await renderAsSuperAdmin();

    await openWithdrawal('「サンプル次郎」の代理の退会');

    await expect
      .element(
        page.getByRole('dialog', {
          name: 'ユーザー「サンプル次郎」を退会させますか?',
        }),
      )
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        `対象は@spam_jiro(停止中)の利用者です。${OUTSIDE_EMAIL_NOTICE}`,
      );
  });

  test('問い合わせの詳細への導線と本人の意思の確認欄を置かない', async () => {
    await renderAsSuperAdmin();

    await openWithdrawal();

    expect(dialog().getByRole('link').query()).toBeNull();
    expect(dialog().getByRole('checkbox').query()).toBeNull();
    expect(dialog().element().textContent).not.toContain('問い合わせ');
    expect(
      dialog()
        .getByRole('textbox')
        .elements()
        .map((element) => element.getAttribute('name')),
    ).toStrictEqual(['reason']);
  });

  test('理由が空・空白だけの間と500文字を超える間は確定できず、500文字なら確定できる', async () => {
    await renderAsSuperAdmin();
    await openWithdrawal();

    await expect.element(confirmButton()).toBeDisabled();
    await reasonBox().fill(' 　');
    await expect.element(confirmButton()).toBeDisabled();
    await reasonBox().fill('あ'.repeat(501));
    await userEvent.tab();
    await expect
      .element(dialog().getByText('理由は500文字以内で入力してください。'))
      .toBeVisible();
    await expect.element(confirmButton()).toBeDisabled();

    await reasonBox().fill('あ'.repeat(500));
    await expect.element(confirmButton()).toBeEnabled();
  });

  test('取り消すと退会させずに閉じ、押した「代理の退会」へフォーカスを戻す', async () => {
    await renderAsSuperAdmin();
    await openWithdrawal();

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(actionButton(WITHDRAW_TARO)).toHaveFocus();
    expect(withdrawalVariables()).toStrictEqual([]);
  });
});

describe('代理の退会の確定', () => {
  test('理由を付けて確定すると対象を退会させて知らせ、一覧から利用者が消え、一覧の見出しへフォーカスを移す', async () => {
    let withdrawn = false;
    await renderAsSuperAdmin(
      () => {
        withdrawn = true;
        return changedResult('withdrawUserByAdministrator', true);
      },
      () =>
        success(
          usersQueryOf(
            withdrawn
              ? USER_NODES.filter((node) => node.id !== ACTIVE_USER_NODE.id)
              : USER_NODES,
          ),
        ),
    );
    await openWithdrawal();

    await reasonBox().fill(MODERATION_REASON);
    await confirmButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(withdrawalVariables()).toStrictEqual([
      { input: { userId: ACTIVE_USER_NODE.id, reason: MODERATION_REASON } },
    ]);
    await expect
      .element(page.getByText('ユーザーを退会させました。'))
      .toBeVisible();
    await expect
      .element(rowOf(ACTIVE_USER_NODE.nickname))
      .not.toBeInTheDocument();
    await expect.element(rowOf(SUSPENDED_USER_NODE.nickname)).toBeVisible();
    await expect.element(listHeading()).toHaveFocus();
  });

  test('サーバーが拒否すると、サーバーの文言をダイアログの中に示して理由の入力を保つ', async () => {
    await renderAsSuperAdmin(() =>
      failure({
        code: 'user_not_found',
        message: 'ユーザーが見つかりません。',
        status: 404,
      }),
    );
    await openWithdrawal();

    await reasonBox().fill(MODERATION_REASON);
    await confirmButton().click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('ユーザーが見つかりません。');
    await expect.element(reasonBox()).toHaveValue(MODERATION_REASON);
    expect(page.getByText('ユーザーを退会させました。').query()).toBeNull();
  });

  test('`GraphQLClientError`でない失敗は、問い合わせを促さない管理者側の文言をダイアログの中に示し、理由の入力を保つ', async () => {
    await renderAsSuperAdmin(() => Promise.reject(new Error('network down')));
    await openWithdrawal();

    await reasonBox().fill(MODERATION_REASON);
    await confirmButton().click();

    const alert = dialog().getByRole('alert');
    await expect
      .element(alert)
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    await expect.element(alert).not.toHaveTextContent('問い合わせ');
    await expect.element(reasonBox()).toHaveValue(MODERATION_REASON);
  });
});

describe('アクセシビリティ', () => {
  test.each(COLOR_SCHEMES)(
    '%sの配色で、代理の退会の操作を置いた一覧と確認のダイアログがWCAG 2.2 AAの自動検査に違反しない',
    async (scheme) => {
      applyColorScheme(scheme);
      await renderAsSuperAdmin();
      await expect.element(actionButton(WITHDRAW_TARO)).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);

      await openWithdrawal();

      expect(await runAxe(document.body)).toStrictEqual([]);
    },
  );
});
