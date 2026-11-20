import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import '../../styles.css';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import { failure, success } from '../../../test/admin-accounts-fixtures.ts';
import { buttonBehindDialog } from '../../../test/moderation-render.tsx';
import {
  changedResult,
  MODERATION_DISPLAY,
  MODERATION_REASON,
  MODERATION_ROLES,
  variablesOf,
} from '../../../test/moderation-fixtures.ts';
import {
  ADMIN_AVATAR_IMAGE,
  AUTO_AND_ADMIN_LOGO_IMAGE,
  AUTO_AVATAR_IMAGE,
  actionButton,
  actionNames,
  dialog,
  imageList,
  imagesByReason,
  itemOf,
  mediaPageHarness,
  quarantinedImagesOf,
  reasonBox,
  tabPanel,
} from '../../../test/moderation-media-fixtures.tsx';
import {
  AdminApproveQuarantinedImageDocument,
  AdminDeleteQuarantinedImageDocument,
  AdminReleaseQuarantinedImageDocument,
} from '../../graphql/generated/graphql.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const { renderWith, imagesVariables } = mediaPageHarness(executeGraphQL);

beforeEach(async () => {
  executeGraphQL.mockReset();
  await emulateBrowserDisplay(MODERATION_DISPLAY);
});

afterEach(async () => {
  toast.dismiss();
  await emulateBrowserDisplay(null);
});

const APPROVE_NAME = 'サンプル太郎(@maker_ai)のプロフィール画像の公開承認';
const REJECT_NAME = 'サンプル太郎(@maker_ai)のプロフィール画像の公開拒否';

describe('画像の操作の表示', () => {
  test('閲覧のみの管理者には画像の操作を出さない', async () => {
    await renderWith({ role: 'VIEWER' });
    await expect.element(itemOf('サンプル太郎')).toBeVisible();

    expect(actionNames()).toStrictEqual([]);
  });

  test.each(MODERATION_ROLES)(
    '%sには、自動判定の画像に公開承認と公開拒否、管理者操作の画像に隔離の解除と削除を、保有者と用途を含む名前で置く',
    async (role) => {
      await renderWith({ role });
      await expect.element(itemOf('サンプル太郎')).toBeVisible();

      expect(actionNames()).toStrictEqual([
        APPROVE_NAME,
        REJECT_NAME,
        'サンプル花子(@pixel_hanako)のロゴの公開承認',
        'サンプル花子(@pixel_hanako)のロゴの公開拒否',
        'サンプル花子(@pixel_hanako)のロゴの隔離の解除',
        'サンプル花子(@pixel_hanako)のロゴの削除',
      ]);
      expect(
        imageList()
          .getByRole('button')
          .elements()
          .map((button) => button.textContent),
      ).toStrictEqual([
        '公開承認',
        '公開拒否',
        '公開承認',
        '公開拒否',
        '隔離の解除',
        '削除',
      ]);
    },
  );

  test('非公開化・ユーザー停止の隔離理由だけの画像には削除だけを置き、理由を外す操作を置かない', async () => {
    await renderWith({
      role: 'MODERATOR',
      path: '/media-moderation?reason=user_suspended',
    });
    await expect.element(itemOf('sponsor-banner')).toBeVisible();

    expect(actionNames()).toStrictEqual([
      '表示できない利用者のスクリーンショットの削除',
      'システムのsponsor-bannerの削除',
    ]);
  });
});

