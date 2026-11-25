import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { createModerationTargets } from '../support/moderation-fixtures.ts';
import { expectProductNotFound } from '../client/directory-steps.ts';
import { expect, test } from './client-page-test.ts';
import {
  expectActiveUser,
  expectListedInDirectory,
  expectNotListedInDirectory,
  expectSuspendedUser,
  expectSuspensionNotice,
  moderateUser,
  moderationAuditLogRows,
  searchUserByHandle,
} from './user-moderation-steps.ts';

// 管理者の招待の完了に、ローカルのD1の操作と停止の通知の待ちと利用者側の確認の分を足す
test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS * 2 });

// 監査ログと通知に残る理由。個人情報を含めない
const SUSPEND_REASON = 'E2Eの利用規約違反による停止の確認';

const UNSUSPEND_REASON = 'E2Eの停止解除の確認';

// 措置の対象は実行のたびに乱数の接尾辞で別に作り、前回の実行のデータを消さないため、後片付けをしない
test.describe('利用者の措置(管理者側)', () => {
  test('モデレーターがハンドルで検索した利用者を停止すると、その利用者のプロダクトがディレクトリから消え、停止の通知が届き、監査ログに記録され、理由を入力した停止解除でディレクトリに戻る', async ({
    page,
    clientPage,
  }) => {
    const targets = await createModerationTargets();
    const { product } = targets;
    await expectListedInDirectory(
      clientPage,
      targets.productName,
      product.launchDate,
    );
    const admin = await signInAsNewAdmin(page, { role: 'moderator' });

    const suspendedAfter = new Date();
    const row = await searchUserByHandle(page, admin, product.ownerHandle);
    await moderateUser(
      page,
      row,
      'user.suspend',
      product.ownerNickname,
      SUSPEND_REASON,
    );
    await expectSuspendedUser(row, SUSPEND_REASON);

    await expectNotListedInDirectory(
      clientPage,
      targets.productName,
      product.launchDate,
    );
    await expectProductNotFound(clientPage, targets.productHandle);
    await expectSuspensionNotice(
      product.ownerEmail,
      SUSPEND_REASON,
      suspendedAfter,
    );

    const suspensionLogs = await moderationAuditLogRows(
      page,
      admin,
      'user.suspend',
      product.ownerPseudonymousId,
    );
    await expect(suspensionLogs).toHaveCount(1);
    await expect(suspensionLogs).toContainText(SUSPEND_REASON);

    const suspendedRow = await searchUserByHandle(
      page,
      admin,
      product.ownerHandle,
    );
    await moderateUser(
      page,
      suspendedRow,
      'user.unsuspend',
      product.ownerNickname,
      UNSUSPEND_REASON,
    );
    await expectActiveUser(suspendedRow);

    await expectListedInDirectory(
      clientPage,
      targets.productName,
      product.launchDate,
    );
    const unsuspensionLogs = await moderationAuditLogRows(
      page,
      admin,
      'user.unsuspend',
      product.ownerPseudonymousId,
    );
    await expect(unsuspensionLogs).toHaveCount(1);
    await expect(unsuspensionLogs).toContainText(UNSUSPEND_REASON);
  });
});
