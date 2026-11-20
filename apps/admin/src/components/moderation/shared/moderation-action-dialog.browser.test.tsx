import { useState } from 'react';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import { emulateBrowserDisplay } from '../../../../lib/test/display-emulation.ts';
import { UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT } from '../../../../lib/utilities/messages/state-messages.ts';
import { failure } from '../../../../test/admin-accounts-fixtures.ts';
import {
  ACTIVE_USER_NODE,
  adminUsersQueryOf,
  changedResult,
  LOGO_FILE_ID,
  MODERATION_DISPLAY,
  MODERATION_REASON,
  type ModerationGraphQLHandler,
  respondModerationGraphQL,
  USER_ID,
  variablesOf,
} from '../../../../test/moderation-fixtures.ts';
import { renderModerationPart } from '../../../../test/moderation-render.tsx';
import { adminModerationUsersQueryOptions } from '../../../graphql/admin-moderation-users.ts';
import { adminQuarantinedImagesQueryOptions } from '../../../graphql/admin-quarantined-images.ts';
import {
  AdminDeleteQuarantinedImageDocument,
  AdminSuspendUserDocument,
} from '../../../graphql/generated/graphql.ts';
import { ModerationActionDialog } from './moderation-action-dialog.tsx';
import {
  IMAGE_DIALOG_COPY,
  suspendUserDialogCopy,
} from './moderation-messages.ts';
import type { ModerationOperation } from './moderation-operations.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const OPENER = '措置の確認を開く';

const SUSPEND_COPY = suspendUserDialogCopy('サンプル太郎');

const SUSPEND_DESCRIPTION =
  'この利用者のプロフィール・プロダクト・コメント・評価は他の利用者に表示されなくなり、未開始のマッチ予定は取り消されます(停止を解除しても戻りません)。利用者へ停止の通知を送ります。';

const PERSONAL_INFORMATION_NOTICE =
  '理由には、ユーザーや管理者のメールアドレス・氏名などの個人情報を含めないでください。';

const AUDITED_NOTICE = 'この操作は監査ログに記録されます。';

const CONFLICT_MESSAGE =
  '他の操作で状態が変わりました。最新の内容を読み込んでからやり直してください。';

interface HarnessProps {
  readonly operation: ModerationOperation;
  readonly targetId: string;
  readonly onCompleted: (changed: boolean) => void;
}

function Harness({ operation, targetId, onCompleted }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const copy =
    operation === 'user.suspend'
      ? SUSPEND_COPY
      : IMAGE_DIALOG_COPY[operation as keyof typeof IMAGE_DIALOG_COPY];
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        {OPENER}
      </button>
      <ModerationActionDialog
        open={open}
        onOpenChange={setOpen}
        operation={operation}
        targetId={targetId}
        title={copy.title}
        description={copy.description}
        confirmLabel={copy.confirmLabel}
        onCompleted={({ changed }) => {
          onCompleted(changed);
        }}
      />
    </>
  );
}

const renderDialog = async ({
  operation = 'user.suspend',
  targetId = USER_ID,
  handlers = new Map(),
}: {
  readonly operation?: ModerationOperation;
  readonly targetId?: string;
  readonly handlers?: ReadonlyMap<unknown, ModerationGraphQLHandler>;
} = {}) => {
  respondModerationGraphQL(executeGraphQL, { role: 'MODERATOR', handlers });
  const onCompleted = vi.fn<(changed: boolean) => void>();
  const router = await renderModerationPart(
    <Harness
      operation={operation}
      targetId={targetId}
      onCompleted={onCompleted}
    />,
    { role: 'MODERATOR' },
  );
  const { queryClient } = router.options.context;
  const usersKey = adminModerationUsersQueryOptions({}).queryKey;
  queryClient.setQueryData(usersKey, adminUsersQueryOf([ACTIVE_USER_NODE]));
  const imagesKey = adminQuarantinedImagesQueryOptions('auto').queryKey;
  queryClient.setQueryData(imagesKey, { pages: [], pageParams: [] });
  return {
    onCompleted,
    usersInvalidated: () =>
      queryClient.getQueryState(usersKey)?.isInvalidated ?? false,
    imagesInvalidated: () =>
      queryClient.getQueryState(imagesKey)?.isInvalidated ?? false,
  };
};

const dialog = () => page.getByRole('dialog');
const confirmButton = (label = SUSPEND_COPY.confirmLabel) =>
  dialog().getByRole('button', { name: label, exact: true });
const reasonBox = (label = '理由(必須)') =>
  dialog().getByRole('textbox', { name: label, exact: true });

const openDialog = async (): Promise<void> => {
  await page.getByRole('button', { name: OPENER, exact: true }).click();
  await expect.element(dialog()).toBeVisible();
};

const suspendWith =
  (changed: boolean): ModerationGraphQLHandler =>
  () =>
    changedResult('suspendUser', changed);

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  applyColorScheme('light');
  await emulateBrowserDisplay(null);
});

