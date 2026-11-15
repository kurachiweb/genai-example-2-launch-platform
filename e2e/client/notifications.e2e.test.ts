import {
  createUnsubscribeToken,
  findUserIdByEmail,
} from '../support/notification-fixtures.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
} from './auth/account-steps.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  confirmUnsubscribe,
  expectEnabledTopics,
  openNotificationSettings,
  openSettingsFromUnsubscribeResult,
  openUnsubscribeLink,
  postOneClickUnsubscribe,
  switchTopic,
} from './notification-steps.ts';
import { registerVerifiedAccount } from './profile-steps.ts';

test.describe.configure({ timeout: MAIL_FLOW_TIMEOUT_MS });

const ONE_CLICK_UNSUBSCRIBED_STATUS = 200;

// ローカルのD1へ種の行を直接入れてトークンを導出し、注入されたHASH_PEPPERを使うため、@smokeタグを付けない
test.describe('通知設定と配信停止', () => {
  test('初期設定では4つとも受信しない設定で、切り替えた2つは再読み込みでも保たれ、ワンクリックの配信停止と配信停止ページの確認でどちらも受信しない設定に戻る', async ({
    page,
    request,
  }) => {
    const account = createTestAccount();
    await registerVerifiedAccount(page, account);
    await openNotificationSettings(page, account);
    await expectEnabledTopics(page, []);

    await switchTopic(page, 'match_result', true);
    await switchTopic(page, 'followed_user_award', true);
    await page.reload();
    await expectEnabledTopics(page, ['match_result', 'followed_user_award']);

    const userId = await findUserIdByEmail(account.email);
    const resultToken = await createUnsubscribeToken(userId, 'match_result');
    const awardToken = await createUnsubscribeToken(
      userId,
      'followed_user_award',
    );

    expect(await postOneClickUnsubscribe(request, awardToken)).toBe(
      ONE_CLICK_UNSUBSCRIBED_STATUS,
    );

    await openUnsubscribeLink(page, resultToken);
    await confirmUnsubscribe(page, 'match_result');
    await openSettingsFromUnsubscribeResult(page, 'match_result');
    await expectEnabledTopics(page, []);
  });
});
