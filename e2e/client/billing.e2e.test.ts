import { createTestAccount, registerAccount } from './auth/account-steps.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  openBillingFromSettingsNavigation,
  paymentHistoryEmptyMessage,
  paymentHistoryList,
  stripeScripts,
} from './billing-steps.ts';

test.describe('決済履歴(利用者側)', () => {
  test('ログインした利用者が設定のナビゲーションの「決済履歴」から画面を開くと、記録が無い表示が出て、決済のスクリプトは読み込まれない', async ({
    page,
  }) => {
    const account = createTestAccount();
    await registerAccount(page, account);

    await openBillingFromSettingsNavigation(page, account);

    await expect(paymentHistoryEmptyMessage(page)).toBeVisible();
    await expect(paymentHistoryList(page)).toHaveCount(0);
    await expect(stripeScripts(page)).toHaveCount(0);
  });
});
