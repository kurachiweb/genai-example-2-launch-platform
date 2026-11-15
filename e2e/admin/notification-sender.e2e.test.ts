import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import {
  readSenderInfoSnapshot,
  restoreSenderInfo,
} from '../support/notification-fixtures.ts';
import { expect, test } from './admin-test.ts';
import {
  createSenderInfoInput,
  expectSavedSenderInfo,
  openSenderInfoSettings,
  saveSenderInfo,
  senderInfoAuditLogRows,
} from './notification-sender-steps.ts';

test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS });

// 監査ログに残る理由。個人情報を含めない
const CHANGE_REASON = 'E2Eの送信者情報の保存の確認';

// 送信者情報の行は共有のローカルのD1に1つだけあり、設定されている間は通知メールが送られ得るため、確かめた後に保存の前の行へ戻す
test.describe('通知メールの送信者情報(管理者側)', () => {
  test('最上位管理者が設定のページで3項目を保存すると、トーストと区画が保存した値と変更した管理者を示し、監査ログの一覧に理由とともに記録が出る', async ({
    page,
  }) => {
    const original = await readSenderInfoSnapshot();
    try {
      const admin = await signInAsNewAdmin(page, { role: 'super_admin' });
      const section = await openSenderInfoSettings(page, admin);
      const input = createSenderInfoInput();

      await saveSenderInfo(page, section, input, CHANGE_REASON);

      await expectSavedSenderInfo(section, input, admin);
      expect(await readSenderInfoSnapshot()).toMatchObject({
        ...input,
        version: original.version + 1,
      });

      const logRows = await senderInfoAuditLogRows(page, admin);
      await expect(logRows).toHaveCount(1);
      await expect(logRows).toContainText(CHANGE_REASON);
    } finally {
      await restoreSenderInfo(original);
    }
  });
});
