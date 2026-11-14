import { expect, test } from './auth-test.ts';

import {
  createTestAccount,
  registerAccount,
  verifyEmailBanner,
  verifyEmailFromMail,
} from './account-steps.ts';

test.describe('利用者の登録とメールアドレスの確認', () => {
  test('登録すると未確認の帯が出て、メールのリンクで確認すると帯が消える', async ({
    page,
  }) => {
    const account = createTestAccount();

    await registerAccount(page, account);

    await expect(page).toHaveURL('/');
    await expect(verifyEmailBanner(page)).toBeVisible();

    await verifyEmailFromMail(page, account);

    await expect(verifyEmailBanner(page)).toHaveCount(0);
    await page.goto('/');
    await expect(verifyEmailBanner(page)).toHaveCount(0);
  });
});