describe('確認の内容', () => {
  test('題名に対象、説明の文に措置の影響を示し、一覧の要素を置かず、理由(必須)の欄と個人情報の注記・監査ログに記録される旨を示す', async () => {
    await renderDialog();

    await openDialog();

    await expect
      .element(page.getByRole('dialog', { name: SUSPEND_COPY.title }))
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(SUSPEND_DESCRIPTION);
    expect(dialog().element().querySelectorAll('ul, ol, li')).toHaveLength(0);
    await expect.element(reasonBox()).toBeVisible();
    await expect
      .element(reasonBox())
      .toHaveAccessibleDescription(PERSONAL_INFORMATION_NOTICE);
    await expect.element(dialog().getByText(AUDITED_NOTICE)).toBeVisible();
    await expect.element(confirmButton()).toBeVisible();
  });

  test('理由を必須とする措置は、理由が空・空白だけの間と500文字を超える間は確定できず、500文字なら確定できる', async () => {
    await renderDialog();
    await openDialog();

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

  test('理由を任意とする画像の措置は、理由(任意)の欄を示し、理由が無くても確定できる', async () => {
    await renderDialog({
      operation: 'image.approve',
      targetId: LOGO_FILE_ID,
    });

    await openDialog();

    await expect.element(reasonBox('理由(任意)')).toBeVisible();
    await expect
      .element(confirmButton(IMAGE_DIALOG_COPY['image.approve'].confirmLabel))
      .toBeEnabled();
  });
});

describe('確定', () => {
  test('確定すると対象と前後の空白を除いた理由で措置を行い、閉じて成功を知らせ、照会を無効にする', async () => {
    const { onCompleted, usersInvalidated } = await renderDialog({
      handlers: new Map([[AdminSuspendUserDocument, suspendWith(true)]]),
    });
    await openDialog();

    await reasonBox().fill(`  ${MODERATION_REASON}\n`);
    await confirmButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(variablesOf(executeGraphQL, AdminSuspendUserDocument)).toStrictEqual(
      [{ id: USER_ID, reason: MODERATION_REASON }],
    );
    await expect
      .element(page.getByText('ユーザーを停止しました。'))
      .toBeVisible();
    expect(usersInvalidated()).toBe(true);
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(true);
  });

  test('既に同じ状態なら、状態が変わらなかった旨を知らせて照会を無効にする', async () => {
    const { onCompleted, usersInvalidated } = await renderDialog({
      handlers: new Map([[AdminSuspendUserDocument, suspendWith(false)]]),
    });
    await openDialog();

    await reasonBox().fill(MODERATION_REASON);
    await confirmButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(page.getByText('既に停止中です。')).toBeVisible();
    expect(page.getByText('ユーザーを停止しました。').query()).toBeNull();
    expect(usersInvalidated()).toBe(true);
    expect(onCompleted).toHaveBeenCalledExactlyOnceWith(false);
  });

  test('公開拒否は削除の措置を行い、公開拒否の結果を知らせて隔離画像の照会を無効にする', async () => {
    const { imagesInvalidated } = await renderDialog({
      operation: 'image.reject',
      targetId: LOGO_FILE_ID,
      handlers: new Map([
        [
          AdminDeleteQuarantinedImageDocument,
          () => changedResult('deleteQuarantinedImage', true),
        ],
      ]),
    });
    await openDialog();

    await confirmButton(IMAGE_DIALOG_COPY['image.reject'].confirmLabel).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminDeleteQuarantinedImageDocument),
    ).toStrictEqual([{ fileId: LOGO_FILE_ID, reason: '' }]);
    await expect
      .element(page.getByText('画像の公開を拒否しました。'))
      .toBeVisible();
    expect(imagesInvalidated()).toBe(true);
  });

  test('拒否されると、サーバーの文言をダイアログの中に示して理由の入力を保ち、知らせず照会も無効にしない', async () => {
    const { onCompleted, usersInvalidated } = await renderDialog({
      handlers: new Map([
        [
          AdminSuspendUserDocument,
          () =>
            failure({
              code: 'account_state_conflict',
              message: CONFLICT_MESSAGE,
              status: 409,
            }),
        ],
      ]),
    });
    await openDialog();

    await reasonBox().fill(MODERATION_REASON);
    await confirmButton().click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(CONFLICT_MESSAGE);
    await expect.element(reasonBox()).toHaveValue(MODERATION_REASON);
    expect(usersInvalidated()).toBe(false);
    expect(onCompleted).not.toHaveBeenCalled();
  });

  test('`GraphQLClientError`でない失敗は、問い合わせを促さない管理者側の文言をダイアログの中に示し、もう一度確定できる', async () => {
    let attempts = 0;
    await renderDialog({
      handlers: new Map([
        [
          AdminSuspendUserDocument,
          () => {
            attempts += 1;
            return attempts === 1
              ? Promise.reject(new Error('network down'))
              : changedResult('suspendUser', true);
          },
        ],
      ]),
    });
    await openDialog();

    await reasonBox().fill(MODERATION_REASON);
    await confirmButton().click();

    const alert = dialog().getByRole('alert');
    await expect
      .element(alert)
      .toHaveTextContent(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT);
    await expect.element(alert).not.toHaveTextContent('問い合わせ');
    await expect.element(alert).not.toHaveTextContent('network down');

    await confirmButton().click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(variablesOf(executeGraphQL, AdminSuspendUserDocument)).toHaveLength(
      2,
    );
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('開いたダイアログのアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    await renderDialog();
    await openDialog();

    expect(await runAxe(dialog().element())).toStrictEqual([]);
  });
});