describe('画像の操作の確定', () => {
  test('公開承認の確認に影響を説明の文で示し、理由が無くても確定でき、知らせて一覧を取り直し、消えた項目の代わりにタブの区画へフォーカスを移す', async () => {
    let approved = false;
    await renderWith({
      role: 'MODERATOR',
      images: (variables) =>
        approved
          ? success(quarantinedImagesOf([AUTO_AND_ADMIN_LOGO_IMAGE]))
          : imagesByReason(variables),
      handlers: new Map([
        [
          AdminApproveQuarantinedImageDocument,
          () => {
            approved = true;
            return changedResult('approveQuarantinedImage', true);
          },
        ],
      ]),
    });
    await userEvent.click(actionButton(APPROVE_NAME));

    await expect
      .element(
        page.getByRole('dialog', { name: 'この画像の公開を承認しますか?' }),
      )
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        '自動判定の隔離理由を外します。他の隔離理由が残っている間は公開に戻りません。',
      );
    await expect
      .element(dialog().getByText('この操作は監査ログに記録されます。'))
      .toBeVisible();
    await expect.element(reasonBox()).toHaveValue('');
    await dialog().getByRole('button', { name: '公開を承認する' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    expect(
      variablesOf(executeGraphQL, AdminApproveQuarantinedImageDocument),
    ).toStrictEqual([{ fileId: AUTO_AVATAR_IMAGE.file.id, reason: '' }]);
    await expect
      .element(page.getByText('画像の公開を承認しました。'))
      .toBeVisible();
    await expect.element(itemOf('サンプル太郎')).not.toBeInTheDocument();
    expect(imagesVariables().length).toBeGreaterThan(1);
    await expect.element(tabPanel()).toHaveFocus();
  });

  test('公開拒否は画像を削除する操作で行い、削除して元に戻せない旨を確認に示す', async () => {
    await renderWith({
      role: 'SUPER_ADMIN',
      handlers: new Map([
        [
          AdminDeleteQuarantinedImageDocument,
          () => changedResult('deleteQuarantinedImage', true),
        ],
      ]),
    });
    await userEvent.click(actionButton(REJECT_NAME));

    await expect
      .element(
        page.getByRole('dialog', { name: 'この画像の公開を拒否しますか?' }),
      )
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        '画像を削除します。削除した画像は元に戻せません。',
      );
    await reasonBox().fill(MODERATION_REASON);
    await dialog().getByRole('button', { name: '公開を拒否する' }).click();

    await expect
      .element(page.getByText('画像の公開を拒否しました。'))
      .toBeVisible();
    expect(
      variablesOf(executeGraphQL, AdminDeleteQuarantinedImageDocument),
    ).toStrictEqual([
      { fileId: AUTO_AVATAR_IMAGE.file.id, reason: MODERATION_REASON },
    ]);
  });

  test('隔離の解除で既に理由が外れていた時は、状態が変わらなかった旨を知らせる', async () => {
    await renderWith({
      role: 'MODERATOR',
      path: '/media-moderation?reason=admin_action',
      handlers: new Map([
        [
          AdminReleaseQuarantinedImageDocument,
          () => changedResult('releaseQuarantinedImage', false),
        ],
      ]),
    });
    await userEvent.click(
      actionButton(
        '運営サンプル(管理者)の管理者のプロフィール画像の隔離の解除',
      ),
    );

    await expect
      .element(
        page.getByRole('dialog', { name: 'この画像の隔離を解除しますか?' }),
      )
      .toBeVisible();
    await expect
      .element(dialog())
      .toHaveAccessibleDescription(
        '管理者操作の隔離理由を外します。他の隔離理由が残っている間は公開に戻りません。',
      );
    await dialog().getByRole('button', { name: '隔離を解除する' }).click();

    await expect
      .element(page.getByText('この隔離理由は既に外れています。'))
      .toBeVisible();
    expect(
      variablesOf(executeGraphQL, AdminReleaseQuarantinedImageDocument),
    ).toStrictEqual([{ fileId: ADMIN_AVATAR_IMAGE.file.id, reason: '' }]);
  });

  test('削除の確定の後の画像の削除が一時的に失敗した時は、ダイアログの中に失敗の文言を示し、入力した理由を保つ', async () => {
    const message =
      '画像の保存先を変更できませんでした。時間をおいて再度お試しください。';
    await renderWith({
      role: 'MODERATOR',
      path: '/media-moderation?reason=admin_action',
      handlers: new Map([
        [
          AdminDeleteQuarantinedImageDocument,
          () => failure({ code: 'storage_unavailable', message, status: 503 }),
        ],
      ]),
    });
    await userEvent.click(
      actionButton('運営サンプル(管理者)の管理者のプロフィール画像の削除'),
    );

    await expect
      .element(page.getByRole('dialog', { name: 'この画像を削除しますか?' }))
      .toHaveAccessibleDescription('削除した画像は元に戻せません。');
    await reasonBox().fill(MODERATION_REASON);
    await dialog().getByRole('button', { name: '削除する' }).click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent(message);
    await expect.element(reasonBox()).toHaveValue(MODERATION_REASON);
    expect(
      dialog()
        .getByRole('link', { name: /問い合わせ/u })
        .query(),
    ).toBeNull();
  });

  test('確定の時点で画像が見つからないと、一覧を取り直して項目が消えても、ダイアログの中に文言を示して理由を保ち、閉じるとタブの区画へフォーカスを移す', async () => {
    let missing = false;
    await renderWith({
      role: 'MODERATOR',
      images: (variables) =>
        missing
          ? success(quarantinedImagesOf([AUTO_AND_ADMIN_LOGO_IMAGE]))
          : imagesByReason(variables),
      handlers: new Map([
        [
          AdminDeleteQuarantinedImageDocument,
          () => {
            missing = true;
            return failure({
              code: 'image_not_found',
              message: '画像が見つかりません。',
              status: 404,
            });
          },
        ],
      ]),
    });
    await userEvent.click(actionButton(REJECT_NAME));
    await reasonBox().fill(MODERATION_REASON);
    await dialog().getByRole('button', { name: '公開を拒否する' }).click();

    await expect
      .element(dialog().getByRole('alert'))
      .toHaveTextContent('画像が見つかりません。');
    await expect
      .element(buttonBehindDialog(REJECT_NAME))
      .not.toBeInTheDocument();
    await expect
      .element(buttonBehindDialog('サンプル花子(@pixel_hanako)のロゴの削除'))
      .toBeInTheDocument();
    await expect.element(reasonBox()).toHaveValue(MODERATION_REASON);

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(tabPanel()).toHaveFocus();
  });

  test('取り消すと操作せずに閉じ、押した操作へフォーカスを戻す', async () => {
    await renderWith({ role: 'MODERATOR' });
    await userEvent.click(actionButton(APPROVE_NAME));
    await expect.element(dialog()).toBeVisible();

    await dialog().getByRole('button', { name: 'キャンセル' }).click();

    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(actionButton(APPROVE_NAME)).toHaveFocus();
    expect(
      variablesOf(executeGraphQL, AdminApproveQuarantinedImageDocument),
    ).toStrictEqual([]);
  });
});
